import { z } from 'zod';
import { HttpError } from '@pactovio/contracts';
import type { Env } from '@pactovio/contracts/env';
import type { Proposal } from './schema';

/**
 * Human review of a finished proposal: text edits to the narrative fields, then approval. An edit after approval
 * withdraws it, so what is approved is always what will be sent. Numbers (prices, quantities) are not editable here.
 */
const Path = z.union([
  z.enum(['title', 'executive_summary', 'solution_overview']),
  z.string().regex(/^(executive_summary|solution_overview)\.p\d{1,2}$/),
  z.string().regex(/^(requirement_understanding|assumptions|exclusions)\.\d{1,3}$/),
]);
export const ReviewInput = z.union([
  z.object({ action: z.literal('approve') }).strict(),
  z.object({ edits: z.array(z.object({ path: Path, text: z.string().trim().min(1).max(4000) }).strict()).min(1).max(20) }).strict(),
]);
export type ReviewInput = z.infer<typeof ReviewInput>;
export interface Review { status: 'in_review' | 'approved'; approved_at: string | null; approved_by: string | null; edits: number; edited_at: string | null }

type Editable = Proposal & { review?: Review };

function applyEdit(p: Editable, path: string, text: string): void {
  const [field, at] = path.split('.') as [string, string | undefined];
  if (field === 'title' || ((field === 'executive_summary' || field === 'solution_overview') && !at)) { (p as Record<string, unknown>)[field] = text; return; }
  if (field === 'executive_summary' || field === 'solution_overview') {
    const paras = String(p[field] ?? '').split(/\n{2,}/).filter(Boolean);
    const i = Number(at!.slice(1));
    if (i >= paras.length) throw new HttpError(400, `${path} does not exist`, 'validation');
    paras[i] = text.replace(/\n{2,}/g, '\n');
    p[field] = paras.join('\n\n');
    return;
  }
  const arr = p[field as 'assumptions' | 'exclusions' | 'requirement_understanding'];
  const i = Number(at);
  if (!Array.isArray(arr) || i >= arr.length) throw new HttpError(400, `${path} does not exist`, 'validation');
  arr[i] = text;
}

export async function reviewProposal(env: Pick<Env, 'DB'>, workspaceId: string, id: string, input: ReviewInput, by: string): Promise<Review> {
  const row = await env.DB.prepare('SELECT status, proposal_json FROM proposals WHERE id = ? AND workspace_id = ?').bind(id, workspaceId).first<{ status: string; proposal_json: string | null }>();
  if (!row) throw new HttpError(404, 'Proposal not found', 'not_found');
  if (row.status !== 'completed' || !row.proposal_json) throw new HttpError(409, 'This proposal is still being written', 'not_ready');
  const p = JSON.parse(row.proposal_json) as Editable;
  const prev: Review = p.review ?? { status: 'in_review', approved_at: null, approved_by: null, edits: 0, edited_at: null };
  const t = new Date().toISOString();
  let review: Review;
  if ('action' in input) review = { ...prev, status: 'approved', approved_at: t, approved_by: by };
  else {
    for (const e of input.edits) applyEdit(p, e.path, e.text);
    review = { ...prev, status: 'in_review', approved_at: null, approved_by: null, edits: prev.edits + input.edits.length, edited_at: t };
  }
  p.review = review;
  // updated_at stays the run's finish time (the rail shows run duration from it); the review carries its own times.
  await env.DB.prepare('UPDATE proposals SET proposal_json = ?, title = ? WHERE id = ? AND workspace_id = ?').bind(JSON.stringify(p), p.title, id, workspaceId).run();
  return review;
}
