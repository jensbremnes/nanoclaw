-- PARA Upgrade — run once in Supabase SQL editor or via psql
-- All changes are additive (nullable columns, new tables) — zero risk to existing data.

-- ---------------------------------------------------------------------------
-- New tables (goals first — projects references it)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS goals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  target_date date,
  status      text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  notion_id   text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  description   text,
  status        text DEFAULT 'active'
                  CHECK (status IN ('active', 'on_hold', 'completed', 'archived')),
  para_category text DEFAULT 'projects'
                  CHECK (para_category IN ('projects', 'areas', 'resources')),
  goal_id       uuid REFERENCES goals(id) ON DELETE SET NULL,
  notion_id     text,
  tags          text[] DEFAULT '{}',
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weekly_digests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start     date NOT NULL UNIQUE,
  content        text NOT NULL,
  notion_id      text,
  generated_at   timestamptz DEFAULT now(),
  last_synced_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Updated_at triggers for new tables
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS goals_updated_at ON goals;
CREATE TRIGGER goals_updated_at
  BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- New columns on items (all nullable — no breaking changes)
-- ---------------------------------------------------------------------------

ALTER TABLE items ADD COLUMN IF NOT EXISTS elaboration              text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS elaboration_generated_at timestamptz;
ALTER TABLE items ADD COLUMN IF NOT EXISTS elaboration_synced_at    timestamptz;
ALTER TABLE items ADD COLUMN IF NOT EXISTS notion_hub_page_id       text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS related_item_ids         uuid[] DEFAULT '{}';
ALTER TABLE items ADD COLUMN IF NOT EXISTS project_id               uuid REFERENCES projects(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_goals_status    ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_notion_id ON goals(notion_id);

CREATE INDEX IF NOT EXISTS idx_projects_status        ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_notion_id     ON projects(notion_id);
CREATE INDEX IF NOT EXISTS idx_projects_para_category ON projects(para_category);

CREATE INDEX IF NOT EXISTS idx_weekly_digests_week_start ON weekly_digests(week_start);

CREATE INDEX IF NOT EXISTS idx_items_elaboration_null ON items(id)
  WHERE elaboration IS NULL AND status != 'archived';

CREATE INDEX IF NOT EXISTS idx_items_notion_hub_page_id ON items(notion_hub_page_id);
CREATE INDEX IF NOT EXISTS idx_items_project_id         ON items(project_id);
