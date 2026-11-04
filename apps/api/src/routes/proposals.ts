import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { HttpError } from '@pactovio/contracts';
import { budgetMessage, inspectWav, isBudgetError, MetaApiError, MAX_AUDIO_BYTES, transcribe } from '@pactovio/models';
import { assetKey, getProposalRow, listProposalRows, listSteps, loadProposalJson, renderProposalHtml, startProposal } from '@pactovio/proposal';
import { customerAuth } from '../lib/customer-session';
import { takeLimit } from '../lib/customer-security';
import type { AppEnv } from '../lib/types';

const MAX_FILE = 15 * 1024 * 1024;
const MAX_FILES = 8;
const ALLOWED = /\.(pdf|docx|txt|eml|md|png|jpe?g|webp)$/i;
const MIME_BY_EXT: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const JsonStart = z.object({ text: z.string().trim().max(100_000).optional(), intakeId: z.string().regex(/^int_[\w]+$/).optional(), title: z.string().trim().max(200).optional() }).strict();

export const proposalRoutes = new Hono<AppEnv>();
export const voiceRoutes = new Hono<AppEnv>();

const fail = (e: unknown, c: Context<AppEnv>) => {
  if (e instanceof z.ZodError) return c.json({ error: e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '), code: 'validation' }, 400);
  if (e instanceof HttpError) return c.json({ error: e.message, code: e.code ?? 'error' }, e.status as 400);
  if (isBudgetError(e)) return c.json({ error: budgetMessage(e), code: (e as { code?: string }).code === 'models_off' ? 'models_off' : 'cap_daily' }, 429);
  if (e instanceof MetaApiError) return c.json({ error: 'The speech model could not process this audio', code: 'upstream' }, 502);
  return c.json({ error: 'The request could not be completed', code: 'internal' }, 500);
};
for (const r of [proposalRoutes, voiceRoutes]) {
  r.onError((e, c) => fail(e, c));
  r.use('*', async (c, next) => { c.header('cache-control', 'no-store'); c.set('auth', await customerAuth(c)); await next(); });
}

const mimeOf = (name: string, given: string): string => (given && given !== 'application/octet-stream' ? given : MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'text/plain');

/** Intake documents (already stored in R2 by the inbox) are copied into the proposal's own prefix; only the caller's workspace is read. */
async function intakeFiles(c: Context<AppEnv>, ws: string, intakeId: string) {
  const intake = await c.env.DB.prepare('SELECT id FROM intakes WHERE id = ? AND workspace_id = ?').bind(intakeId, ws).first();
  if (!intake) throw new HttpError(404, 'Intake not found', 'not_found');
  const docs = await c.env.DB.prepare('SELECT filename, r2_key FROM documents WHERE intake_id = ? AND (workspace_id = ? OR workspace_id IS NULL)').bind(intakeId, ws).all<{ filename: string; r2_key: string }>();
  const out: { filename: string; mime: string; bytes: Uint8Array }[] = [];
  for (const d of docs.results.slice(0, MAX_FILES)) {
    const o = await c.env.FILES.get(d.r2_key);
    if (o && ALLOWED.test(d.filename)) out.push({ filename: d.filename, mime: mimeOf(d.filename, o.httpMetadata?.contentType ?? ''), bytes: new Uint8Array(await o.arrayBuffer()) });
  }
  return out;
}

proposalRoutes.post('/', async (c) => {
  const ws = c.get('auth').workspaceId;
  await takeLimit(c.env.DB, `proposal:${ws}`, 30, 3600);
  let text: string | undefined, title: string | undefined, intakeId: string | undefined;
  const files: { filename: string; mime: string; bytes: Uint8Array }[] = [];
  if (c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    const form = await c.req.formData().catch(() => null);
    if (!form) throw new HttpError(400, 'Send multipart form data', 'validation');
    const f = JsonStart.parse(Object.fromEntries(['text', 'title', 'intakeId'].flatMap((k) => { const v = form.get(k); return typeof v === 'string' && v.trim() ? [[k, v]] : []; })));
    ({ text, title, intakeId } = f);
    for (const file of form.getAll('file')) {
      if (!(file instanceof File)) continue;
      if (!ALLOWED.test(file.name)) throw new HttpError(400, `${file.name}: supported files are PDF, DOCX, TXT, EML and images`, 'validation');
      if (file.size > MAX_FILE) throw new HttpError(400, `${file.name} is larger than 15 MB`, 'validation');
      files.push({ filename: file.name, mime: mimeOf(file.name, file.type), bytes: new Uint8Array(await file.arrayBuffer()) });
    }
  } else {
    ({ text, title, intakeId } = JsonStart.parse(await c.req.json().catch(() => ({}))));
  }
  if (files.length > MAX_FILES) throw new HttpError(400, `At most ${MAX_FILES} files per proposal`, 'validation');
  if (intakeId) files.push(...(await intakeFiles(c, ws, intakeId)));
  if (!text && !files.length) throw new HttpError(400, 'Send RFQ text, files or an intakeId', 'validation');
  const r = await startProposal(c.env, ws, { source: 'upload', files, text, intakeId, title }, (p) => c.executionCtx.waitUntil(p));
  return c.json({ proposalId: r.proposalId, status: 'queued' }, 201);
});

proposalRoutes.get('/', async (c) => {
  const ws = c.get('auth').workspaceId;
  const rows = await listProposalRows(c.env, ws);
  const meta = await c.env.DB.prepare("SELECT id, json_extract(proposal_json, '$.client.name') AS client, json_extract(proposal_json, '$.commercials.total_inr') AS total_inr, json_extract(proposal_json, '$.solution_type') AS solution_type FROM proposals WHERE workspace_id = ?").bind(ws).all<{ id: string; client: string | null; total_inr: number | null; solution_type: string | null }>();
  const m = new Map(meta.results.map((x) => [x.id, x]));
  return c.json({ items: rows.map(({ input, ...r }) => ({ ...r, files: input.files.map((f) => f.filename), client: m.get(r.id)?.client ?? null, total_inr: m.get(r.id)?.total_inr ?? null, solution_type: m.get(r.id)?.solution_type ?? null })) });
});

proposalRoutes.get('/:id', async (c) => {
  const ws = c.get('auth').workspaceId, id = c.req.param('id');
  const { input, ...row } = await getProposalRow(c.env, ws, id);
  const { proposal, state } = await loadProposalJson(c.env, ws, id);
  const partial = proposal || !state ? null : { rfq: state.rfq ?? null, selection: state.selection ?? null, design: state.design ?? null, bom_totals: state.bom?.commercials ?? null };
  return c.json({ ...row, files: input.files.map((f) => ({ filename: f.filename, size: f.size })), steps: await listSteps(c.env, ws, id), proposal, partial, models: state?.models ?? {} });
});

proposalRoutes.get('/:id/assets/:name', async (c) => {
  const ws = c.get('auth').workspaceId, id = c.req.param('id'), name = c.req.param('name');
  await getProposalRow(c.env, ws, id);
  if (!/^[\w.-]{1,80}$/.test(name)) throw new HttpError(404, 'Not found', 'not_found');
  const o = await c.env.FILES.get(assetKey(ws, id, name));
  if (!o) throw new HttpError(404, 'Not found', 'not_found');
  return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' } });
});

proposalRoutes.get('/:id/pdf', async (c) => {
  const ws = c.get('auth').workspaceId, id = c.req.param('id');
  const row = await getProposalRow(c.env, ws, id);
  const { proposal } = await loadProposalJson(c.env, ws, id);
  if (!proposal) throw new HttpError(409, row.status === 'failed' ? 'This proposal run failed' : 'The proposal is not finished yet', 'not_ready');
  const seller = (await c.env.DB.prepare('SELECT name FROM workspaces WHERE id = ?').bind(ws).first<{ name: string }>())?.name ?? 'Supplier';
  return new Response(renderProposalHtml(proposal, { seller, assetBase: `/api/proposals/${id}/assets` }), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" } });
});

/** POST /api/voice/transcribe: audio/wav body (or multipart `audio`) -> { text, seconds }. 16/24 kHz mono PCM16, up to 10 minutes. */
voiceRoutes.post('/transcribe', async (c) => {
  const ws = c.get('auth').workspaceId;
  await takeLimit(c.env.DB, `voice:${ws}`, 120, 3600);
  let wav: Uint8Array;
  if (c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    const f = (await c.req.formData().catch(() => null))?.get('audio');
    if (!(f instanceof File)) throw new HttpError(400, 'Send the recording as the "audio" part', 'validation');
    wav = new Uint8Array(await f.arrayBuffer());
  } else wav = new Uint8Array(await c.req.arrayBuffer());
  if (!wav.length || wav.length > MAX_AUDIO_BYTES) throw new HttpError(400, 'Audio must be a WAV file up to 32 MB', 'validation');
  try { inspectWav(wav); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : 'Invalid audio', 'validation'); }
  const r = await transcribe(c.env, { wav });
  return c.json({ text: r.text, seconds: Math.round(r.seconds * 10) / 10 });
});
