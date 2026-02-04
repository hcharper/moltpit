import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const API_BASE = 'http://localhost:4000';

describe('API E2E Tests', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.timestamp).toBeDefined();
    });
  });

  describe('Games API', () => {
    it('should list available game types', async () => {
      const res = await fetch(`${API_BASE}/api/games`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);

      const chess = data.find((g: any) => g.gameType === 'chess');
      expect(chess).toBeDefined();
      expect(chess.displayName).toBe('Chess');
    });
  });

  describe('Tournaments API', () => {
    it('should list tournaments', async () => {
      const res = await fetch(`${API_BASE}/api/tournaments`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.tournaments).toBeDefined();
      expect(Array.isArray(data.tournaments)).toBe(true);
    });

    it('should filter tournaments by game', async () => {
      const res = await fetch(`${API_BASE}/api/tournaments?game=chess`);
      const data = await res.json();

      expect(res.status).toBe(200);
      data.tournaments.forEach((t: any) => {
        expect(t.game).toBe('chess');
      });
    });

    it('should filter tournaments by status', async () => {
      const res = await fetch(`${API_BASE}/api/tournaments?status=registration`);
      const data = await res.json();

      expect(res.status).toBe(200);
      data.tournaments.forEach((t: any) => {
        expect(t.status).toBe('registration');
      });
    });

    it('should enter a tournament', async () => {
      const uniqueAddress = `0xTestAgent${Date.now()}`;
      const res = await fetch(`${API_BASE}/api/tournaments/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: 'tournament-chess-weekly-001',
          agentAddress: uniqueAddress,
          signature: '0xTestSignature',
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.tournamentId).toBe('tournament-chess-weekly-001');
      expect(data.transactionHash).toBeDefined();
      expect(data.position).toBeGreaterThan(0);
    });

    it('should reject duplicate entry', async () => {
      const uniqueAddress = `0xDuplicateAgent${Date.now()}`;
      
      // First entry
      await fetch(`${API_BASE}/api/tournaments/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: 'tournament-chess-blitz-002',
          agentAddress: uniqueAddress,
          signature: '0xTestSignature',
        }),
      });

      // Duplicate entry
      const res = await fetch(`${API_BASE}/api/tournaments/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: 'tournament-chess-blitz-002',
          agentAddress: uniqueAddress,
          signature: '0xTestSignature',
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe('Already registered');
    });
  });

  describe('Matches API', () => {
    it('should create a quick demo match', async () => {
      const res = await fetch(`${API_BASE}/api/demo/quick-match`, {
        method: 'POST',
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.matchId).toBeDefined();
      expect(data.wsRoom).toContain('match:');
    });

    it('should get match by ID', async () => {
      // Create a match first
      const createRes = await fetch(`${API_BASE}/api/demo/quick-match`, {
        method: 'POST',
      });
      const createData = await createRes.json();

      // Wait a moment for match to initialize
      await new Promise((r) => setTimeout(r, 500));

      // Get match details
      const res = await fetch(`${API_BASE}/api/matches/${createData.matchId}`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.matchId).toBe(createData.matchId);
      expect(data.gameType).toBe('chess');
    });

    it('should list matches for an agent', async () => {
      const res = await fetch(`${API_BASE}/api/matches?agent=0xTestAgent123`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.matches).toBeDefined();
      expect(Array.isArray(data.matches)).toBe(true);
    });

    it('should submit a move', async () => {
      const res = await fetch(`${API_BASE}/api/matches/match-demo-001/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          move: 'e7e5',
          agentAddress: '0xTestAgent',
          signature: '0xTestSig',
          memo: 'Testing move submission',
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.position).toBeDefined();
    });
  });

  describe('Agent Profile API', () => {
    it('should get agent profile', async () => {
      const res = await fetch(`${API_BASE}/api/agents/0xTestAgent123/profile`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.agent).toBe('0xTestAgent123');
      expect(data.elo).toBeDefined();
      expect(data.stats).toBeDefined();
    });
  });
});
