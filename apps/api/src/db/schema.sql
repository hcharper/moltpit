-- MoltPit Database Schema
-- Run this in your Supabase SQL Editor to create all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============ Core Tables ============

-- Tournaments
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chain_id INTEGER NOT NULL DEFAULT 8453,
  contract_tournament_id INTEGER,
  name TEXT NOT NULL,
  game_type TEXT NOT NULL DEFAULT 'chess',
  entry_fee TEXT NOT NULL DEFAULT '0',
  prize_pool TEXT NOT NULL DEFAULT '0',
  max_participants INTEGER NOT NULL DEFAULT 8,
  bracket_type TEXT NOT NULL DEFAULT 'single_elimination',
  status TEXT NOT NULL DEFAULT 'registration',
  registration_ends_at TIMESTAMPTZ,
  starts_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chain_id, contract_tournament_id)
);

-- Agents (bots/players)
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address TEXT NOT NULL UNIQUE,
  name TEXT,
  elo_chess INTEGER DEFAULT 1500,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tournament participants
CREATE TABLE IF NOT EXISTS tournament_participants (
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  agent_hash TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tournament_id, agent_id)
);

-- Matches
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
  game_type TEXT NOT NULL DEFAULT 'chess',
  round INTEGER,
  white_agent_id UUID REFERENCES agents(id),
  black_agent_id UUID REFERENCES agents(id),
  status TEXT NOT NULL DEFAULT 'pending',
  winner_id UUID REFERENCES agents(id),
  result_reason TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============ Proof & Audit Tables ============

-- Match proofs (for on-chain verification)
CREATE TABLE IF NOT EXISTS match_proofs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE UNIQUE,
  final_fen TEXT NOT NULL,
  pgn TEXT NOT NULL,
  move_count INTEGER NOT NULL,
  end_condition TEXT NOT NULL,
  winner_address TEXT,
  is_draw BOOLEAN DEFAULT FALSE,
  proof_hash TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  verified_on_chain BOOLEAN DEFAULT FALSE,
  chain_tx_hash TEXT
);

-- Individual moves (full game record)
CREATE TABLE IF NOT EXISTS match_moves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  move_number INTEGER NOT NULL,
  player_id UUID REFERENCES agents(id),
  san TEXT NOT NULL,
  fen_after TEXT NOT NULL,
  thinking_time_ms INTEGER,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Elo history tracking
CREATE TABLE IF NOT EXISTS elo_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
  game_type TEXT NOT NULL,
  old_elo INTEGER NOT NULL,
  new_elo INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============ Indexes ============

CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_game_type ON tournaments(game_type);
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_match_moves_match ON match_moves(match_id);
CREATE INDEX IF NOT EXISTS idx_agents_address ON agents(address);
CREATE INDEX IF NOT EXISTS idx_elo_history_agent ON elo_history(agent_id);

-- ============ Row Level Security (RLS) ============

-- Enable RLS on all tables
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE elo_history ENABLE ROW LEVEL SECURITY;

-- Public read access for all tables (MoltPit is transparent)
CREATE POLICY "Public read access" ON tournaments FOR SELECT USING (true);
CREATE POLICY "Public read access" ON agents FOR SELECT USING (true);
CREATE POLICY "Public read access" ON tournament_participants FOR SELECT USING (true);
CREATE POLICY "Public read access" ON matches FOR SELECT USING (true);
CREATE POLICY "Public read access" ON match_proofs FOR SELECT USING (true);
CREATE POLICY "Public read access" ON match_moves FOR SELECT USING (true);
CREATE POLICY "Public read access" ON elo_history FOR SELECT USING (true);

-- Server can insert/update (use service_role key in API)
CREATE POLICY "Service insert" ON tournaments FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update" ON tournaments FOR UPDATE USING (true);
CREATE POLICY "Service insert" ON agents FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update" ON agents FOR UPDATE USING (true);
CREATE POLICY "Service insert" ON tournament_participants FOR INSERT WITH CHECK (true);
CREATE POLICY "Service insert" ON matches FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update" ON matches FOR UPDATE USING (true);
CREATE POLICY "Service insert" ON match_proofs FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update" ON match_proofs FOR UPDATE USING (true);
CREATE POLICY "Service insert" ON match_moves FOR INSERT WITH CHECK (true);
CREATE POLICY "Service insert" ON elo_history FOR INSERT WITH CHECK (true);

-- ============ Comments ============

COMMENT ON TABLE tournaments IS 'MoltPit tournament records';
COMMENT ON TABLE agents IS 'AI agents and their stats';
COMMENT ON TABLE matches IS 'Individual match records';
COMMENT ON TABLE match_proofs IS 'Cryptographic proofs for on-chain verification';
COMMENT ON TABLE match_moves IS 'Complete move history for audit trail';
COMMENT ON TABLE elo_history IS 'Elo rating changes over time';
