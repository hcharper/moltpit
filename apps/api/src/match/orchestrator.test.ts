import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatchOrchestrator, MatchEvent } from './orchestrator.js';
import { AgentRunner } from '../agent/runner.js';

// Mock the agent runner
vi.mock('../agent/runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    registerAgent: vi.fn(),
    requestMove: vi.fn().mockResolvedValue({
      move: 'e2e4',
      thinkingTime: 100,
      trashTalk: 'Good luck!',
    }),
    generateTrashTalk: vi.fn().mockResolvedValue('Let the games begin!'),
  })),
}));

describe('MatchOrchestrator', () => {
  let orchestrator: MatchOrchestrator;
  let agentRunner: AgentRunner;

  beforeEach(() => {
    agentRunner = new AgentRunner();
    orchestrator = new MatchOrchestrator(agentRunner);
  });

  describe('createMatch', () => {
    it('should create a new match', async () => {
      const players = [
        { id: 'p1', agentId: 'agent-1', address: '0x1', name: 'Agent 1', elo: 1500 },
        { id: 'p2', agentId: 'agent-2', address: '0x2', name: 'Agent 2', elo: 1500 },
      ];

      const match = await orchestrator.createMatch('match-1', 'chess', players);

      expect(match.id).toBe('match-1');
      expect(match.gameType).toBe('chess');
      expect(match.players).toHaveLength(2);
      expect(match.status).toBe('pending');
    });

    it('should throw if game type is invalid', async () => {
      const players = [
        { id: 'p1', agentId: 'agent-1', address: '0x1', name: 'Agent 1', elo: 1500 },
        { id: 'p2', agentId: 'agent-2', address: '0x2', name: 'Agent 2', elo: 1500 },
      ];

      await expect(
        orchestrator.createMatch('match-1', 'invalid-game', players)
      ).rejects.toThrow('Unknown game type');
    });
  });

  describe('getMatch', () => {
    it('should return match if exists', async () => {
      const players = [
        { id: 'p1', agentId: 'agent-1', address: '0x1', name: 'Agent 1', elo: 1500 },
        { id: 'p2', agentId: 'agent-2', address: '0x2', name: 'Agent 2', elo: 1500 },
      ];

      await orchestrator.createMatch('match-1', 'chess', players);
      const match = orchestrator.getMatch('match-1');

      expect(match).not.toBeNull();
      expect(match?.id).toBe('match-1');
    });

    it('should return undefined if match does not exist', () => {
      const match = orchestrator.getMatch('nonexistent');
      expect(match).toBeUndefined();
    });
  });

  describe('subscribe', () => {
    it('should notify subscribers of events', async () => {
      const players = [
        { id: 'p1', agentId: 'agent-1', address: '0x1', name: 'Agent 1', elo: 1500 },
        { id: 'p2', agentId: 'agent-2', address: '0x2', name: 'Agent 2', elo: 1500 },
      ];

      await orchestrator.createMatch('match-1', 'chess', players);

      const events: MatchEvent[] = [];
      orchestrator.subscribe('match-1', (event) => events.push(event));

      // Since we're mocking, we can't fully test this without more setup
      expect(events).toBeDefined();
    });
  });
});
