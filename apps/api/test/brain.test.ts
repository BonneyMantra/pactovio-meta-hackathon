import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '@pactovio/contracts/env';
import { mapHubspotProduct } from '@pactovio/brain';
import { buildApp } from '../src/app';
import { upsertCatalogue } from '../src/lib/brain-catalogue';
import { addEvent } from '../src/lib/brain-store';
import { customerFixture } from './customer-fixture';
import { makeEnv } from './helpers';

let env: Env, dispose: () => Promise<void>;
let a: Awaited<ReturnType<typeof customerFixture>>, b: typeof a;
const { app } = buildApp();
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const req = (path: string, init: RequestInit = {}, cookie: string | null = a.cookie) => app.fetch(new Request(`https://pactovio.example/api/brain${path}`, {
  ...init, headers: { ...(cookie ? { cookie } : {}), origin: 'https://pactovio.example', ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}) },
}), env, ctx);
const proposalJson = JSON.stringify({ ref: 'RAX/PR/2025/001' });

beforeAll(async () => {
  ({ env, dispose } = await makeEnv());
  a = await customerFixture(env); b = await customerFixture(env);
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO brain_learn_runs (id, workspace_id, folder_id, status, total, started_at) VALUES ('brn_aaaaaaaaaaaaaaaaaaaa', ?, 'folderAAAAAA', 'running', 5, ?)").bind(a.workspace, now).run();
  await env.DB.prepare("INSERT INTO brain_documents (id, workspace_id, run_id, drive_file_id, filename, status, proposal_ref, proposal_json, updated_at) VALUES ('bdoc_1', ?, 'brn_aaaaaaaaaaaaaaaaaaaa', 'f1', 'a.pdf', 'done', 'RAX/PR/2025/001', ?, ?)").bind(a.workspace, proposalJson, now).run();
  await addEvent(env.DB, a.workspace, 'brn_aaaaaaaaaaaaaaaaaaaa', 'brain.learn.started', { total: 5 });
});
afterAll(async () => { await dispose(); });

describe('brain routes: auth and tenant isolation', () => {
  it('require a customer session', async () => {
    for (const p of ['', '/progress', '/proposals', '/drive/folders']) expect((await req(p, {}, null)).status).toBe(401);
    expect((await req('/hubspot/sync', { method: 'POST' }, null)).status).toBe(401);
  });
  it("workspace B never sees workspace A's run, events or documents", async () => {
    const own = await (await req('/progress')).json() as any;
    expect(own.run.id).toBe('brn_aaaaaaaaaaaaaaaaaaaa');
    expect(own.events).toHaveLength(1);
    const other = await (await req('/progress', {}, b.cookie)).json() as any;
    expect(other.run).toBeNull();
    const byId = await (await req('/progress?run_id=brn_aaaaaaaaaaaaaaaaaaaa', {}, b.cookie)).json() as any;
    expect(byId.run).toBeNull();
    expect(byId.events).toEqual([]);
    expect(((await (await req('/proposals', {}, b.cookie)).json()) as any).items).toEqual([]);
  });
  it('brain summary is per workspace', async () => {
    await env.DB.prepare("INSERT INTO products (id, workspace_id, sku, name, specs_json, unit_price_minor, currency) VALUES ('p_a', ?, 'X1', 'X', '{}', 100, 'INR')").bind(a.workspace).run();
    expect(((await (await req('')).json()) as any).catalogue_count).toBe(1);
    expect(((await (await req('', {}, b.cookie)).json()) as any).catalogue_count).toBe(0);
  });
  it('validates input', async () => {
    expect((await req('/drive/learn', { method: 'POST', body: JSON.stringify({ folderId: "x' or 1=1" }) })).status).toBe(400);
    expect((await req('/progress?run_id=nope')).status).toBe(400);
  });
  it('hubspot sync and learning need a connection', async () => {
    expect((await req('/hubspot/sync', { method: 'POST' })).status).toBe(409);
    expect((await req('/drive/folders')).status).toBe(409);
  });
});

describe('catalogue upsert', () => {
  const raw = [
    { id: '1', properties: { name: 'Rax Alarm Panel', hs_sku: 'RT-AP-84', price: '18500' } },
    { id: '2', properties: { name: 'Edge Video Analytics', hs_sku: 'RT-EVA-G0', price: '42000' } },
  ].map((r) => mapHubspotProduct(r)!);
  it('is idempotent, updates changed prices, never overwrites manual products', async () => {
    const first = await upsertCatalogue(env.DB, a.workspace, raw);
    expect([first.imported, first.updated, first.skipped]).toEqual([2, 0, 0]);
    const again = await upsertCatalogue(env.DB, a.workspace, raw);
    expect([again.imported, again.updated, again.skipped]).toEqual([0, 0, 2]);
    const changed = await upsertCatalogue(env.DB, a.workspace, [{ ...raw[0]!, unit_price_minor: 1900000 }, raw[1]!]);
    expect([changed.imported, changed.updated, changed.skipped]).toEqual([0, 1, 1]);
    await env.DB.prepare("INSERT INTO products (id, workspace_id, sku, name, specs_json, unit_price_minor, currency) VALUES ('p_m', ?, 'RT-MANUAL', 'Manual', '{}', 5, 'INR')").bind(a.workspace).run();
    const manual = await upsertCatalogue(env.DB, a.workspace, [{ ...raw[0]!, sku: 'RT-MANUAL' }]);
    expect(manual.skipped).toBe(1);
    expect((await env.DB.prepare("SELECT unit_price_minor AS p FROM products WHERE id='p_m'").first<{ p: number }>())!.p).toBe(5);
  });
  it('is tenant scoped', async () => {
    const r = await upsertCatalogue(env.DB, b.workspace, raw);
    expect(r.imported).toBe(2);
  });
});

describe('outcome join in the brain', () => {
  it('uses stored HubSpot outcomes by ref and falls back to the PDF value', async () => {
    const { learnedDocs } = await import('../src/lib/brain-store');
    const p = (ref: string, status: string) => JSON.stringify({ ...JSON.parse(readFileSync(join(__dirname, '../../../packages/brain/test/fixtures/RAX-PR-2025-041.json'), 'utf8')), ref, outcome: { status, decided_on: null, reason: 'r' }, implementation_plan: JSON.parse(readFileSync(join(__dirname, '../../../packages/brain/test/fixtures/RAX-PR-2025-041.json'), 'utf8')).implementation_plan.map((s: object) => ({ start_week: null, ...s })), commercials: { ...JSON.parse(readFileSync(join(__dirname, '../../../packages/brain/test/fixtures/RAX-PR-2025-041.json'), 'utf8')).commercials, note: null } });
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO brain_documents (id, workspace_id, run_id, drive_file_id, filename, status, proposal_ref, proposal_json, updated_at) VALUES ('bdoc_p1', ?, 'brn_aaaaaaaaaaaaaaaaaaaa', 'f2', 'b.pdf', 'done', 'RAX/PR/2025/002', ?, ?)").bind(a.workspace, p('RAX/PR/2025/002', 'pending'), now),
      env.DB.prepare("INSERT INTO brain_documents (id, workspace_id, run_id, drive_file_id, filename, status, proposal_ref, proposal_json, updated_at) VALUES ('bdoc_p2', ?, 'brn_aaaaaaaaaaaaaaaaaaaa', 'f3', 'c.pdf', 'done', 'RAX/PR/2025/003', ?, ?)").bind(a.workspace, p('RAX/PR/2025/003', 'pending'), now),
      env.DB.prepare("INSERT INTO brain_outcomes (workspace_id, ref, status, decided_on, amount_inr, deal_id, dealname, synced_at) VALUES (?, 'RAX/PR/2025/002', 'won', '2025-05-05', 1, 'd1', 'RAX/PR/2025/002 · x', ?)").bind(a.workspace, now),
      env.DB.prepare("INSERT INTO brain_outcomes (workspace_id, ref, status, decided_on, amount_inr, deal_id, dealname, synced_at) VALUES (?, 'RAX/PR/2025/003', 'lost', '2025-05-05', 1, 'd2', 'RAX/PR/2025/003 · x', ?)").bind(b.workspace, now),
    ]);
    const docs = await learnedDocs(env.DB, a.workspace);
    const by = Object.fromEntries(docs.map((d) => [d.proposal.ref, d]));
    expect(by['RAX/PR/2025/002']!.proposal.outcome.status).toBe('won');
    expect(by['RAX/PR/2025/002']!.outcome_source).toBe('hubspot');
    expect(by['RAX/PR/2025/003']!.proposal.outcome.status).toBe('pending'); // B's deal never leaks into A
    expect(by['RAX/PR/2025/003']!.outcome_source).toBe('pdf');
  });
});
