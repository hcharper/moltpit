import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Database types for MoltPit
export interface Database {
  public: {
    Tables: {
      tournaments: {
        Row: {
          id: string;
          chain_id: number;
          contract_tournament_id: number | null;
          name: string;
          game_type: string;
          entry_fee: string;
          prize_pool: string;
          max_participants: number;
          bracket_type: string;
          status: string;
          registration_ends_at: string | null;
          starts_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['tournaments']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['tournaments']['Insert']>;
      };
      agents: {
        Row: {
          id: string;
          address: string;
          name: string | null;
          elo_chess: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['agents']['Row'], 'id' | 'created_at' | 'elo_chess'>;
        Update: Partial<Database['public']['Tables']['agents']['Insert']>;
      };
      tournament_participants: {
        Row: {
          tournament_id: string;
          agent_id: string;
          agent_hash: string;
          joined_at: string;
        };
        Insert: Omit<Database['public']['Tables']['tournament_participants']['Row'], 'joined_at'>;
        Update: Partial<Database['public']['Tables']['tournament_participants']['Insert']>;
      };
      matches: {
        Row: {
          id: string;
          tournament_id: string | null;
          game_type: string;
          round: number | null;
          white_agent_id: string | null;
          black_agent_id: string | null;
          status: string;
          winner_id: string | null;
          result_reason: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['matches']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['matches']['Insert']>;
      };
      match_proofs: {
        Row: {
          id: string;
          match_id: string;
          final_fen: string;
          pgn: string;
          move_count: number;
          end_condition: string;
          winner_address: string | null;
          is_draw: boolean;
          proof_hash: string;
          submitted_at: string;
          verified_on_chain: boolean;
          chain_tx_hash: string | null;
        };
        Insert: Omit<Database['public']['Tables']['match_proofs']['Row'], 'id' | 'submitted_at'>;
        Update: Partial<Database['public']['Tables']['match_proofs']['Insert']>;
      };
      match_moves: {
        Row: {
          id: string;
          match_id: string;
          move_number: number;
          player_id: string;
          san: string;
          fen_after: string;
          thinking_time_ms: number | null;
          timestamp: string;
        };
        Insert: Omit<Database['public']['Tables']['match_moves']['Row'], 'id' | 'timestamp'>;
        Update: Partial<Database['public']['Tables']['match_moves']['Insert']>;
      };
      elo_history: {
        Row: {
          id: string;
          agent_id: string;
          match_id: string;
          game_type: string;
          old_elo: number;
          new_elo: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['elo_history']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['elo_history']['Insert']>;
      };
    };
  };
}

let supabase: SupabaseClient<Database> | null = null;

/**
 * Get or create Supabase client
 * Falls back to in-memory storage if not configured
 */
export function getSupabase(): SupabaseClient<Database> | null {
  if (supabase) return supabase;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️  Supabase not configured - using in-memory storage');
    console.warn('   Set SUPABASE_URL and SUPABASE_ANON_KEY for persistence');
    return null;
  }

  supabase = createClient<Database>(supabaseUrl, supabaseKey);
  console.log('✅ Supabase connected');
  return supabase;
}

/**
 * Check if Supabase is available
 */
export function isSupabaseEnabled(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

// ============ Tournament Operations ============

export async function dbCreateTournament(tournament: Database['public']['Tables']['tournaments']['Insert']) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('tournaments')
    .insert(tournament)
    .select()
    .single();

  if (error) {
    console.error('Error creating tournament:', error);
    return null;
  }
  return data;
}

export async function dbGetTournament(id: string) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('tournaments')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

export async function dbListTournaments(status?: string) {
  const db = getSupabase();
  if (!db) return null;

  let query = db.from('tournaments').select('*').order('created_at', { ascending: false });
  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) return null;
  return data;
}

export async function dbUpdateTournament(id: string, update: Database['public']['Tables']['tournaments']['Update']) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('tournaments')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) return null;
  return data;
}

// ============ Agent Operations ============

export async function dbGetOrCreateAgent(address: string, name?: string) {
  const db = getSupabase();
  if (!db) return null;

  // Try to get existing agent
  const { data: existing } = await db
    .from('agents')
    .select('*')
    .eq('address', address.toLowerCase())
    .single();

  if (existing) return existing;

  // Create new agent
  const { data, error } = await db
    .from('agents')
    .insert({ address: address.toLowerCase(), name: name || null })
    .select()
    .single();

  if (error) {
    console.error('Error creating agent:', error);
    return null;
  }
  return data;
}

export async function dbUpdateAgentElo(agentId: string, newElo: number) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('agents')
    .update({ elo_chess: newElo })
    .eq('id', agentId)
    .select()
    .single();

  if (error) return null;
  return data;
}

// ============ Match Operations ============

export async function dbCreateMatch(match: Database['public']['Tables']['matches']['Insert']) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('matches')
    .insert(match)
    .select()
    .single();

  if (error) {
    console.error('Error creating match:', error);
    return null;
  }
  return data;
}

export async function dbUpdateMatch(id: string, update: Database['public']['Tables']['matches']['Update']) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('matches')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) return null;
  return data;
}

export async function dbGetMatch(id: string) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('matches')
    .select('*, white_agent:agents!white_agent_id(*), black_agent:agents!black_agent_id(*)')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

// ============ Match Proof Operations ============

export async function dbSaveMatchProof(proof: Database['public']['Tables']['match_proofs']['Insert']) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('match_proofs')
    .insert(proof)
    .select()
    .single();

  if (error) {
    console.error('Error saving match proof:', error);
    return null;
  }
  return data;
}

export async function dbMarkProofVerified(matchId: string, txHash: string) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('match_proofs')
    .update({ verified_on_chain: true, chain_tx_hash: txHash })
    .eq('match_id', matchId)
    .select()
    .single();

  if (error) return null;
  return data;
}

// ============ Match Moves Operations ============

export async function dbSaveMove(move: Database['public']['Tables']['match_moves']['Insert']) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('match_moves')
    .insert(move)
    .select()
    .single();

  if (error) return null;
  return data;
}

export async function dbGetMatchMoves(matchId: string) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('match_moves')
    .select('*')
    .eq('match_id', matchId)
    .order('move_number', { ascending: true });

  if (error) return null;
  return data;
}

// ============ Elo History ============

export async function dbSaveEloChange(history: Database['public']['Tables']['elo_history']['Insert']) {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from('elo_history')
    .insert(history)
    .select()
    .single();

  if (error) return null;
  return data;
}
