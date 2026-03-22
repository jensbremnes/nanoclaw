-- Second Brain — Supabase schema
-- Run once in the Supabase SQL editor or via psql

-- Items table
CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  type text CHECK (type IN ('task', 'idea', 'reflection', 'note')),
  status text DEFAULT 'open' CHECK (status IN ('open', 'done', 'archived')),
  tags text[] DEFAULT '{}',
  source text CHECK (source IN ('discord', 'voice', 'notion')),
  notion_id text,
  captured_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- User meta table (weekly reflection target)
CREATE TABLE IF NOT EXISTS user_meta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation text,
  week_start date,
  created_at timestamptz DEFAULT now()
);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_items_fts ON items USING gin(to_tsvector('english', content));

-- Sync and lookup indexes
CREATE INDEX IF NOT EXISTS idx_items_notion_id ON items (notion_id);
CREATE INDEX IF NOT EXISTS idx_items_last_synced_at ON items (last_synced_at);
CREATE INDEX IF NOT EXISTS idx_items_updated_at ON items (updated_at);
CREATE INDEX IF NOT EXISTS idx_items_status ON items (status);
CREATE INDEX IF NOT EXISTS idx_items_captured_at ON items (captured_at);

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS items_updated_at ON items;
CREATE TRIGGER items_updated_at
BEFORE UPDATE ON items
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
