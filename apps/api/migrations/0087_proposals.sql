-- Bid engine: RFQ document -> evidence-backed proposal. Additive tables; workspace-scoped.
CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  source TEXT NOT NULL DEFAULT 'upload',
  intake_id TEXT,
  input_json TEXT NOT NULL DEFAULT '{}',
  state_json TEXT NOT NULL DEFAULT '{}',
  proposal_json TEXT,
  orchestrator TEXT,
  error TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_proposals_workspace ON proposals(workspace_id, created_at DESC);

CREATE TABLE proposal_steps (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','ok','error','skipped')),
  models_json TEXT NOT NULL DEFAULT '[]',
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (proposal_id, name)
);
CREATE INDEX idx_proposal_steps_proposal ON proposal_steps(proposal_id);
