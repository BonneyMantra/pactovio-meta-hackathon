import type { Env } from '@pactovio/contracts/env';
import { ProposalSchema, applyOutcomes, computeStats, indexRow, type BrainStats, type CompanyBrain, type Proposal, type ProposalIndexRow, type StyleProfile } from '@pactovio/brain';
import { randomToken } from './db';
import { storedOutcomes } from './brain-outcomes';

export type BrainEnv = Env & { BRAIN?: Workflow };
export const EVENT_TYPES = ['brain.learn.started', 'brain.learn.file_started', 'brain.learn.file_done', 'brain.learn.file_failed', 'brain.learn.outcomes', 'brain.learn.deriving', 'brain.learn.completed', 'brain.learn.failed'] as const;
export type BrainEventType = (typeof EVENT_TYPES)[number];

export async function addEvent(db: D1Database, ws: string, runId: string, type: BrainEventType, payload: Record<string, unknown>): Promise<void> {
  await db.prepare(`INSERT INTO brain_events (id, workspace_id, run_id, seq, type, payload_json, at)
    SELECT ?, ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ? FROM brain_events WHERE run_id = ?`)
    .bind(`be_${randomToken(8)}`, ws, runId, type, JSON.stringify(payload), new Date().toISOString(), runId).run();
}

export interface LearnedDoc { outcome_source: 'hubspot' | 'pdf'; proposal: Proposal; section_order: string[]; voice_notes: string[]; filename: string }

/** Latest-read document wins when two Drive files carry the same proposal ref. */
export async function learnedDocs(db: D1Database, ws: string): Promise<LearnedDoc[]> {
  const rows = (await db.prepare("SELECT filename, proposal_json, section_order_json, voice_notes_json FROM brain_documents WHERE workspace_id = ? AND status = 'done' ORDER BY updated_at")
    .bind(ws).all<{ filename: string; proposal_json: string; section_order_json: string | null; voice_notes_json: string | null }>()).results;
  const byRef = new Map<string, LearnedDoc>();
  for (const r of rows) {
    const parsed = ProposalSchema.safeParse(JSON.parse(r.proposal_json));
    if (!parsed.success) continue;
    byRef.set(parsed.data.ref, { outcome_source: 'pdf', proposal: parsed.data, filename: r.filename, section_order: JSON.parse(r.section_order_json ?? '[]'), voice_notes: JSON.parse(r.voice_notes_json ?? '[]') });
  }
  // Outcomes come from the CRM deals (joined by ref); refs without a deal keep the PDF-derived value.
  const joined = applyOutcomes([...byRef.values()].map((d) => d.proposal), await storedOutcomes(db, ws));
  return [...byRef.values()].map((d, i) => ({ ...d, proposal: joined[i]!.proposal, outcome_source: joined[i]!.outcome_source }));
}

export async function proposalIndex(db: D1Database, ws: string): Promise<ProposalIndexRow[]> {
  return (await learnedDocs(db, ws)).map((d) => ({ ...indexRow(d.proposal, d.filename), outcome_source: d.outcome_source })).sort((a, b) => b.date.localeCompare(a.date));
}

export async function saveBrain(db: D1Database, ws: string, runId: string, style: StyleProfile, stats: BrainStats, count: number): Promise<void> {
  await db.prepare(`INSERT INTO company_brain (workspace_id, style_json, stats_json, proposals_learned, run_id, learned_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET style_json = excluded.style_json, stats_json = excluded.stats_json, proposals_learned = excluded.proposals_learned, run_id = excluded.run_id, learned_at = excluded.learned_at`)
    .bind(ws, JSON.stringify(style), JSON.stringify(stats), count, runId, new Date().toISOString()).run();
}

export async function loadBrain(db: D1Database, ws: string): Promise<CompanyBrain> {
  const [row, ws_, cat] = await Promise.all([
    db.prepare('SELECT style_json, stats_json, proposals_learned, learned_at FROM company_brain WHERE workspace_id = ?').bind(ws).first<{ style_json: string | null; stats_json: string | null; proposals_learned: number; learned_at: string | null }>(),
    db.prepare('SELECT profile_json FROM workspaces WHERE id = ?').bind(ws).first<{ profile_json: string }>(),
    db.prepare('SELECT COUNT(*) AS n FROM products WHERE workspace_id = ?').bind(ws).first<{ n: number }>(),
  ]);
  return {
    profile: ws_ ? JSON.parse(ws_.profile_json || '{}') : {}, catalogue_count: cat?.n ?? 0, proposals_learned: row?.proposals_learned ?? 0,
    style: row?.style_json ? JSON.parse(row.style_json) : null, stats: row?.stats_json ? JSON.parse(row.stats_json) : null, learned_at: row?.learned_at ?? null,
  };
}

/** Stats on demand when the brain row is missing (e.g. a run still going): always computed in code. */
export async function liveStats(db: D1Database, ws: string): Promise<BrainStats | null> {
  const docs = await learnedDocs(db, ws);
  return docs.length ? computeStats(docs.map((d) => d.proposal)) : null;
}
