// Proposal endpoints (/api/proposals) normalised for the chat run card, the list and the document view.
import { api } from '../ui.js';

const arr = (v) => (Array.isArray(v) ? v : []);

/** Pipeline stages in run order, with the wording the bid desk sees. */
export const STAGES = [
  ['read_rfq', 'Reading the RFP pack, page by page'],
  ['select_solution', 'Matching requirements to your catalogue and past bids'],
  ['compose_bom', 'Pricing the bill of materials in your house style'],
  ['design_architecture', 'Drawing the architecture and zone wiring'],
  ['floor_plan', 'Placing devices on the floor plan'],
  ['compliance_matrix', 'Checking every requirement for compliance'],
  ['concept_visual', 'Rendering the concept visual'],
  ['claim_check', 'Checking every claim against its source'],
];

/** Truthful display name for the model that actually ran a step. */
export function modelName(id = '') {
  const s = String(id).toLowerCase();
  if (s.includes('wonder')) return 'Muse Wonder';
  if (s.includes('sam')) return 'SAM 3.1';
  if (s.includes('image')) return 'Muse Image';
  if (s.includes('transcribe') || s.includes('voice')) return 'Muse Voice Transcribe';
  if (s.includes('spark')) return 'Muse Spark';
  return null;
}
const STATUS = { ok: 'done', error: 'failed', skipped: 'done', running: 'running' };

/** Backend step rows → [{ key, label, status: done|running|failed|pending, model, summary }] in pipeline order. */
export function normaliseSteps(rows, runStatus) {
  const by = new Map(arr(rows).map((r) => [r.name, r]));
  const out = STAGES.map(([key, label]) => {
    const r = by.get(key);
    const models = [...new Set(arr(r?.models).map(modelName).filter(Boolean))];
    let status = r ? STATUS[r.status] || 'pending' : 'pending';
    if (status === 'failed' && (key === 'floor_plan' || key === 'concept_visual')) status = 'done';
    return { key, label, status, model: models.join(' + ') || null, summary: r?.summary || null, ms: r?.ms || 0, cost: r?.cost_usd || 0 };
  });
  if (runStatus === 'running' && !out.some((s) => s.status === 'running')) {
    const next = out.find((s) => s.status === 'pending');
    if (next) next.status = 'running';
  }
  if (runStatus === 'completed') for (const s of out) if (s.status !== 'failed') s.status = 'done';
  return out;
}

/** Who orchestrated the run (Wonder, or Spark when Wonder was unavailable). */
export function orchestratorName(row) {
  const o = row?.orchestrator || arr(row?.models?.orchestrate)[0] || '';
  return modelName(o) || null;
}

/** GET /api/proposals/:id → flat proposal for the document: proposal fields + id, status ('ready' when completed), steps. */
export async function getProposal(id) {
  const r = await api(`/proposals/${encodeURIComponent(id)}`);
  const status = r.status === 'completed' ? 'ready' : r.status === 'queued' ? 'running' : r.status;
  const steps = normaliseSteps(r.steps, r.status);
  const orchestrator = orchestratorName(r);
  const base = { id: r.id, status, error: r.error, steps, orchestrator, cost_usd: r.cost_usd, created_at: r.created_at, updated_at: r.updated_at, files: arr(r.files) };
  if (r.proposal) return { ...r.proposal, ...base };
  const rfq = r.partial?.rfq;
  return { ...base, title: rfq?.title || r.title || null, client: rfq?.client || null, rfq_ref: rfq?.rfq_ref || null, partial: r.partial };
}

export async function listProposals() {
  const { items } = await api('/proposals');
  return arr(items).map((p) => ({ ...p, status: p.status === 'completed' ? 'ready' : p.status === 'queued' ? 'running' : p.status }));
}

/** Start a run from the chat: the RFQ and any drawings go up as `file` parts; returns { id }. */
export async function startProposal({ file, extras = [], text = '', source = 'chat' }) {
  const form = new FormData();
  for (const f of [file, ...extras].filter(Boolean)) form.append('file', f, f.name);
  if (text) form.append('text', text);
  form.append('source', source);
  const r = await api('/proposals', { method: 'POST', body: form, signal: AbortSignal.timeout(90000) });
  return { id: r.proposalId || r.id, status: r.status };
}

/** 16 kHz mono WAV → { text, seconds }. */
export async function transcribe(wav) {
  const r = await api('/voice/transcribe', { method: 'POST', body: wav, headers: { accept: 'application/json', 'content-type': 'audio/wav' } });
  return { text: r.text || '', seconds: r.seconds || 0 };
}
