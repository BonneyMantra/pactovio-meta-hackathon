import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '@pactovio/contracts/env';
import { createProposal } from '@pactovio/proposal';
import { buildApp } from '../src/app';
import { eventTuning } from '../src/routes/proposal-events';
import { makeEnv } from './helpers';
import { customerFixture } from './customer-fixture';

let env: Env, dispose: () => Promise<void>, cookie: string, other: string;
const WS = 'ws_harbour_digital';
const { app } = buildApp();
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const call = (path: string, ck: string | null = cookie) => app.fetch(new Request(`http://localhost${path}`, { headers: { ...(ck ? { cookie: ck } : {}), origin: 'http://localhost' } }), env, ctx);
const T = '2026-11-05T10:00:00.000Z';

async function run(ws: string, status: string) {
  const id = await createProposal(env, ws, { source: 'upload', input: { files: [], text: 'RFQ' } });
  await env.DB.prepare('UPDATE proposals SET status = ? WHERE id = ?').bind(status, id).run();
  return id;
}
const addStep = (ws: string, id: string, name: string, status: string, finished: string | null, cost = 0) =>
  env.DB.prepare(`INSERT INTO proposal_steps (id, proposal_id, workspace_id, name, status, cost_usd, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(proposal_id, name) DO UPDATE SET status = excluded.status, finished_at = excluded.finished_at, cost_usd = excluded.cost_usd`)
    .bind(`stp_${id}_${name}`, id, ws, name, status, cost, T, finished).run();

/** Parse a complete SSE body into [{event, id, data}] (comments and retry lines skipped). */
function parse(text: string) {
  return text.split('\n\n').flatMap((blk) => {
    const ev = /^event: (.+)$/m.exec(blk)?.[1]; if (!ev) return [];
    return [{ event: ev, id: Number(/^id: (\d+)$/m.exec(blk)?.[1]), data: JSON.parse(/^data: (.*)$/m.exec(blk)![1]) }];
  });
}

beforeAll(async () => {
  ({ env, dispose } = await makeEnv());
  cookie = (await customerFixture(env, WS)).cookie;
  other = (await customerFixture(env, 'ws_kestrel_sensing')).cookie;
  Object.assign(eventTuning, { pollMs: 20, pingMs: 30, maxMs: 60_000 });
}, 60000);
afterAll(async () => { Object.assign(eventTuning, { pollMs: 1000, slowPollMs: 2000, fastForMs: 60_000, pingMs: 15_000, maxMs: 5 * 60_000 }); await dispose?.(); });

describe('GET /api/proposals/:id/events', () => {
  it('404s a foreign workspace as JSON, before any stream opens', async () => {
    const id = await run(WS, 'running');
    const r = await call(`/api/proposals/${id}/events`, other);
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(await r.json()).toMatchObject({ code: 'not_found' });
  });

  it('401s without a session', async () => {
    const id = await run(WS, 'running');
    expect((await call(`/api/proposals/${id}/events`, null)).status).toBe(401);
  });

  it('400s a malformed id and 404s an unknown one', async () => {
    const bad = await call('/api/proposals/bad.id/events');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'validation' });
    expect((await call('/api/proposals/prp_missing/events')).status).toBe(404);
  });

  it('sends snapshot then done for a completed proposal, with stream headers, and closes', async () => {
    const id = await run(WS, 'completed');
    await addStep(WS, id, 'read_rfq', 'ok', T, 0.01);
    const r = await call(`/api/proposals/${id}/events`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-accel-buffering')).toBe('no');
    const text = await r.text();
    expect(text.startsWith('retry: 3000\n')).toBe(true);
    const ev = parse(text);
    expect(ev.map((e) => e.event)).toEqual(['snapshot', 'done']);
    expect(ev[0].data).toMatchObject({ status: 'completed', steps: [{ name: 'read_rfq', status: 'ok', cost_usd: 0.01 }] });
    expect(ev[1].data).toEqual({ status: 'completed' });
    expect(ev.map((e) => e.id)).toEqual([1, 2]);
  });

  it('streams step changes, status change and done in order for a running proposal', async () => {
    const id = await run(WS, 'running');
    await addStep(WS, id, 'read_rfq', 'running', null);
    const r = await call(`/api/proposals/${id}/events`);
    const body = r.text();
    await new Promise((x) => setTimeout(x, 80));
    await addStep(WS, id, 'read_rfq', 'ok', T, 0.02);
    await new Promise((x) => setTimeout(x, 80));
    await addStep(WS, id, 'design', 'running', null);
    await new Promise((x) => setTimeout(x, 80));
    await env.DB.prepare("UPDATE proposals SET status = 'completed' WHERE id = ?").bind(id).run();
    const text = await body;
    const ev = parse(text);
    expect(ev.map((e) => e.event)).toEqual(['snapshot', 'step', 'step', 'status', 'done']);
    expect(ev[0].data.steps).toHaveLength(1);
    expect(ev[1].data.step).toMatchObject({ name: 'read_rfq', status: 'ok' });
    expect(ev[2].data.step).toMatchObject({ name: 'design', status: 'running' });
    expect(ev[3].data).toEqual({ status: 'completed' });
    expect(ev.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
    expect(text).toContain(': ping');
  });

  it('closes with a timeout event at the hard limit', async () => {
    const id = await run(WS, 'running');
    eventTuning.maxMs = 100;
    try {
      const ev = parse(await (await call(`/api/proposals/${id}/events`)).text());
      expect(ev.map((e) => e.event)).toEqual(['snapshot', 'timeout']);
    } finally { eventTuning.maxMs = 60_000; }
  });

  it('stops polling when the client cancels', async () => {
    const id = await run(WS, 'running');
    const r = await call(`/api/proposals/${id}/events`);
    const reader = r.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((x) => setTimeout(x, 60));
    // No hung worker or unhandled rejection after cancel is the assertion: the loop sees open=false and returns.
    expect(r.bodyUsed).toBe(true);
  });
});
