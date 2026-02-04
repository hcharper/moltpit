import { Chess, Move, Square } from 'chess.js';
import { 
  GameEngine, 
  GameState, 
  GameResult, 
  Player,
  gameRegistry 
} from './engine.js';

export interface ChessState {
  fen: string;
  pgn: string;
  moveHistory: ChessMove[];
  capturedPieces: {
    white: string[];
    black: string[];
  };
}

export interface ChessMove {
  from: string;
  to: string;
  promotion?: string;
  san?: string; // Standard Algebraic Notation
}

export class ChessEngine extends GameEngine {
  readonly gameType = 'chess';
  readonly displayName = 'Chess';
  readonly description = 'Classic chess - first agent to checkmate wins';
  readonly minPlayers = 2;
  readonly maxPlayers = 2;
  readonly defaultTimePerMoveMs = 30000; // 30 seconds per move

  createGame(gameId: string, players: Player[]): GameState {
    if (players.length !== 2) {
      throw new Error('Chess requires exactly 2 players');
    }

    const chess = new Chess();

    return {
      gameId,
      gameType: this.gameType,
      status: 'in_progress',
      currentTurn: 0,
      players,
      state: {
        fen: chess.fen(),
        pgn: '',
        moveHistory: [],
        capturedPieces: { white: [], black: [] },
      } as ChessState,
      history: [],
      startedAt: new Date(),
      updatedAt: new Date(),
    };
  }

  applyMove(gameState: GameState, playerId: string, action: unknown): GameState {
    const currentPlayer = this.getCurrentPlayer(gameState);
    if (currentPlayer.id !== playerId) {
      throw new Error('Not your turn');
    }

    const chessState = gameState.state as ChessState;
    const chess = new Chess(chessState.fen);
    const move = action as ChessMove;

    // Validate and make move
    let result: Move;
    try {
      result = chess.move({
        from: move.from as Square,
        to: move.to as Square,
        promotion: move.promotion as 'q' | 'r' | 'b' | 'n' | undefined,
      });
    } catch (e) {
      throw new Error(`Invalid move: ${move.from} to ${move.to}`);
    }

    // Track captured pieces
    const newCapturedPieces = { ...chessState.capturedPieces };
    if (result.captured) {
      const capturedBy = result.color === 'w' ? 'white' : 'black';
      newCapturedPieces[capturedBy] = [...newCapturedPieces[capturedBy], result.captured];
    }

    // Update state
    const newChessState: ChessState = {
      fen: chess.fen(),
      pgn: chess.pgn(),
      moveHistory: [...chessState.moveHistory, { ...move, san: result.san }],
      capturedPieces: newCapturedPieces,
    };

    const newStatus = this.isGameOverInternal(chess) ? 'completed' : 'in_progress';

    return {
      ...gameState,
      currentTurn: gameState.currentTurn + 1,
      status: newStatus,
      state: newChessState,
      history: [...gameState.history, {
        playerId,
        action: move,
        timestamp: new Date(),
        thinkingTimeMs: 0, // Filled in by match orchestrator
      }],
      updatedAt: new Date(),
    };
  }

  getValidMoves(gameState: GameState): ChessMove[] {
    const chessState = gameState.state as ChessState;
    const chess = new Chess(chessState.fen);
    
    return chess.moves({ verbose: true }).map(m => ({
      from: m.from,
      to: m.to,
      promotion: m.promotion,
      san: m.san,
    }));
  }

  isGameOver(gameState: GameState): boolean {
    const chessState = gameState.state as ChessState;
    const chess = new Chess(chessState.fen);
    return this.isGameOverInternal(chess);
  }

  private isGameOverInternal(chess: Chess): boolean {
    return chess.isGameOver();
  }

  getResult(gameState: GameState): GameResult {
    const chessState = gameState.state as ChessState;
    const chess = new Chess(chessState.fen);

    if (!chess.isGameOver()) {
      throw new Error('Game is not over yet');
    }

    const [player1, player2] = gameState.players;
    let winnerId: string;
    let loserId: string;
    let isDraw = false;
    let reason: string;

    if (chess.isCheckmate()) {
      // The player who just moved won (opponent is in checkmate)
      const winnerColor = chess.turn() === 'w' ? 'black' : 'white';
      winnerId = winnerColor === 'white' ? player1.id : player2.id;
      loserId = winnerColor === 'white' ? player2.id : player1.id;
      reason = 'Checkmate';
    } else if (chess.isDraw()) {
      isDraw = true;
      winnerId = player1.id;
      loserId = player2.id;
      
      if (chess.isStalemate()) {
        reason = 'Stalemate';
      } else if (chess.isThreefoldRepetition()) {
        reason = 'Threefold repetition';
      } else if (chess.isInsufficientMaterial()) {
        reason = 'Insufficient material';
      } else {
        reason = 'Draw by 50-move rule';
      }
    } else {
      throw new Error('Unknown game end condition');
    }

    // Calculate Elo changes
    const eloChanges = this.calculateEloChanges(
      player1,
      player2,
      isDraw ? 0.5 : (winnerId === player1.id ? 1 : 0)
    );

    return {
      winnerId,
      loserId,
      isDraw,
      reason,
      finalState: gameState,
      eloChanges,
    };
  }

  private calculateEloChanges(
    player1: Player,
    player2: Player,
    score1: number // 1 = player1 wins, 0 = player2 wins, 0.5 = draw
  ): { playerId: string; oldElo: number; newElo: number }[] {
    const K = 32; // K-factor
    
    const expected1 = 1 / (1 + Math.pow(10, (player2.elo - player1.elo) / 400));
    const expected2 = 1 - expected1;
    
    const newElo1 = Math.round(player1.elo + K * (score1 - expected1));
    const newElo2 = Math.round(player2.elo + K * ((1 - score1) - expected2));

    return [
      { playerId: player1.id, oldElo: player1.elo, newElo: newElo1 },
      { playerId: player2.id, oldElo: player2.elo, newElo: newElo2 },
    ];
  }

  serializeForAgent(gameState: GameState, playerId: string): object {
    const chessState = gameState.state as ChessState;
    const playerIndex = gameState.players.findIndex(p => p.id === playerId);
    const color = playerIndex === 0 ? 'white' : 'black';

    return {
      gameType: 'chess',
      yourColor: color,
      fen: chessState.fen,
      moveHistory: chessState.moveHistory,
      validMoves: this.getValidMoves(gameState),
      capturedPieces: chessState.capturedPieces,
      isYourTurn: this.getCurrentPlayer(gameState).id === playerId,
      opponent: {
        name: gameState.players[1 - playerIndex].name,
        elo: gameState.players[1 - playerIndex].elo,
      },
    };
  }

  serializeForSpectator(gameState: GameState): object {
    const chessState = gameState.state as ChessState;
    const chess = new Chess(chessState.fen);

    return {
      gameType: 'chess',
      fen: chessState.fen,
      pgn: chessState.pgn,
      moveHistory: chessState.moveHistory,
      capturedPieces: chessState.capturedPieces,
      currentTurn: chess.turn() === 'w' ? 'white' : 'black',
      isCheck: chess.isCheck(),
      isCheckmate: chess.isCheckmate(),
      isDraw: chess.isDraw(),
      players: gameState.players.map(p => ({
        id: p.id,
        name: p.name,
        elo: p.elo,
        color: gameState.players.indexOf(p) === 0 ? 'white' : 'black',
      })),
    };
  }

  getCurrentPlayer(gameState: GameState): Player {
    const chessState = gameState.state as ChessState;
    const chess = new Chess(chessState.fen);
    const turn = chess.turn();
    // Player 0 is white, Player 1 is black
    return turn === 'w' ? gameState.players[0] : gameState.players[1];
  }
}

// Register chess engine
gameRegistry.register(new ChessEngine());
