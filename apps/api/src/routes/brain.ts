import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { HttpError } from '@pactovio/contracts';
import { customerAuth } from '../lib/customer-session';
import { takeLimit } from '../lib/customer-security';
import { errorResponse } from '../lib/router';
import type { AppEnv } from '../lib/types';
import { syncHubspot } from '../lib/brain-catalogue';
import { listFolders, startLearn } from '../lib/brain-learn';
import { liveStats, loadBrain, proposalIndex, type BrainEnv } from '../lib/brain-store';

/** /api/brain (customer session only; every query is scoped to the session's workspace). */
export const brainRoutes = new Hono<AppEnv>();

const DriveId = z.string().trim().regex(/^[\w-]{6,80}$/, 'Not a Drive folder id');
const LearnInput = z.object({ folderId: DriveId, folderName: z.string().trim().max(200).optional() });
const FoldersQuery = z.object({ name: z.string().trim().max(100).optional() });
const ProgressQuery = z.object({ run_id: z.string().regex(/^brn_[a-f0-9]{20}$/).optional(), after: z.coerce.number().int().min(0).default(0) });

type Handler = (c: Context<AppEnv>, ws: string) => Promise<Response>;
const authed = (fn: Handler) => async (c: Context<AppEnv>) => {
  try {
    const auth = await customerAuth(c);
    c.set('auth', auth);
    c.header('cache-control', 'no-store');
    return await fn(c, auth.workspaceId);
  } catch (e) { c.header('cache-control', 'no-store'); return errorResponse(c, e); }
};
async function json<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  const text = await c.req.text();
  if (text.length > 4_000) throw new HttpError(413, 'The request is too large.', 'body_too_large');
  let raw: unknown;
  try { raw = text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'Send a JSON request body.', 'validation'); }
  return schema.parse(raw);
}
const env = (c: Context<AppEnv>) => c.env as BrainEnv;

brainRoutes.get('/', authed(async (c, ws) => {
  const brain = await loadBrain(c.env.DB, ws);
  if (!brain.stats) brain.stats = await liveStats(c.env.DB, ws);
  return c.json(brain);
}));

brainRoutes.get('/proposals', authed(async (c, ws) => c.json({ items: await proposalIndex(c.env.DB, ws) })));

/** Poll with `after` = last seen seq. The run is always looked up inside the caller's workspace. */
brainRoutes.get('/progress', authed(async (c, ws) => {
  const q = ProgressQuery.parse(c.req.query());
  const run = await c.env.DB.prepare(`SELECT id, folder_id, folder_name, status, total, done, failed, current_title, cost_usd, error, started_at, finished_at FROM brain_learn_runs
    WHERE workspace_id = ? ${q.run_id ? 'AND id = ?' : ''} ORDER BY started_at DESC LIMIT 1`).bind(...(q.run_id ? [ws, q.run_id] : [ws])).first<Record<string, unknown>>();
  if (!run) return c.json({ run: null, events: [], last_seq: 0 });
  const events = (await c.env.DB.prepare('SELECT seq, type, payload_json, at FROM brain_events WHERE run_id = ? AND workspace_id = ? AND seq > ? ORDER BY seq LIMIT 200')
    .bind(run.id, ws, q.after).all<{ seq: number; type: string; payload_json: string; at: string }>()).results
    .map((e) => ({ seq: e.seq, type: e.type, payload: JSON.parse(e.payload_json), at: e.at }));
  return c.json({ run, events, last_seq: events.at(-1)?.seq ?? q.after });
}));

brainRoutes.get('/drive/folders', authed(async (c, ws) => {
  const q = FoldersQuery.parse(c.req.query());
  await takeLimit(c.env.DB, `brain-folders:${ws}`, 60, 3600);
  return c.json({ folders: await listFolders(env(c), ws, q.name) });
}));

brainRoutes.post('/drive/learn', authed(async (c, ws) => {
  const input = await json(c, LearnInput);
  await takeLimit(c.env.DB, `brain-learn:${ws}`, 6, 3600);
  return c.json(await startLearn(env(c), ws, input.folderId, input.folderName), 202);
}));

brainRoutes.post('/hubspot/sync', authed(async (c, ws) => {
  await takeLimit(c.env.DB, `brain-hubspot:${ws}`, 12, 3600);
  return c.json(await syncHubspot(env(c), ws));
}));
