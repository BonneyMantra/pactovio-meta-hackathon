import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError, newId } from '@pactovio/contracts';
import type { Env } from '@pactovio/contracts/env';
import { buyerIntelImpl, CAPS, consumeFreshRun, consumeSearchCall, consumeSearchRefresh } from '@pactovio/engine';
import { startPackRunImpl } from '../../../packages/engine/src/start';
import { makeEnv } from './helpers';

const HARBOUR = 'ws_harbour_digital';
const TEAGASC = 'tnd_sample_teagasc_p4941';
let env: Env;
let dispose: () => Promise<void>;
let created: { id: string; params: unknown }[] = [];

beforeAll(async () => {
  const m = await makeEnv();
  dispose = m.dispose;
  // the local platform proxy has no Workflows runtime: a recording fake stands in for PACK_RUN
  env = { ...m.env, PACK_RUN: { create: async (o: { id: string; params: unknown }) => { created.push(o); return {} as never; } } as unknown as Workflow };
});
afterAll(async () => dispose());

async function session(): Promise<string> {
  const id = newId('session');
  await env.DB.prepare('INSERT INTO judge_sessions (id, workspace_id, created_at) VALUES (?, ?, ?)').bind(id, HARBOUR, new Date().toISOString()).run();
  return id;
}
const used = async (id: string) => (await env.DB.prepare('SELECT runs_used, tavily_used AS search_used FROM judge_sessions WHERE id = ?').bind(id).first<{ runs_used: number; search_used: number }>())!;
const finishAll = () => env.DB.prepare("UPDATE runs SET status = 'completed' WHERE status IN ('queued','running')").run();

describe('judge caps: fresh pack runs', () => {
  it('allows exactly 2 fresh runs per session, the third is a 429 cap_session', async () => {
    const s = await session();
    await startPackRunImpl(env, { workspaceId: HARBOUR, tenderId: TEAGASC, sessionId: s, replay: false });
    await finishAll();
    await startPackRunImpl(env, { workspaceId: HARBOUR, tenderId: TEAGASC, sessionId: s, replay: false });
    await finishAll();
    await expect(startPackRunImpl(env, { workspaceId: HARBOUR, tenderId: TEAGASC, sessionId: s, replay: false })).rejects.toMatchObject({ status: 429, code: 'cap_session' });
    expect((await used(s)).runs_used).toBe(CAPS.freshRuns);
    // a refused run leaves no run row behind
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM runs WHERE status = 'queued'").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('a judge session that does not say replay or fresh gets the recorded replay, free', async () => {
    await finishAll();
    const s = await session();
    const id = await startPackRunImpl(env, { workspaceId: HARBOUR, tenderId: TEAGASC, sessionId: s });
    const row = await env.DB.prepare('SELECT replay FROM runs WHERE id = ?').bind(id).first<{ replay: number }>();
    expect(row!.replay).toBe(1);
    expect((await used(s)).runs_used).toBe(0);
    await finishAll();
  });

  it('only one fresh run may be in flight globally (shared model quota); a replay is still allowed and the loser is not charged', async () => {
    await finishAll();
    const a = await session();
    const b = await session();
    await startPackRunImpl(env, { workspaceId: HARBOUR, tenderId: TEAGASC, sessionId: a, replay: false });
    await expect(startPackRunImpl(env, { workspaceId: 'ws_kestrel_sensing', tenderId: 'tnd_sample_meteireann_701573', sessionId: b, replay: false }))
      .rejects.toMatchObject({ status: 429, code: 'cap_global' });
    expect((await used(b)).runs_used).toBe(0);
    await expect(startPackRunImpl(env, { workspaceId: HARBOUR, tenderId: TEAGASC, sessionId: b, replay: true })).rejects.toMatchObject({ status: 409 }); // same tender busy
    await finishAll();
  });

  it('replays never count against the cap, however many are played', async () => {
    const s = await session();
    const before = created.length;
    for (let i = 0; i < 4; i++) {
      const id = await startPackRunImpl(env, { workspaceId: HARBOUR, tenderId: TEAGASC, sessionId: s, replay: true });
      expect(id).toMatch(/^run_/);
      await finishAll();
    }
    expect((await used(s)).runs_used).toBe(0);
    expect(created.length - before).toBe(4);
    const row = await env.DB.prepare('SELECT replay FROM runs WHERE id = ?').bind((created.at(-1) as { id: string }).id).first<{ replay: number }>();
    expect(row!.replay).toBe(1);
  });

  it('a replay for a workspace with no recording is a 404, not an empty run', async () => {
    await expect(startPackRunImpl(env, { workspaceId: 'ws_kestrel_sensing', tenderId: TEAGASC, replay: true })).rejects.toMatchObject({ status: 404 });
  });

  it('refunds the cap when the workflow cannot be started', async () => {
    const s = await session();
    const broken = { ...env, PACK_RUN: { create: async () => { throw new Error('binding down'); } } as unknown as Workflow } as Env;
    await expect(startPackRunImpl(broken, { workspaceId: HARBOUR, tenderId: TEAGASC, sessionId: s, replay: false })).rejects.toMatchObject({ status: 502 });
    expect((await used(s)).runs_used).toBe(0);
  });

  it('refuses a second run while one is in progress (409) without spending the cap', async () => {
    await finishAll();
    const s = await session();
    await startPackRunImpl(env, { workspaceId: HARBOUR, tenderId: TEAGASC, sessionId: s, replay: false });
    await expect(startPackRunImpl(env, { workspaceId: HARBOUR, tenderId: TEAGASC, sessionId: s, replay: false })).rejects.toMatchObject({ status: 409 });
    expect((await used(s)).runs_used).toBe(1);
    await finishAll();
  });

  it('API-key calls (no session) are not judge-capped', async () => {
    await consumeFreshRun(env.DB, null);
    await expect(consumeFreshRun(env.DB, undefined)).resolves.toBeUndefined();
  });

  it('unknown tender and workspace are 404', async () => {
    await expect(startPackRunImpl(env, { workspaceId: HARBOUR, tenderId: 'tnd_nope' })).rejects.toBeInstanceOf(HttpError);
    await expect(startPackRunImpl(env, { workspaceId: 'ws_nope', tenderId: TEAGASC })).rejects.toMatchObject({ status: 404 });
  });
});

describe('caps: web search', () => {
  it('3 buyer refreshes per session', async () => {
    const s = await session();
    for (let i = 1; i <= CAPS.searchRefreshes; i++) expect(await consumeSearchRefresh(env.DB, s)).toBe(i);
    await expect(consumeSearchRefresh(env.DB, s)).rejects.toMatchObject({ status: 429, code: 'cap_session' });
  });
  it('daily live search calls are capped', async () => {
    await env.DB.prepare("DELETE FROM limits_counters WHERE key = 'web_search'").run();
    for (let i = 0; i < CAPS.searchPerDay; i++) await consumeSearchCall(env.DB);
    await expect(consumeSearchCall(env.DB)).rejects.toMatchObject({ status: 429, code: 'cap_day' });
    await env.DB.prepare("DELETE FROM limits_counters WHERE key = 'web_search'").run();
  });
});

describe('buyer intel (Muse Spark web search, stubbed Responses API)', () => {
  const calls: string[] = [];
  const payload = {
    id: 'resp_1', object: 'response', status: 'completed',
    output: [
      { type: 'web_search_call', id: 'ws1', status: 'completed', results: [
        { type: 'web_search_result', title: 'Teagasc', url: 'https://www.teagasc.ie/about/', snippet: '..' },
        { type: 'web_search_result', title: 'Teagasc research', url: 'https://www.teagasc.ie/research/', snippet: '..' },
      ] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', annotations: [], text: JSON.stringify({
        summary: 'Teagasc is the Irish agriculture and food development authority.',
        facts: [
          { label: 'Remit', value: 'Agriculture and food development authority', source_idx: 0 },
          { label: 'Invented', value: 'cites a page the search never returned', source_idx: 1 },
          { label: 'Research portfolio', value: 'About 300 research projects', source_idx: 2 },
          { label: 'Bogus', value: 'source index out of range', source_idx: 9 },
        ],
        sources: [
          { title: 'About Teagasc', url: 'https://www.teagasc.ie/about', snippet: 'Authority' },
          { title: 'Made up', url: 'https://invented.example/teagasc', snippet: 'not returned by search' },
          { title: 'Research', url: 'https://www.teagasc.ie/research/', snippet: 'Projects' },
        ],
      }) }] },
    ],
  };
  const fetchFake = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const e = () => ({ ...env, META_API_KEY: 'test' }) as Env;

  it('reading intel never searches (nothing runs on page load)', async () => {
    calls.length = 0;
    await buyerIntelImpl(e(), 'teagasc', { refresh: false, fetch: fetchFake });
    expect(calls).toEqual([]);
    await expect(buyerIntelImpl(e(), 'nobody', { refresh: false })).rejects.toMatchObject({ status: 404 });
  });

  it('a refresh keeps only grounded sources, re-indexes facts, counts the cap; the repeat is served from KV', async () => {
    const s = await session();
    await env.DB.prepare("DELETE FROM limits_counters WHERE key = 'web_search'").run();
    calls.length = 0;
    const intel = await buyerIntelImpl(e(), 'teagasc', { refresh: true, sessionId: s, fetch: fetchFake });
    expect(calls).toHaveLength(1);
    expect(intel.sources.map((x) => x.url)).toEqual(['https://www.teagasc.ie/about', 'https://www.teagasc.ie/research/']);
    expect(intel.facts).toEqual([{ label: 'Remit', value: 'Agriculture and food development authority', source_idx: 0 }, { label: 'Research portfolio', value: 'About 300 research projects', source_idx: 1 }]);
    expect((await used(s)).search_used).toBe(1);
    const day = await env.DB.prepare("SELECT count FROM limits_counters WHERE key = 'web_search'").first<{ count: number }>();
    expect(day!.count).toBe(1);
    const stored = await env.DB.prepare('SELECT summary FROM buyer_intel WHERE buyer_key = ?').bind('teagasc').first<{ summary: string }>();
    expect(stored!.summary).toContain('agriculture');

    calls.length = 0;
    await buyerIntelImpl(e(), 'teagasc', { refresh: true, sessionId: s, fetch: fetchFake });
    expect(calls).toEqual([]);
    expect((await used(s)).search_used).toBe(1);
  });

  it('refunds the session count when the search fails', async () => {
    const s = await session();
    await env.DB.prepare("INSERT OR IGNORE INTO tenders (id, source, source_ref, title, buyer, buyer_key, country, cpv_json, lots_json) VALUES ('tnd_t_x', 'upload', 'x', 't', 'Fresh Buyer Ltd', 'fresh-buyer', 'IE', '[]', '[]')").run();
    const failing = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(buyerIntelImpl(e(), 'fresh-buyer', { refresh: true, sessionId: s, fetch: failing })).rejects.toMatchObject({ status: 503, code: 'unavailable' });
    expect((await used(s)).search_used).toBe(0);
  });
});
