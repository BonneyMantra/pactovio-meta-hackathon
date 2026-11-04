-- Workspace team invites: a member invites a colleague by email; the invitee joins on first OTP sign-in.
CREATE TABLE workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL,
  invited_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')),
  created_at TEXT NOT NULL,
  sent_at TEXT,
  accepted_at TEXT,
  resend_id TEXT
);
CREATE INDEX workspace_invites_email ON workspace_invites(email, status);
CREATE UNIQUE INDEX workspace_invites_pending ON workspace_invites(workspace_id, email) WHERE status = 'pending';
