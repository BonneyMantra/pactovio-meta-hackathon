-- Company Brain: Drive-learned past proposals, learning runs with progress events, derived style and stats. Additive.
CREATE TABLE brain_learn_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  folder_id TEXT NOT NULL,
  folder_name TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  total INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  current_title TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX brain_runs_workspace ON brain_learn_runs(workspace_id, started_at DESC);

CREATE TABLE brain_documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  run_id TEXT NOT NULL REFERENCES brain_learn_runs(id),
  drive_file_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  r2_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reading','done','failed')),
  proposal_ref TEXT,
  proposal_json TEXT,
  section_order_json TEXT,
  voice_notes_json TEXT,
  facts_json TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, drive_file_id)
);
CREATE INDEX brain_documents_run ON brain_documents(run_id, status);

CREATE TABLE brain_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  run_id TEXT NOT NULL REFERENCES brain_learn_runs(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL,
  UNIQUE (run_id, seq)
);

CREATE TABLE company_brain (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  style_json TEXT,
  stats_json TEXT,
  proposals_learned INTEGER NOT NULL DEFAULT 0,
  run_id TEXT,
  learned_at TEXT
);

-- Deal outcomes read from the workspace's HubSpot, joined to proposals by ref.
CREATE TABLE brain_outcomes (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('won','lost','pending')),
  decided_on TEXT,
  amount_inr INTEGER,
  deal_id TEXT NOT NULL,
  dealname TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, ref)
);
