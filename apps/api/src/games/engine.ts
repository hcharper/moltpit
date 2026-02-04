/**
 * Game Engine Interface
 * All game types (chess, trivia, poker, etc.) implement this interface
 */

export interface GameState {
  gameId: string;
  gameType: string;
  status: 'waiting' | 'in_progress' | 'completed';
  currentTurn: number;
  players: Player[];
  state: unknown; // Game-specific state
  history: GameAction[];
  winner?: string;
  startedAt: Date;
  updatedAt: Date;
}

export interface Player {
  id: string;
  agentId: string;
  address: string;
  name: string;
  elo: number;
}

export interface GameAction {
  playerId: string;
  action: unknown;
  trashTalk?: string;
  timestamp: Date;
  thinkingTimeMs: number;
}

export interface GameResult {
  winnerId: string;
  loserId: string;
  isDraw: boolean;
  reason: string;
  finalState: GameState;
  eloChanges: {
    playerId: string;
    oldElo: number;
    newElo: number;
  }[];
}

export interface MoveRequest {
  gameState: GameState;
  timeRemainingMs: number;
}

export interface MoveResponse {
  action: unknown;
  trashTalk?: string;
}

/**
 * Abstract Game Engine
 * Each game type extends this class
 */
export abstract class GameEngine {
  abstract readonly gameType: string;
  abstract readonly displayName: string;
  abstract readonly description: string;
  abstract readonly minPlayers: number;
  abstract readonly maxPlayers: number;
  abstract readonly defaultTimePerMoveMs: number;

  /**
   * Create initial game state for a new match
   */
  abstract createGame(gameId: string, players: Player[]): GameState;

  /**
   * Validate and apply a move
   * Returns updated game state or throws error if invalid
   */
  abstract applyMove(state: GameState, playerId: string, action: unknown): GameState;

  /**
   * Get valid moves for current player
   */
  abstract getValidMoves(state: GameState): unknown[];

  /**
   * Check if game is over
   */
  abstract isGameOver(state: GameState): boolean;

  /**
   * Get game result (only valid after game is over)
   */
  abstract getResult(state: GameState): GameResult;

  /**
   * Serialize game state for agent (may hide opponent info)
   */
  abstract serializeForAgent(state: GameState, playerId: string): unknown;

  /**
   * Serialize game state for spectators
   */
  abstract serializeForSpectator(state: GameState): unknown;

  /**
   * Get current player whose turn it is
   */
  abstract getCurrentPlayer(state: GameState): Player;
}

/**
 * Game Registry - Register all available game engines
 */
export class GameRegistry {
  private engines: Map<string, GameEngine> = new Map();

  register(engine: GameEngine): void {
    this.engines.set(engine.gameType, engine);
  }

  get(gameType: string): GameEngine | undefined {
    return this.engines.get(gameType);
  }

  getAll(): GameEngine[] {
    return Array.from(this.engines.values());
  }

  listGameTypes(): { gameType: string; displayName: string; description: string }[] {
    return this.getAll().map(e => ({
      gameType: e.gameType,
      displayName: e.displayName,
      description: e.description,
    }));
  }
}

export const gameRegistry = new GameRegistry();
