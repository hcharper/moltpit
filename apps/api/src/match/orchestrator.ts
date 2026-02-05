import { GameState, Player, GameResult, gameRegistry } from '../games/index.js';

interface AgentHandler {
  requestMove(agentId: string, gameState: unknown, timeoutMs: number): Promise<{
    action: unknown;
    trashTalk?: string;
  }>;
}

export interface Match {
  id: string;
  tournamentId?: string;
  gameType: string;
  players: Player[];
  gameState: GameState;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  result?: GameResult;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  // Time tracking
  turnStartTime?: number; // Timestamp when current turn started
  activePlayerId?: string; // Who's clock is running
}

export interface MatchEvent {
  type: 'game_start' | 'move' | 'trash_talk' | 'game_end' | 'error' | 'timeout' | 'time_update';
  matchId: string;
  timestamp: Date;
  data: unknown;
}

type MatchEventHandler = (event: MatchEvent) => void;

/**
 * Match Orchestrator
 * Manages the execution of matches between AI agents
 */
export class MatchOrchestrator {
  private matches: Map<string, Match> = new Map();
  private eventHandlers: Map<string, MatchEventHandler[]> = new Map();
  private agentHandler: AgentHandler;
  private timeUpdateIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(agentHandler: AgentHandler) {
    this.agentHandler = agentHandler;
  }

  /**
   * Create a new match
   */
  async createMatch(
    matchId: string,
    gameType: string,
    players: Player[],
    tournamentId?: string
  ): Promise<Match> {
    const engine = gameRegistry.get(gameType);
    if (!engine) {
      throw new Error(`Unknown game type: ${gameType}`);
    }

    if (players.length < engine.minPlayers || players.length > engine.maxPlayers) {
      throw new Error(`${gameType} requires ${engine.minPlayers}-${engine.maxPlayers} players`);
    }

    const gameState = engine.createGame(matchId, players);

    const match: Match = {
      id: matchId,
      tournamentId,
      gameType,
      players,
      gameState,
      status: 'pending',
      createdAt: new Date(),
    };

    this.matches.set(matchId, match);
    return match;
  }

  /**
   * Start time update interval for spectators
   */
  private startTimeUpdates(matchId: string): void {
    // Clear any existing interval
    this.stopTimeUpdates(matchId);
    
    // Send time updates every second
    const interval = setInterval(() => {
      const match = this.matches.get(matchId);
      if (!match || match.status !== 'in_progress') {
        this.stopTimeUpdates(matchId);
        return;
      }

      const engine = gameRegistry.get(match.gameType);
      if (!engine) return;

      // Calculate current time remaining (deduct elapsed time from active player)
      const playerTimes = { ...match.gameState.playerTimes };
      if (match.turnStartTime && match.activePlayerId && playerTimes) {
        const elapsed = Date.now() - match.turnStartTime;
        playerTimes[match.activePlayerId] = Math.max(0, (playerTimes[match.activePlayerId] || 0) - elapsed);
      }

      this.emit(matchId, {
        type: 'time_update',
        matchId,
        timestamp: new Date(),
        data: {
          playerTimes,
          activePlayerId: match.activePlayerId,
        },
      });
    }, 1000);

    this.timeUpdateIntervals.set(matchId, interval);
  }

  /**
   * Stop time update interval
   */
  private stopTimeUpdates(matchId: string): void {
    const interval = this.timeUpdateIntervals.get(matchId);
    if (interval) {
      clearInterval(interval);
      this.timeUpdateIntervals.delete(matchId);
    }
  }

  /**
   * Start and run a match to completion
   */
  async runMatch(matchId: string): Promise<GameResult> {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new Error(`Match not found: ${matchId}`);
    }

    const engine = gameRegistry.get(match.gameType);
    if (!engine) {
      throw new Error(`Unknown game type: ${match.gameType}`);
    }

    match.status = 'in_progress';
    match.startedAt = new Date();

    // Get time control settings
    const timeControl = match.gameState.timeControl || engine.defaultTimeControl;
    const minMoveDelay = timeControl.minMoveDelayMs;

    this.emit(matchId, {
      type: 'game_start',
      matchId,
      timestamp: new Date(),
      data: {
        players: match.players,
        gameType: match.gameType,
        initialState: engine.serializeForSpectator(match.gameState),
        timeControl,
      },
    });

    // Start sending time updates to spectators
    this.startTimeUpdates(matchId);

    // Game loop
    while (!engine.isGameOver(match.gameState)) {
      const currentPlayer = engine.getCurrentPlayer(match.gameState);
      const agentState = engine.serializeForAgent(match.gameState, currentPlayer.id);

      // Start the clock for current player
      match.turnStartTime = Date.now();
      match.activePlayerId = currentPlayer.id;

      // Get remaining time for current player
      const playerTimeRemaining = match.gameState.playerTimes?.[currentPlayer.id] ?? timeControl.initialMs;
      
      // Use remaining time as timeout (or default per-move timeout if no time control)
      const moveTimeout = Math.min(playerTimeRemaining, engine.defaultTimePerMoveMs);

      const startTime = Date.now();
      
      try {
        // Request move from agent
        const response = await this.agentHandler.requestMove(
          currentPlayer.agentId,
          agentState,
          moveTimeout
        );

        const thinkingTime = Date.now() - startTime;

        // Enforce minimum move delay (prevent spam)
        if (thinkingTime < minMoveDelay) {
          await this.sleep(minMoveDelay - thinkingTime);
        }

        const actualThinkingTime = Math.max(thinkingTime, minMoveDelay);

        // Deduct time from player's clock
        if (match.gameState.playerTimes) {
          match.gameState.playerTimes[currentPlayer.id] = 
            Math.max(0, (match.gameState.playerTimes[currentPlayer.id] || 0) - actualThinkingTime);
        }

        // Check if player ran out of time
        if (match.gameState.playerTimes && match.gameState.playerTimes[currentPlayer.id] <= 0) {
          // Time forfeit
          const opponent = match.players.find(p => p.id !== currentPlayer.id)!;
          match.status = 'completed';
          match.completedAt = new Date();
          this.stopTimeUpdates(matchId);
          
          match.result = {
            winnerId: opponent.id,
            loserId: currentPlayer.id,
            isDraw: false,
            reason: 'Time forfeit - ran out of time',
            finalState: match.gameState,
            eloChanges: [],
          };

          this.emit(matchId, {
            type: 'timeout',
            matchId,
            timestamp: new Date(),
            data: {
              playerId: currentPlayer.id,
              playerName: currentPlayer.name,
            },
          });

          this.emit(matchId, {
            type: 'game_end',
            matchId,
            timestamp: new Date(),
            data: match.result,
          });

          return match.result;
        }

        // Apply move
        match.gameState = engine.applyMove(
          match.gameState,
          currentPlayer.id,
          response.action
        );

        // Add Fischer increment after move
        if (match.gameState.playerTimes && timeControl.incrementMs > 0) {
          match.gameState.playerTimes[currentPlayer.id] = 
            (match.gameState.playerTimes[currentPlayer.id] || 0) + timeControl.incrementMs;
        }

        // Update history with thinking time
        const lastAction = match.gameState.history[match.gameState.history.length - 1];
        lastAction.thinkingTimeMs = actualThinkingTime;
        lastAction.trashTalk = response.trashTalk;

        // Emit move event with updated times
        this.emit(matchId, {
          type: 'move',
          matchId,
          timestamp: new Date(),
          data: {
            playerId: currentPlayer.id,
            playerName: currentPlayer.name,
            action: response.action,
            thinkingTimeMs: actualThinkingTime,
            gameState: engine.serializeForSpectator(match.gameState),
          },
        });

        // Emit trash talk if present
        if (response.trashTalk) {
          this.emit(matchId, {
            type: 'trash_talk',
            matchId,
            timestamp: new Date(),
            data: {
              playerId: currentPlayer.id,
              playerName: currentPlayer.name,
              message: response.trashTalk,
            },
          });
        }

      } catch (error) {
        // Handle timeout or error
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        this.stopTimeUpdates(matchId);

        this.emit(matchId, {
          type: 'error',
          matchId,
          timestamp: new Date(),
          data: {
            playerId: currentPlayer.id,
            error: errorMessage,
          },
        });

        // Forfeit the match - opponent wins
        const opponent = match.players.find(p => p.id !== currentPlayer.id)!;
        match.status = 'completed';
        match.completedAt = new Date();
        match.result = {
          winnerId: opponent.id,
          loserId: currentPlayer.id,
          isDraw: false,
          reason: `Opponent forfeited: ${errorMessage}`,
          finalState: match.gameState,
          eloChanges: [], // Would calculate properly
        };

        this.emit(matchId, {
          type: 'game_end',
          matchId,
          timestamp: new Date(),
          data: match.result,
        });

        return match.result;
      }
    }

    // Game ended normally
    this.stopTimeUpdates(matchId);
    const result = engine.getResult(match.gameState);
    match.status = 'completed';
    match.completedAt = new Date();
    match.result = result;

    this.emit(matchId, {
      type: 'game_end',
      matchId,
      timestamp: new Date(),
      data: result,
    });

    return result;
  }

  /**
   * Get match by ID
   */
  getMatch(matchId: string): Match | undefined {
    return this.matches.get(matchId);
  }

  /**
   * Subscribe to match events
   */
  subscribe(matchId: string, handler: MatchEventHandler): () => void {
    const handlers = this.eventHandlers.get(matchId) || [];
    handlers.push(handler);
    this.eventHandlers.set(matchId, handlers);

    // Return unsubscribe function
    return () => {
      const current = this.eventHandlers.get(matchId) || [];
      this.eventHandlers.set(
        matchId,
        current.filter(h => h !== handler)
      );
    };
  }

  private emit(matchId: string, event: MatchEvent): void {
    const handlers = this.eventHandlers.get(matchId) || [];
    handlers.forEach(handler => {
      try {
        handler(event);
      } catch (e) {
        console.error('Error in match event handler:', e);
      }
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
