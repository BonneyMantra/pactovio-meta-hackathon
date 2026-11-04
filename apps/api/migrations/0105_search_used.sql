-- Web-search counter under its own name. Every search goes through the Meta Model API (Muse Spark web_search); the old
-- column judge_sessions.tavily_used is kept untouched (no destructive migration) and is no longer read or written.
ALTER TABLE judge_sessions ADD COLUMN search_used INTEGER NOT NULL DEFAULT 0;
UPDATE judge_sessions SET search_used = tavily_used;
