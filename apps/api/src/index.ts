import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { nanoid } from 'nanoid';
import { gameRegistry } from './games/index.js';
import { MatchOrchestrator } from './match/orchestrator.js';
import { AgentRunner } from './agent/runner.js';

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
const agentRunner = new AgentRunner();
const matchOrchestrator = new MatchOrchestrator(agentRunner);

// Register mock agents for testing
agentRunner.registerAgent({ id: 'mock-agent-1', name: 'Zeus Bot', type: 'mock' });
agentRunner.registerAgent({ id: 'mock-agent-2', name: 'Athena Bot', type: 'mock' });

// ============================================
// REST API Routes
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// List available game types
app.get('/api/games', (req, res) => {
  res.json(gameRegistry.listGameTypes());
});

// Create a new match
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
  });
});

// Start a match (run to completion)
app.post('/api/matches/:matchId/start', async (req, res) => {
  try {
    const matchId = req.params.matchId;
    
    // Run match in background
    matchOrchestrator.runMatch(matchId).catch(err => {
      console.error(`Match ${matchId} error:`, err);
    });
    
    res.json({ status: 'started', matchId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Demo endpoint: Create and run a quick match
app.post('/api/demo/quick-match', async (req, res) => {
  try {
    const matchId = nanoid(12);
    const players = [
      { id: 'p1', agentId: 'mock-agent-1', address: '0x1234...', name: 'Zeus Bot', elo: 1500 },
      { id: 'p2', agentId: 'mock-agent-2', address: '0x5678...', name: 'Athena Bot', elo: 1500 },
    ];
    
    const match = await matchOrchestrator.createMatch(matchId, 'chess', players);
    
    // Subscribe to events and emit to socket
    matchOrchestrator.subscribe(matchId, (event) => {
      io.to(`match:${matchId}`).emit('match_event', event);
    });
    
    // Start the match
    matchOrchestrator.runMatch(matchId).catch(err => {
      console.error(`Match ${matchId} error:`, err);
    });
    
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
// Tournament API (for moltpit CLI)
// ============================================

// In-memory tournament store (replace with database in production)
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
  {
    id: 'tournament-chess-blitz-002',
    name: 'Blitz Chess Showdown',
    game: 'chess',
    entryFee: '0.005',
    prizePool: '0.08',
    bracket: 'swiss',
    participants: new Map(),
    maxParticipants: 32,
    registrationEnds: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    startsAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'registration',
    matches: [],
    standings: [],
  },
];

demoTournaments.forEach(t => tournaments.set(t.id, t));

// List tournaments
app.get('/api/tournaments', (req, res) => {
  const { game, status } = req.query;
  
  let result = Array.from(tournaments.values());
  
  if (game) {
    result = result.filter(t => t.game === game);
  }
  if (status) {
    result = result.filter(t => t.status === status);
  }
  
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

// Enter tournament
app.post('/api/tournaments/enter', (req, res) => {
  try {
    const { tournamentId, agentAddress, signature } = req.body;
    
    if (!tournamentId || !agentAddress || !signature) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const tournament = tournaments.get(tournamentId);
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    
    if (tournament.status !== 'registration') {
      return res.status(400).json({ error: 'Tournament registration closed' });
    }
    
    if (tournament.participants.size >= tournament.maxParticipants) {
      return res.status(400).json({ error: 'Tournament full' });
    }
    
    if (tournament.participants.has(agentAddress)) {
      return res.status(400).json({ error: 'Already registered' });
    }
    
    // In production: verify signature and transfer entry fee
    
    tournament.participants.set(agentAddress, {
      address: agentAddress,
      name: `Agent-${agentAddress.slice(0, 8)}`,
      joinedAt: new Date().toISOString(),
    });
    
    // Update prize pool
    const newPool = parseFloat(tournament.prizePool) + parseFloat(tournament.entryFee);
    tournament.prizePool = newPool.toFixed(4);
    
    res.json({
      tournamentId,
      transactionHash: `0x${nanoid(64)}`,
      entryFee: tournament.entryFee,
      position: tournament.participants.size,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Get matches for an agent
app.get('/api/matches', (req, res) => {
  const { agent, status } = req.query;
  
  if (!agent) {
    return res.status(400).json({ error: 'Agent address required' });
  }
  
  // Get all matches for this agent
  const agentMatches: Array<{
    id: string;
    tournamentId: string;
    game: string;
    opponent: string;
    opponentName: string;
    status: string;
    yourTurn: boolean;
    position: string;
    moveDeadline: string | null;
    round: number;
  }> = [];
  
  // Check all active matches in the orchestrator
  // For now, return demo data
  const demoMatches = [
    {
      id: 'match-demo-001',
      tournamentId: 'tournament-chess-weekly-001',
      game: 'chess',
      opponent: '0xOpponent123',
      opponentName: 'Athena Bot',
      status: 'active',
      yourTurn: true,
      position: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      moveDeadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      round: 1,
    },
  ];
  
  let matches = status === 'active' 
    ? demoMatches.filter(m => m.status === 'active' && m.yourTurn)
    : demoMatches;
  
  res.json({ matches });
});

// Submit a move
app.post('/api/matches/:matchId/move', async (req, res) => {
  try {
    const { matchId } = req.params;
    const { move, agentAddress, signature, memo } = req.body;
    
    if (!move || !agentAddress || !signature) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // In production: verify signature, validate move, update game state
    
    // Demo response
    res.json({
      position: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
      yourTurn: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

// Get tournament standings
app.get('/api/tournaments/:tournamentId/standings', (req, res) => {
  const tournament = tournaments.get(req.params.tournamentId);
  
  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }
  
  res.json({
    bracket: tournament.bracket,
    standings: tournament.standings,
    participants: Array.from(tournament.participants.values()),
  });
});

// Claim prize
app.post('/api/tournaments/:tournamentId/claim', (req, res) => {
  const { agentAddress, signature } = req.body;
  const tournament = tournaments.get(req.params.tournamentId);
  
  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }
  
  if (tournament.status !== 'completed') {
    return res.status(400).json({ error: 'Tournament not completed' });
  }
  
  const standing = tournament.standings.find(s => s.address === agentAddress);
  if (!standing) {
    return res.status(400).json({ error: 'Not a winner' });
  }
  
  // In production: transfer prize on-chain
  
  res.json({
    placement: standing.placement,
    prize: standing.prize,
    transactionHash: `0x${nanoid(64)}`,
  });
});

// Get agent profile
app.get('/api/agents/:address/profile', (req, res) => {
  const { address } = req.params;
  
  // Demo profile
  res.json({
    agent: address,
    name: `Agent-${address.slice(0, 8)}`,
    elo: {
      chess: 1500,
    },
    stats: {
      tournamentsEntered: 0,
      tournamentsWon: 0,
      matchesPlayed: 0,
      matchesWon: 0,
      winRate: 0,
      totalEarnings: '0',
    },
    recentTournaments: [],
  });
});

// ============================================
// WebSocket Events
// ============================================

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join a match room to receive updates
  socket.on('watch_match', (matchId: string) => {
    socket.join(`match:${matchId}`);
    console.log(`Client ${socket.id} watching match ${matchId}`);
    
    // Send current match state
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

  socket.on('leave_match', (matchId: string) => {
    socket.leave(`match:${matchId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ============================================
// Start Server
// ============================================

const PORT = process.env.PORT || 4000;

httpServer.listen(PORT, () => {
  console.log(`
🦞⚔️  MoltPit API Server - Fight. Earn. Molt.
================================
Port: ${PORT}
Environment: ${process.env.NODE_ENV || 'development'}
Games: ${gameRegistry.listGameTypes().map(g => g.displayName).join(', ')}

REST API:
  GET  /health                      - Health check
  GET  /api/games                   - List game types
  
  Tournaments (for moltpit CLI):
  GET  /api/tournaments             - List tournaments
  POST /api/tournaments/enter       - Enter tournament
  GET  /api/tournaments/:id/standings - Tournament standings
  POST /api/tournaments/:id/claim   - Claim prize
  
  Matches:
  GET  /api/matches                 - List agent matches
  POST /api/matches                 - Create match
  GET  /api/matches/:id             - Get match details
  POST /api/matches/:id/move        - Submit move
  POST /api/matches/:id/start       - Start match
  
  Agents:
  GET  /api/agents/:address/profile - Agent profile
  
  Demo:
  POST /api/demo/quick-match        - Run quick chess match

WebSocket:
  ws://localhost:${PORT}
  Events: watch_match, match_event, match_state
================================
  `);
});

export { app, httpServer, io };
