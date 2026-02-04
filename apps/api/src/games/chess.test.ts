import { describe, it, expect, beforeEach } from 'vitest';
import { ChessEngine } from './chess.js';
import type { Player } from './engine.js';

describe('ChessEngine', () => {
  let engine: ChessEngine;
  let testPlayers: Player[];

  beforeEach(() => {
    engine = new ChessEngine();
    testPlayers = [
      { id: 'p1', agentId: 'agent-1', address: '0x1', name: 'White', elo: 1500 },
      { id: 'p2', agentId: 'agent-2', address: '0x2', name: 'Black', elo: 1500 },
    ];
  });

  describe('createGame', () => {
    it('should create a new game with starting position', () => {
      const state = engine.createGame('game-1', testPlayers);
      expect(state.state.fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      expect(state.currentTurn).toBe(0);
      expect(state.state.moveHistory).toEqual([]);
      expect(state.state.capturedPieces).toEqual({ white: [], black: [] });
    });

    it('should throw for wrong number of players', () => {
      expect(() => engine.createGame('game-1', [testPlayers[0]])).toThrow('exactly 2 players');
    });
  });

  describe('applyMove', () => {
    it('should apply a valid move', () => {
      const state = engine.createGame('game-1', testPlayers);
      const newState = engine.applyMove(state, 'p1', { from: 'e2', to: 'e4' });
      
      expect(newState.state.fen).toContain('4P3'); // Pawn on e4
      expect(newState.currentTurn).toBe(1);
      expect(newState.state.moveHistory).toHaveLength(1);
    });

    it('should reject a move from wrong player', () => {
      const state = engine.createGame('game-1', testPlayers);
      expect(() => engine.applyMove(state, 'p2', { from: 'e2', to: 'e4' })).toThrow('Not your turn');
    });

    it('should reject an invalid move', () => {
      const state = engine.createGame('game-1', testPlayers);
      expect(() => engine.applyMove(state, 'p1', { from: 'e2', to: 'e5' })).toThrow('Invalid move');
    });
  });

  describe('getValidMoves', () => {
    it('should return valid moves for starting position', () => {
      const state = engine.createGame('game-1', testPlayers);
      const moves = engine.getValidMoves(state);
      
      // 20 possible opening moves (16 pawn + 4 knight)
      expect(moves.length).toBe(20);
    });
  });

  describe('isGameOver', () => {
    it('should return false for starting position', () => {
      const state = engine.createGame('game-1', testPlayers);
      expect(engine.isGameOver(state)).toBe(false);
    });
  });

  describe('getResult', () => {
    it('should throw for ongoing game', () => {
      const state = engine.createGame('game-1', testPlayers);
      expect(() => engine.getResult(state)).toThrow('Game is not over yet');
    });
  });

  describe('serializeForAgent', () => {
    it('should include all necessary info for agent', () => {
      const state = engine.createGame('game-1', testPlayers);
      const serialized = engine.serializeForAgent(state, 'p1');
      
      expect(serialized).toHaveProperty('fen');
      expect(serialized).toHaveProperty('validMoves');
      expect(serialized).toHaveProperty('yourColor', 'white');
    });
  });

  describe('serializeForSpectator', () => {
    it('should include game state for viewing', () => {
      const state = engine.createGame('game-1', testPlayers);
      const serialized = engine.serializeForSpectator(state);
      
      expect(serialized).toHaveProperty('fen');
      expect(serialized).toHaveProperty('players');
    });
  });
});
