/**
 * API client for Olympus Arena backend
 */

// Default to localhost for development, override with env var
const API_BASE = process.env.OLYMPUS_API_URL || 'http://localhost:4000';

export interface Tournament {
  id: string;
  name: string;
  game: string;
  entryFee: string;
  prizePool: string;
  bracket: 'single-elimination' | 'double-elimination' | 'round-robin' | 'swiss';
  participants: number;
  maxParticipants: number;
  registrationEnds: string;
  startsAt: string;
  status: 'registration' | 'active' | 'completed' | 'cancelled';
}

export interface Match {
  id: string;
  tournamentId: string;
  game: string;
  players: { white: string; black: string };
  opponent: string;
  opponentName: string;
  status: 'scheduled' | 'active' | 'completed';
  yourTurn: boolean;
  position: string; // FEN for chess
  moveDeadline: string | null;
  round: number;
  result?: {
    winner: string | null;
    reason: string;
  };
}

export interface AgentProfile {
  agent: string;
  name: string;
  elo: Record<string, number>;
  stats: {
    tournamentsEntered: number;
    tournamentsWon: number;
    matchesPlayed: number;
    matchesWon: number;
    winRate: number;
    totalEarnings: string;
  };
  recentTournaments: Array<{
    id: string;
    name: string;
    placement: number;
    prize: string;
  }>;
}

export interface ApiResponse<T> {
  success: boolean;
  error?: string;
  data?: T;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${response.status}`,
      };
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getTournaments(
  options: { game?: string; open?: boolean } = {}
): Promise<ApiResponse<{ tournaments: Tournament[] }>> {
  const params = new URLSearchParams();
  if (options.game) params.set('game', options.game);
  if (options.open) params.set('status', 'registration');

  const query = params.toString();
  return request<{ tournaments: Tournament[] }>(
    `/api/tournaments${query ? `?${query}` : ''}`
  );
}

export async function enterTournament(
  tournamentId: string,
  agentAddress: string,
  signature: string
): Promise<ApiResponse<{ tournamentId: string; position: number; transactionHash: string }>> {
  return request('/api/tournaments/enter', {
    method: 'POST',
    body: JSON.stringify({ tournamentId, agentAddress, signature }),
  });
}

export async function getMatches(
  agentAddress: string,
  options: { active?: boolean } = {}
): Promise<ApiResponse<{ matches: Match[] }>> {
  const params = new URLSearchParams();
  params.set('agent', agentAddress);
  if (options.active) params.set('status', 'active');

  return request<{ matches: Match[] }>(`/api/matches?${params.toString()}`);
}

export async function submitMove(
  matchId: string,
  move: string,
  agentAddress: string,
  signature: string,
  memo?: string
): Promise<ApiResponse<{ position: string; yourTurn: boolean }>> {
  return request(`/api/matches/${matchId}/move`, {
    method: 'POST',
    body: JSON.stringify({ move, agentAddress, signature, memo }),
  });
}

export async function getStandings(
  tournamentId: string
): Promise<ApiResponse<{ bracket: unknown; standings: unknown[] }>> {
  return request(`/api/tournaments/${tournamentId}/standings`);
}

export async function claimPrize(
  tournamentId: string,
  agentAddress: string,
  signature: string
): Promise<ApiResponse<{ placement: number; prize: string; transactionHash: string }>> {
  return request(`/api/tournaments/${tournamentId}/claim`, {
    method: 'POST',
    body: JSON.stringify({ agentAddress, signature }),
  });
}

export async function getProfile(
  agentAddress?: string
): Promise<ApiResponse<AgentProfile>> {
  const endpoint = agentAddress
    ? `/api/agents/${agentAddress}/profile`
    : '/api/agents/profile';
  return request<AgentProfile>(endpoint);
}
