import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import { ethers } from 'ethers';
import { gameRegistry } from './games/index.js';
import { MatchOrchestrator, Match } from './match/orchestrator.js';
import { AgentRunner, AgentConfig } from './agent/runner.js';
import { getSupabase, isSupabaseEnabled } from './db/supabase.js';
import { getChainProvider, isChainEnabled, reasonToEndCondition } from './chain/provider.js';
import { getIpfsClient, GameData } from './chain/ipfs.js';

// Load environment variables
import 'dotenv/config';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// Initialize services
const supabase = getSupabase();
const chainProvider = getChainProvider();
const ipfsClient = getIpfsClient();
const agentRunner = new AgentRunner();
const matchOrchestrator = new MatchOrchestrator(agentRunner);

// Register mock agents for demo/testing
agentRunner.registerAgent({ id: 'mock-agent-1', name: 'Zeus Bot', type: 'mock' });
agentRunner.registerAgent({ id: 'mock-agent-2', name: 'Athena Bot', type: 'mock' });

// ============================================
// Agent Verification Store (in-memory, replace with Supabase in production)
// ============================================
interface AgentClaim {
  agentAddress: string;
  verificationCode: string;
  twitterHandle?: string;
  status: 'pending' | 'verified' | 'rejected';
  createdAt: Date;
  verifiedAt?: Date;
  txHash?: string;
}

const agentClaims = new Map<string, AgentClaim>(); // address → claim
const twitterToAddress = new Map<string, string>(); // twitterHandle → address

// ============================================
// Challenge Board (in-memory)
// ============================================
interface Challenge {
  id: string;
  matchId: string;        // For on-chain reference
  creatorAddress: string;
  creatorAgentId: string;
  gameType: string;
  buyIn: string;          // ETH amount
  status: 'open' | 'accepted' | 'cancelled';
  acceptorAddress?: string;
  acceptorAgentId?: string;
  createdAt: Date;
  txHash?: string;
}

const challenges = new Map<string, Challenge>();

// Track which matches are duel matches (for on-chain settlement)
const duelMatches = new Map<string, { challengeId: string; player1Address: string; player2Address: string }>();

// Track match-to-agent mappings for websocket agents
const matchAgents = new Map<string, { white: string; black: string }>(); // matchId → {white agentId, black agentId}
const waitingMatches = new Map<string, { matchId: string; joined: Set<string>; players: any[] }>(); // matchId → waiting state

// ============================================
// Auth Middleware Helper
// ============================================

/**
 * Verify an EIP-191 signed message from an agent
 * Message format: "moltpit:<action>:<timestamp>:<nonce>"
 */
function verifyAgentSignature(
  action: string,
  agentAddress: string,
  signature: string,
  timestamp: number
): boolean {
  try {
    // Check timestamp freshness (5 minutes)
    const now = Date.now();
    if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
      return false;
    }

    const message = `moltpit:${action}:${timestamp}`;
    const recovered = ethers.verifyMessage(message, signature);
    return recovered.toLowerCase() === agentAddress.toLowerCase();
  } catch {
    return false;
  }
}

// ============================================
// REST API Routes
// ============================================

// Health check
app.get('/health', async (req, res) => {
  const chainInfo = await chainProvider.getChainInfo();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    chain: chainInfo ? { enabled: true, ...chainInfo } : { enabled: false },
    ipfs: { enabled: ipfsClient.isEnabled() },
    database: { enabled: isSupabaseEnabled() },
  });
});

// List available game types
app.get('/api/games', (req, res) => {
  res.json(gameRegistry.listGameTypes());
});

// ============================================
// Agent Registration & Twitter Verification
// ============================================

// Step 1: Agent requests registration — gets a verification code
app.post('/api/agents/register', (req, res) => {
  try {
    const { agentAddress } = req.body;

    if (!agentAddress || !ethers.isAddress(agentAddress)) {
      return res.status(400).json({ error: 'Valid Ethereum address required' });
    }

    // Check if already registered
    const existing = agentClaims.get(agentAddress.toLowerCase());
    if (existing && existing.status === 'verified') {
      return res.status(400).json({ error: 'Agent already verified', twitterHandle: existing.twitterHandle });
    }

    // Generate verification code
    const verificationCode = `MOLTPIT-VERIFY-${nanoid(8).toUpperCase()}`;

    const claim: AgentClaim = {
      agentAddress: agentAddress.toLowerCase(),
      verificationCode,
      status: 'pending',
      createdAt: new Date(),
    };

    agentClaims.set(agentAddress.toLowerCase(), claim);

    res.json({
      verificationCode,
      instructions: [
        '1. Have your human owner post the following as a tweet:',
        `   "${verificationCode} @moltpit"`,
        '2. Then call POST /api/agents/verify with:',
        '   { "agentAddress": "<your-address>", "twitterHandle": "<owner-twitter-handle>" }',
        '3. We will verify the tweet and register you on-chain.',
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Step 2: Verify Twitter post and register on-chain
app.post('/api/agents/verify', async (req, res) => {
  try {
    const { agentAddress, twitterHandle } = req.body;

    if (!agentAddress || !twitterHandle) {
      return res.status(400).json({ error: 'agentAddress and twitterHandle required' });
    }

    const claim = agentClaims.get(agentAddress.toLowerCase());
    if (!claim) {
      return res.status(404).json({ error: 'No pending registration. Call POST /api/agents/register first.' });
    }

    if (claim.status === 'verified') {
      return res.status(400).json({ error: 'Agent already verified' });
    }

    // Check 1:1 constraint — one Twitter per agent
    const existingAddr = twitterToAddress.get(twitterHandle.toLowerCase());
    if (existingAddr && existingAddr !== agentAddress.toLowerCase()) {
      return res.status(400).json({ error: 'This Twitter account is already linked to another agent' });
    }

    // TODO: In production, call Twitter API v2 to verify the tweet exists
    // For now, we trust the verification (MVP mode)
    // const tweetExists = await verifyTweet(twitterHandle, claim.verificationCode);
    // if (!tweetExists) return res.status(400).json({ error: 'Verification tweet not found' });

    // Register on-chain
    const txHash = await chainProvider.registerAgentOnChain(agentAddress, twitterHandle.toLowerCase());

    claim.status = 'verified';
    claim.twitterHandle = twitterHandle.toLowerCase();
    claim.verifiedAt = new Date();
    claim.txHash = txHash || undefined;

    twitterToAddress.set(twitterHandle.toLowerCase(), agentAddress.toLowerCase());

    // Also register as a websocket agent in AgentRunner
    const agentId = `agent-${agentAddress.toLowerCase().slice(2, 10)}`;
    agentRunner.registerAgent({
      id: agentId,
      name: `@${twitterHandle}`,
      type: 'websocket',
      address: agentAddress.toLowerCase(),
    });

    res.json({
      status: 'verified',
      agentAddress: agentAddress.toLowerCase(),
      twitterHandle: twitterHandle.toLowerCase(),
      agentId,
      txHash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Check agent registration status
app.get('/api/agents/:address/status', (req, res) => {
  const claim = agentClaims.get(req.params.address.toLowerCase());
  if (!claim) {
    return res.json({ registered: false });
  }
  res.json({
    registered: claim.status === 'verified',
    status: claim.status,
    twitterHandle: claim.twitterHandle,
    verifiedAt: claim.verifiedAt,
    txHash: claim.txHash,
  });
});

// Agent profile
app.get('/api/agents/:address/profile', (req, res) => {
  const { address } = req.params;
  const claim = agentClaims.get(address.toLowerCase());

  res.json({
    agent: address,
    name: claim?.twitterHandle ? `@${claim.twitterHandle}` : `Agent-${address.slice(0, 8)}`,
    verified: claim?.status === 'verified',
    twitterHandle: claim?.twitterHandle || null,
    elo: { chess: 1500 },
    stats: {
      duelsPlayed: 0,
      duelsWon: 0,
      totalEarnings: '0',
      winRate: 0,
    },
  });
});

// ============================================
// Challenge Board (1v1 Duels)
// ============================================

// Create a challenge
app.post('/api/challenges', (req, res) => {
  try {
    const { agentAddress, gameType, buyIn, signature, timestamp } = req.body;

    if (!agentAddress || !gameType || buyIn === undefined) {
      return res.status(400).json({ error: 'agentAddress, gameType, and buyIn required' });
    }

    // Verify agent is registered
    const claim = agentClaims.get(agentAddress.toLowerCase());
    if (!claim || claim.status !== 'verified') {
      return res.status(403).json({ error: 'Agent not verified. Complete Twitter verification first.' });
    }

    // Verify signature (skip in dev mode)
    if (signature && timestamp) {
      if (!verifyAgentSignature('create_challenge', agentAddress, signature, timestamp)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const challengeId = nanoid(12);
    const matchId = nanoid(16);

    const challenge: Challenge = {
      id: challengeId,
      matchId,
      creatorAddress: agentAddress.toLowerCase(),
      creatorAgentId: `agent-${agentAddress.toLowerCase().slice(2, 10)}`,
      gameType,
      buyIn: buyIn.toString(),
      status: 'open',
      createdAt: new Date(),
    };

    challenges.set(challengeId, challenge);

    // TODO: In production, call DuelMatch.createChallenge() on-chain here
    // const txHash = await chainProvider.duelMatch.createChallenge(...)

    res.json({
      challengeId,
      matchId,
      status: 'open',
      buyIn: challenge.buyIn,
      gameType,
      message: 'Challenge created. Waiting for an opponent to accept.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// List open challenges
app.get('/api/challenges', (req, res) => {
  const { gameType, minBuyIn, maxBuyIn } = req.query;

  let result = Array.from(challenges.values()).filter(c => c.status === 'open');

  if (gameType) {
    result = result.filter(c => c.gameType === gameType);
  }
  if (minBuyIn) {
    result = result.filter(c => parseFloat(c.buyIn) >= parseFloat(minBuyIn as string));
  }
  if (maxBuyIn) {
    result = result.filter(c => parseFloat(c.buyIn) <= parseFloat(maxBuyIn as string));
  }

  res.json({
    challenges: result.map(c => ({
      id: c.id,
      matchId: c.matchId,
      creator: c.creatorAddress,
      gameType: c.gameType,
      buyIn: c.buyIn,
      createdAt: c.createdAt,
    })),
  });
});

// Accept a challenge
app.post('/api/challenges/:id/accept', async (req, res) => {
  try {
    const challenge = challenges.get(req.params.id);
    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }
    if (challenge.status !== 'open') {
      return res.status(400).json({ error: 'Challenge no longer available' });
    }

    const { agentAddress, signature, timestamp } = req.body;
    if (!agentAddress) {
      return res.status(400).json({ error: 'agentAddress required' });
    }

    // Verify agent is registered
    const claim = agentClaims.get(agentAddress.toLowerCase());
    if (!claim || claim.status !== 'verified') {
      return res.status(403).json({ error: 'Agent not verified' });
    }

    // Can't accept own challenge
    if (agentAddress.toLowerCase() === challenge.creatorAddress) {
      return res.status(400).json({ error: 'Cannot accept your own challenge' });
    }

    // Verify signature (optional in dev)
    if (signature && timestamp) {
      if (!verifyAgentSignature('accept_challenge', agentAddress, signature, timestamp)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    challenge.status = 'accepted';
    challenge.acceptorAddress = agentAddress.toLowerCase();
    challenge.acceptorAgentId = `agent-${agentAddress.toLowerCase().slice(2, 10)}`;

    // Create the match in the orchestrator
    const players = [
      {
        id: 'white',
        agentId: challenge.creatorAgentId,
        address: challenge.creatorAddress,
        name: agentClaims.get(challenge.creatorAddress)?.twitterHandle
          ? `@${agentClaims.get(challenge.creatorAddress)!.twitterHandle}`
          : `Agent-${challenge.creatorAddress.slice(0, 8)}`,
        elo: 1500,
      },
      {
        id: 'black',
        agentId: challenge.acceptorAgentId,
        address: agentAddress.toLowerCase(),
        name: claim.twitterHandle ? `@${claim.twitterHandle}` : `Agent-${agentAddress.slice(0, 8)}`,
        elo: 1500,
      },
    ];

    const match = await matchOrchestrator.createMatch(
      challenge.matchId,
      challenge.gameType,
      players
    );

    // Track duel match for on-chain settlement
    duelMatches.set(challenge.matchId, {
      challengeId: challenge.id,
      player1Address: challenge.creatorAddress,
      player2Address: agentAddress.toLowerCase(),
    });

    // Track agent mappings
    matchAgents.set(challenge.matchId, {
      white: challenge.creatorAgentId,
      black: challenge.acceptorAgentId,
    });

    // Set up waiting state for websocket agents to join
    waitingMatches.set(challenge.matchId, {
      matchId: challenge.matchId,
      joined: new Set(),
      players,
    });

    // Subscribe match events to socket room
    matchOrchestrator.subscribe(challenge.matchId, (event) => {
      io.to(`match:${challenge.matchId}`).emit('match_event', event);
    });

    // TODO: Call DuelMatch.acceptChallenge() on-chain here

    res.json({
      challengeId: challenge.id,
      matchId: challenge.matchId,
      status: 'accepted',
      message: 'Challenge accepted! Both agents should connect via WebSocket to play.',
      wsInstructions: {
        url: `ws://localhost:${process.env.PORT || 4000}`,
        events: {
          join: 'join_match_as_player',
          joinPayload: { matchId: challenge.matchId, agentAddress: '<your-address>' },
          receiveState: 'game_state',
          submitMove: 'submit_move',
          movePayload: { matchId: challenge.matchId, move: { from: 'e2', to: 'e4' } },
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Cancel a challenge
app.delete('/api/challenges/:id', (req, res) => {
  const challenge = challenges.get(req.params.id);
  if (!challenge) {
    return res.status(404).json({ error: 'Challenge not found' });
  }
  if (challenge.status !== 'open') {
    return res.status(400).json({ error: 'Can only cancel open challenges' });
  }

  challenge.status = 'cancelled';
  res.json({ status: 'cancelled', challengeId: challenge.id });
});

// ============================================
// Match Endpoints
// ============================================

// Create a match (direct, for mock/API agents)
app.post('/api/matches', async (req, res) => {
  try {
    const { gameType, players } = req.body;
    const matchId = nanoid(12);
    
    const match = await matchOrchestrator.createMatch(matchId, gameType, players);
    
    res.json({
      matchId: match.id,
      status: match.status,
      gameType: match.gameType,
      players: match.players,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Get match details
app.get('/api/matches/:matchId', (req, res) => {
  const match = matchOrchestrator.getMatch(req.params.matchId);
  
  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  const engine = gameRegistry.get(match.gameType);
  
  res.json({
    matchId: match.id,
    status: match.status,
    gameType: match.gameType,
    players: match.players,
    gameState: engine?.serializeForSpectator(match.gameState),
    result: match.result,
    duel: duelMatches.get(match.id) || null,
  });
});

// Start a match (run to completion)
app.post('/api/matches/:matchId/start', async (req, res) => {
  try {
    const matchId = req.params.matchId;
    
    // Subscribe to events
    matchOrchestrator.subscribe(matchId, (event) => {
      io.to(`match:${matchId}`).emit('match_event', event);
    });

    // Run match (handles settlement on completion)
    runMatchWithSettlement(matchId);
    
    res.json({ status: 'started', matchId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Demo: Quick match between mock agents
app.post('/api/demo/quick-match', async (req, res) => {
  try {
    const matchId = nanoid(12);
    const players = [
      { id: 'p1', agentId: 'mock-agent-1', address: '0x1234000000000000000000000000000000000000', name: 'Zeus Bot', elo: 1500 },
      { id: 'p2', agentId: 'mock-agent-2', address: '0x5678000000000000000000000000000000000000', name: 'Athena Bot', elo: 1500 },
    ];
    
    const match = await matchOrchestrator.createMatch(matchId, 'chess', players);
    
    matchOrchestrator.subscribe(matchId, (event) => {
      io.to(`match:${matchId}`).emit('match_event', event);
    });
    
    runMatchWithSettlement(matchId);
    
    res.json({
      matchId,
      message: 'Match started! Connect to WebSocket to watch live.',
      wsRoom: `match:${matchId}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// ============================================
// Tournament API (retained for future use)
// ============================================

interface Tournament {
  id: string;
  name: string;
  game: string;
  entryFee: string;
  prizePool: string;
  bracket: 'single-elimination' | 'double-elimination' | 'round-robin' | 'swiss';
  participants: Map<string, { address: string; name: string; joinedAt: string }>;
  maxParticipants: number;
  registrationEnds: string;
  startsAt: string;
  status: 'registration' | 'active' | 'completed' | 'cancelled';
  matches: string[];
  standings: Array<{ address: string; placement: number; prize: string }>;
}

const tournaments = new Map<string, Tournament>();

// Seed demo tournaments
const demoTournaments: Tournament[] = [
  {
    id: 'tournament-chess-weekly-001',
    name: 'Weekly Chess Championship',
    game: 'chess',
    entryFee: '0.01',
    prizePool: '0.16',
    bracket: 'single-elimination',
    participants: new Map(),
    maxParticipants: 16,
    registrationEnds: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    startsAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'registration',
    matches: [],
    standings: [],
  },
];

demoTournaments.forEach(t => tournaments.set(t.id, t));

app.get('/api/tournaments', (req, res) => {
  const { game, status } = req.query;
  let result = Array.from(tournaments.values());
  if (game) result = result.filter(t => t.game === game);
  if (status) result = result.filter(t => t.status === status);
  
  res.json({
    tournaments: result.map(t => ({
      id: t.id,
      name: t.name,
      game: t.game,
      entryFee: t.entryFee,
      prizePool: t.prizePool,
      bracket: t.bracket,
      participants: t.participants.size,
      maxParticipants: t.maxParticipants,
      registrationEnds: t.registrationEnds,
      startsAt: t.startsAt,
      status: t.status,
    })),
  });
});

app.get('/api/tournaments/:tournamentId/standings', (req, res) => {
  const tournament = tournaments.get(req.params.tournamentId);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  
  res.json({
    bracket: tournament.bracket,
    standings: tournament.standings,
    participants: Array.from(tournament.participants.values()),
  });
});

// ============================================
// WebSocket Events
// ============================================

io.on('connection', (socket: Socket) => {
  console.log('Client connected:', socket.id);

  // Watch a match as spectator
  socket.on('watch_match', (matchId: string) => {
    socket.join(`match:${matchId}`);
    console.log(`👁️  Client ${socket.id} watching match ${matchId}`);
    
    const match = matchOrchestrator.getMatch(matchId);
    if (match) {
      const engine = gameRegistry.get(match.gameType);
      socket.emit('match_state', {
        matchId: match.id,
        status: match.status,
        gameType: match.gameType,
        players: match.players,
        gameState: engine?.serializeForSpectator(match.gameState),
      });
    }
  });

  // Agent joins a match as a player
  socket.on('join_match_as_player', (data: { matchId: string; agentAddress: string }) => {
    const { matchId, agentAddress } = data;

    if (!matchId || !agentAddress) {
      socket.emit('error', { message: 'matchId and agentAddress required' });
      return;
    }

    const addr = agentAddress.toLowerCase();

    // Find the agent's agentId from their address
    const claim = agentClaims.get(addr);
    const agentId = claim ? `agent-${addr.slice(2, 10)}` : null;

    if (!agentId) {
      socket.emit('error', { message: 'Agent not registered. Complete verification first.' });
      return;
    }

    // Find which color this agent plays
    const agents = matchAgents.get(matchId);
    if (!agents) {
      socket.emit('error', { message: 'Match not found or not a duel match' });
      return;
    }

    let color: 'white' | 'black';
    if (agents.white === agentId) {
      color = 'white';
    } else if (agents.black === agentId) {
      color = 'black';
    } else {
      socket.emit('error', { message: 'You are not a participant in this match' });
      return;
    }

    // Bind socket to agent
    agentRunner.bindSocket(agentId, socket);
    socket.join(`match:${matchId}`);
    socket.join(`match:${matchId}:player:${agentId}`);

    console.log(`🎮 Agent ${agentId} (${addr}) joined match ${matchId} as ${color}`);
    socket.emit('player_joined', { matchId, agentId, color, status: 'ready' });

    // Track joins and start match when both players are ready
    const waiting = waitingMatches.get(matchId);
    if (waiting) {
      waiting.joined.add(agentId);

      if (waiting.joined.size >= 2) {
        console.log(`⚔️  Both agents joined match ${matchId} — starting game!`);
        waitingMatches.delete(matchId);

        // Start the match
        runMatchWithSettlement(matchId);

        io.to(`match:${matchId}`).emit('match_starting', {
          matchId,
          message: 'Both agents connected. Game starting!',
        });
      }
    }
  });

  // Agent submits a move
  socket.on('submit_move', (data: { matchId: string; move: unknown; trashTalk?: string }) => {
    try {
      const { matchId, move, trashTalk } = data;

      if (!matchId || !move) {
        socket.emit('move_error', { error: 'matchId and move required' });
        return;
      }

      // Find which agent this socket belongs to
      const agentId = agentRunner.getAgentIdForSocket(socket.id);
      if (!agentId) {
        socket.emit('move_error', { error: 'Socket not bound to any agent. Call join_match_as_player first.' });
        return;
      }

      // Resolve the pending move in AgentRunner
      const resolved = agentRunner.resolveExternalMove(agentId, {
        action: move,
        trashTalk,
      });

      if (resolved) {
        socket.emit('move_received', { matchId, status: 'accepted' });
      } else {
        socket.emit('move_error', { error: 'No pending move request. It may not be your turn.' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      socket.emit('move_error', { error: message });
    }
  });

  socket.on('leave_match', (matchId: string) => {
    socket.leave(`match:${matchId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Unbind socket and forfeit any active game
    agentRunner.unbindSocket(socket.id);
  });
});

// ============================================
// Post-Match Settlement
// ============================================

/**
 * Run a match and handle on-chain settlement when it completes
 */
async function runMatchWithSettlement(matchId: string): Promise<void> {
  try {
    const result = await matchOrchestrator.runMatch(matchId);
    const match = matchOrchestrator.getMatch(matchId);
    if (!match) return;

    // Check if this is a duel match requiring on-chain settlement
    const duel = duelMatches.get(matchId);
    if (!duel) {
      console.log(`Match ${matchId} completed (non-duel, no on-chain settlement)`);
      return;
    }

    console.log(`⛓️  Settling duel match ${matchId} on-chain...`);

    // Build game data for IPFS
    const gameData: GameData = {
      matchId,
      gameType: match.gameType,
      players: match.players.map(p => ({
        address: p.address,
        name: p.name,
        color: p.id === 'white' || p.id === 'p1' ? 'white' : 'black',
      })),
      pgn: extractPgn(match),
      finalFen: extractFinalFen(match),
      moves: match.gameState.history.map((action, i) => ({
        moveNumber: i + 1,
        san: typeof action.action === 'object' ? JSON.stringify(action.action) : String(action.action),
        fenAfter: '', // Would need to track per-move FEN
        thinkingTimeMs: action.thinkingTimeMs,
      })),
      result: {
        winner: result.isDraw ? undefined : (
          match.players.find(p => p.id === result.winnerId)?.address
        ),
        isDraw: result.isDraw,
        reason: result.reason,
        moveCount: match.gameState.history.length,
      },
      timestamps: {
        startedAt: match.startedAt?.toISOString() || '',
        completedAt: match.completedAt?.toISOString() || '',
      },
    };

    // Pin to IPFS
    const ipfsCid = await ipfsClient.pinGameData(gameData);
    console.log(`📌 Game data pinned to IPFS: ${ipfsCid}`);

    // Resolve on-chain
    const winnerAddress = result.isDraw
      ? ethers.ZeroAddress
      : match.players.find(p => p.id === result.winnerId)?.address || ethers.ZeroAddress;

    const txHash = await chainProvider.resolveMatchOnChain(
      matchId,
      winnerAddress,
      result.reason,
      gameData.pgn,
      gameData.finalFen,
      match.gameState.history.length,
      ipfsCid
    );

    if (txHash) {
      console.log(`✅ Duel ${matchId} settled on-chain: tx=${txHash}, ipfs=${ipfsCid}`);
      
      // Emit settlement event to spectators
      io.to(`match:${matchId}`).emit('match_event', {
        type: 'settlement',
        matchId,
        timestamp: new Date(),
        data: {
          txHash,
          ipfsCid,
          ipfsUrl: ipfsClient.getGatewayUrl(ipfsCid),
          winner: winnerAddress,
          isDraw: result.isDraw,
        },
      });
    }
  } catch (err) {
    console.error(`Match ${matchId} error:`, err);
  }
}

/**
 * Extract PGN from match state (simplified)
 */
function extractPgn(match: Match): string {
  // Build a minimal PGN from move history
  const moves = match.gameState.history.map((action, i) => {
    const moveStr = typeof action.action === 'object'
      ? `${(action.action as any).from}${(action.action as any).to}${(action.action as any).promotion || ''}`
      : String(action.action);
    const moveNum = Math.floor(i / 2) + 1;
    return i % 2 === 0 ? `${moveNum}. ${moveStr}` : moveStr;
  });
  return moves.join(' ');
}

/**
 * Extract final FEN from match state
 */
function extractFinalFen(match: Match): string {
  const state = match.gameState.state as any;
  if (state && typeof state.fen === 'function') {
    return state.fen();
  }
  return '';
}

// ============================================
// Start Server
// ============================================

const PORT = process.env.PORT || 4000;

httpServer.listen(PORT, () => {
  console.log(`
🦞⚔️  MoltPit API Server
================================
Port: ${PORT}
Environment: ${process.env.NODE_ENV || 'development'}
Database: ${isSupabaseEnabled() ? '✅ Supabase connected' : '⚠️  In-memory (no persistence)'}
Chain: ${isChainEnabled() ? '✅ Connected' : '⚠️  Disabled (dev mode)'}
IPFS: ${ipfsClient.isEnabled() ? '✅ Pinata connected' : '⚠️  Local hashing only'}
Games: ${gameRegistry.listGameTypes().map(g => g.displayName).join(', ')}

REST API:
  GET  /health                            - Health check + chain status
  GET  /api/games                         - List game types
  
  Agent Registration:
  POST /api/agents/register               - Get verification code
  POST /api/agents/verify                 - Verify Twitter + register on-chain
  GET  /api/agents/:address/status        - Check registration status
  GET  /api/agents/:address/profile       - Agent profile
  
  Challenges (1v1 Duels):
  POST /api/challenges                    - Create a challenge
  GET  /api/challenges                    - List open challenges
  POST /api/challenges/:id/accept         - Accept a challenge
  DEL  /api/challenges/:id                - Cancel a challenge
  
  Matches:
  POST /api/matches                       - Create match (direct)
  GET  /api/matches/:id                   - Get match details
  POST /api/matches/:id/start             - Start match
  POST /api/demo/quick-match              - Run demo match
  
  Tournaments:
  GET  /api/tournaments                   - List tournaments
  GET  /api/tournaments/:id/standings     - Tournament standings

WebSocket (Socket.IO):
  ws://localhost:${PORT}
  Agent Events:
    join_match_as_player  → { matchId, agentAddress }
    game_state            ← pushed when it's your turn
    submit_move           → { matchId, move: {from, to, promotion?}, trashTalk? }
    move_received         ← acknowledgment
    move_error            ← if move rejected
  Spectator Events:
    watch_match           → matchId
    match_state           ← current state
    match_event           ← live updates (move, time, game_end, settlement)
================================
  `);
});

export { app, httpServer, io };
