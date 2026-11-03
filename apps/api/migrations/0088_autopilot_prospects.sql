-- Gmail autopilot, per-message ledger and workspace prospects (Meta hackathon, B3).
CREATE TABLE autopilot_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  enabled INTEGER NOT NULL DEFAULT 0,
  threshold REAL NOT NULL DEFAULT 0.7,
  cursor_ms INTEGER,
  last_checked_at TEXT,
  updated_at TEXT NOT NULL
);

-- One row per mailbox message: idempotency key and the Inbox's classification/proposal view. Rows are never deleted.
CREATE TABLE autopilot_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  message_id TEXT NOT NULL,
  intake_id TEXT REFERENCES intakes(id),
  kind TEXT NOT NULL CHECK (kind IN ('rfq','rfp','design_request','tender_notice','marketing','other')),
  confidence REAL NOT NULL,
  reason TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('proposal','ignored','needs_review','autopilot_off')),
  proposal_run_id TEXT,
  proposal_id TEXT,
  proposal_status TEXT CHECK (proposal_status IN ('queued','running','ready','failed','not_configured')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, message_id)
);
CREATE INDEX idx_autopilot_messages_ws ON autopilot_messages(workspace_id, created_at DESC);
CREATE INDEX idx_autopilot_messages_intake ON autopilot_messages(intake_id);

CREATE TABLE prospects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  org TEXT NOT NULL,
  country TEXT,
  signal TEXT NOT NULL,
  source_url TEXT NOT NULL,
  published_at TEXT,
  fit_reason TEXT NOT NULL,
  suggested_products_json TEXT NOT NULL DEFAULT '[]',
  draft_outreach_email TEXT NOT NULL,
  focus TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, source_url, org)
);
CREATE INDEX idx_prospects_ws ON prospects(workspace_id, created_at DESC);
