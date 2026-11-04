/**
 * GET /api/proposals/:id/events: server-sent events for one proposal run (additive; GET /:id polling is unchanged).
 *
 * Auth: the same customer session middleware as every proposal route. An id outside the caller's workspace (or unknown) is a
 * JSON 404 { error, code: 'not_found' } before any stream opens; a malformed id is a JSON 400 { code: 'validation' }.
 *
 * Wire format (UTF-8, `retry: 3000` first, every data event carries a monotonic `id:`):
 *   event: snapshot  data {status, steps[]}              once, immediately (steps have the GET /:id shape)
 *   event: step      data {step}                         a step whose (status, finished_at, cost_usd) changed, or a new step
 *   event: status    data {status}                       the proposal status changed
 *   event: done      data {status}                       status is completed|failed; the stream then closes
 *   event: timeout   data {afterMs}                      5 minute cap reached; reconnecting gets a fresh snapshot
 *   event: fault     data {error, code}                  the poll failed repeatedly or the proposal vanished; the stream closes
 *                                                        (named `fault`, not `error`, so it never collides with EventSource's own error event)
 *   : ping                                               comment every 15 s to keep proxies open
 * Within one tick step events precede the status event. D1 cost per tick: one status SELECT plus one listSteps. Polls every 1 s for the
 * first minute, then every 2 s, and stops at 5 minutes: at most ~360 D1 queries per stream, well inside a Worker invocation's
 * subrequest budget. Opens are rate-limited per workspace. Clients must close() on `done` (EventSource otherwise reconnects).
 * Stops polling when the client disconnects.
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import { HttpError } from '@pactovio/contracts';
import { getProposalRow, listSteps, type StepView } from '@pactovio/proposal';
import type { Env } from '@pactovio/contracts/env';
import { takeLimit } from '../lib/customer-security';
import type { AppEnv } from '../lib/types';

/** Timing knobs. Production values; tests shrink them. */
export const eventTuning = { pollMs: 1000, slowPollMs: 2000, fastForMs: 60_000, pingMs: 15_000, maxMs: 5 * 60_000 };

const ProposalId = z.string().regex(/^[\w-]{1,64}$/, 'Invalid proposal id');
const TERMINAL = new Set(['completed', 'failed']);
const sig = (s: StepView) => `${s.status}|${s.finished_at ?? ''}|${s.cost_usd}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function statusOf(env: Pick<Env, 'DB'>, ws: string, id: string): Promise<string | null> {
  return (await env.DB.prepare('SELECT status FROM proposals WHERE id = ? AND workspace_id = ?').bind(id, ws).first<{ status: string }>())?.status ?? null;
}

export function mountProposalEvents(router: Hono<AppEnv>): void {
  router.get('/:id/events', async (c) => {
    const ws = c.get('auth').workspaceId, env = c.env;
    const id = ProposalId.parse(c.req.param('id'));
    const row = await getProposalRow(env, ws, id);
    await takeLimit(env.DB, `proposal-events:${ws}`, 240, 3600);
    const signal = c.req.raw.signal;
    const enc = new TextEncoder();
    let open = true, seq = 0;

    const body = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        const raw = (s: string) => { if (open) { try { ctrl.enqueue(enc.encode(s)); } catch { open = false; } } };
        const send = (event: string, data: unknown) => raw(`event: ${event}\nid: ${++seq}\ndata: ${JSON.stringify(data)}\n\n`);
        const started = Date.now();
        let lastPing = started, status: string = row.status, failures = 0;
        const known = new Map<string, string>();
        try {
          raw('retry: 3000\n\n');
          const first = await listSteps(env, ws, id);
          for (const s of first) known.set(s.name, sig(s));
          send('snapshot', { status, steps: first });
          while (open && !signal.aborted && !TERMINAL.has(status)) {
            if (Date.now() - started >= eventTuning.maxMs) { send('timeout', { afterMs: eventTuning.maxMs }); return; }
            await sleep(Date.now() - started < eventTuning.fastForMs ? eventTuning.pollMs : eventTuning.slowPollMs);
            if (!open || signal.aborted) return;
            try {
              const now = await statusOf(env, ws, id);
              if (now === null) { send('fault', { error: 'Proposal not found', code: 'not_found' }); return; }
              const steps = await listSteps(env, ws, id);
              failures = 0;
              for (const s of steps) { const k = sig(s); if (known.get(s.name) !== k) { known.set(s.name, k); send('step', { step: s }); } }
              if (now !== status) { status = now; send('status', { status }); }
            } catch {
              if (++failures >= 3) { send('fault', { error: 'The progress feed was interrupted', code: 'internal' }); return; }
            }
            if (Date.now() - lastPing >= eventTuning.pingMs) { lastPing = Date.now(); raw(': ping\n\n'); }
          }
          if (TERMINAL.has(status)) send('done', { status });
        } catch {
          send('fault', { error: 'The progress feed could not be started', code: 'internal' });
        } finally {
          open = false;
          try { ctrl.close(); } catch { /* already closed by the client */ }
        }
      },
      cancel() { open = false; },
    });

    return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
  });
}
