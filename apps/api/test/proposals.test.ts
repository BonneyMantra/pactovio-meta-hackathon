import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '@pactovio/contracts/env';
import { SAM_CONCEPTS } from '../../../packages/proposal/src/floorplan';
import { assetKey, computeTotals, createProposal, getProposalRow, groupInr, inputKey, loadCatalogue, loadProposalJson, listSteps, Proposal, runProposal, setBrainFixture, totalsConsistent } from '@pactovio/proposal';
import { buildApp } from '../src/app';
import { makeEnv } from './helpers';
import { customerFixture } from './customer-fixture';
import { mockModels, TINY_JPEG } from './proposals-mock';

let env: Env, dispose: () => Promise<void>, cookie: string, other: string;
const WS = 'ws_harbour_digital';
const { app } = buildApp();
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const call = (path: string, init: RequestInit = {}, ck = cookie) => app.fetch(new Request(`http://localhost${path}`, { ...init, headers: { cookie: ck, origin: 'http://localhost', ...(init.headers as Record<string, string>) } }), env, ctx);
const CATALOGUE: [string, string, number][] = [['RT-AP-8Z', 'Alarm Panel 8/4 zones', 18500], ['RT-EVA-G0', 'Edge Video Analytics', 8500], ['EXT-PIR-SENS', 'PIR motion sensor, wired', 650], ['SVC-SURVEY', 'Site survey', 12000]];

async function seed(ws: string) {
  for (const [sku, name, inr] of CATALOGUE) await env.DB.prepare("INSERT OR REPLACE INTO products (id, workspace_id, sku, name, family, specs_json, unit_price_minor, currency) VALUES (?, ?, ?, ?, 'Security', ?, ?, 'INR')")
    .bind(`prd_t_${ws}_${sku}`, ws, sku, name, JSON.stringify({ description: name, unit: 'nos' }), inr * 100).run();
}
async function newRun(ws: string, opts: Parameters<typeof mockModels>[0] = {}) {
  const id = await createProposal(env, ws, { source: 'upload', input: { files: [], text: 'RFP KCBL text' } });
  const plan = inputKey(ws, id, 'plan.png');
  await env.FILES.put(plan, Uint8Array.from(atob(TINY_JPEG), (c) => c.charCodeAt(0)), { httpMetadata: { contentType: 'image/png' } });
  await env.DB.prepare('UPDATE proposals SET input_json = ? WHERE id = ?').bind(JSON.stringify({ files: [{ key: plan, filename: 'plan.png', mime: 'image/png', size: 100 }], text: 'RFP KCBL text' }), id).run();
  const m = mockModels(opts);
  await runProposal(env, { proposalId: id, workspaceId: ws }, { fetchImpl: m.fetch });
  return { id, m };
}

beforeAll(async () => {
  ({ env, dispose } = await makeEnv());
  cookie = (await customerFixture(env, WS)).cookie;
  other = (await customerFixture(env, 'ws_kestrel_sensing')).cookie;
  await seed(WS);
  setBrainFixture(WS, { brain: { style: { payment_terms: '30% advance, 60% on delivery, 10% on commissioning.', amc_pct: 8, validity_days: 45, engineering_rates_inr: { firmware: 15000 } } }, past: [{ ref: 'PR/2025/001', title: 'ATM intrusion alarm retrofit for a regional bank', solution_type: 'own_products', skus: ['RT-AP-8Z'] }] });
}, 60000);
afterAll(async () => { setBrainFixture(WS, null); await dispose?.(); });

describe('money', () => {
  it('groups digits the Indian way', () => { expect(groupInr(4584026)).toBe('45,84,026'); expect(groupInr(999)).toBe('999'); expect(groupInr(123456789)).toBe('12,34,56,789'); });
  it('computes totals in integer rupees with 18% GST', () => {
    const t = computeTotals({ supply: [{ qty: 120, unit_price_inr: 18500 }, { qty: 3, unit_price_inr: 999 }], engineering: [{ person_days: 20, rate_inr: 14000 }], discount_pct: 5, gst_pct: 18 });
    expect(t.supply_subtotal_inr).toBe(2_222_997); expect(t.engineering_subtotal_inr).toBe(280_000); expect(t.subtotal).toBe(2_502_997);
    expect(t.discount_inr).toBe(125_150); expect(t.taxable_inr).toBe(2_377_847); expect(t.gst_inr).toBe(428_012); expect(t.total_inr).toBe(2_805_859);
  });
  it('caps discount at 15% and applies zero GST on export', () => { const t = computeTotals({ supply: [{ qty: 1, unit_price_inr: 1000 }], engineering: [], discount_pct: 40, gst_pct: 0 }); expect(t.discount_pct).toBe(15); expect(t.total_inr).toBe(850); });
});

describe('full pipeline with scripted models', () => {
  let id: string, m: ReturnType<typeof mockModels>, p: Proposal;
  beforeAll(async () => { ({ id, m } = await newRun(WS)); p = (await loadProposalJson(env, WS, id)).proposal!; }, 60000);

  it('completes and the output validates against the Proposal schema', async () => {
    expect((await getProposalRow(env, WS, id)).status).toBe('completed');
    expect(Proposal.safeParse(p).success).toBe(true);
    expect(p.client.name).toBe('Kurinji Commercial Bank Limited');
  });
  it('prices catalogue SKUs at catalogue prices, ignoring model-supplied prices, and drops invented SKUs', async () => {
    const cat = new Map((await loadCatalogue(env, WS)).map((c) => [c.sku, c.price_inr]));
    for (const l of p.scope_of_supply.filter((x) => cat.has(x.sku))) expect(l.unit_price_inr).toBe(cat.get(l.sku));
    expect(p.scope_of_supply.find((l) => l.sku === 'EXT-PIR-SENS')!.unit_price_inr).toBe(650);
    expect(p.scope_of_supply.find((l) => l.sku === 'EXT-PIR-SENS')!.qty).toBe(240);
    expect(p.scope_of_supply.some((l) => l.sku === 'RT-DOES-NOT-EXIST')).toBe(false);
    expect(p.scope_of_supply.find((l) => l.sku === 'EXT-DOORCONTACT')!.type).toBe('external');
  });
  it('totals re-derive from lines and follow the brain style', () => {
    expect(totalsConsistent(p)).toBe(true);
    expect(p.commercials.gst_pct).toBe(18);
    expect(p.commercials.payment_terms).toMatch(/^30% advance/);
    expect(p.validity_days).toBe(45);
    expect(p.custom_engineering[0]!.rate_inr).toBe(15000);
    expect(p.warranty_amc.amc_pct_of_hardware).toBe(8);
    expect(p.solution_type).toBe('own_plus_custom_engineering');
    expect(p.style_applied).toContain('brain:payment_terms');
    expect(p.learned_from).toEqual(['PR/2025/001']);
    expect(p.executive_summary).toContain(`₹${groupInr(p.commercials.total_inr)}`);
  });
  it('strikes unsupported claims and keeps evidence for the rest', () => {
    expect(p.executive_summary).not.toMatch(/ISO 27001|400 engineers/);
    expect(p.struck_claims.some((s) => /ISO 27001/.test(s.text))).toBe(true);
    expect(p.evidence.some((e) => 'product_sku' in e.source && e.source.product_sku === 'RT-AP-8Z')).toBe(true);
    expect(p.evidence.some((e) => 'doc' in e.source && e.source.page === 6)).toBe(true);
  });
  it('anchors placements on SAM boxes, drops unknown devices and dangling graph links', () => {
    expect(p.floorplan!.placements.map((x) => x.device_sku).sort()).toEqual(['EXT-PIR-SENS', 'RT-AP-8Z']);
    expect(p.floorplan!.placements.find((x) => x.device_sku === 'EXT-PIR-SENS')!.source).toBe('sam-3.1');
    expect(p.floorplan!.placements.find((x) => x.device_sku === 'RT-AP-8Z')!.source).toBe('spark-vision');
    for (const pl of p.floorplan!.placements) for (const v of pl.box) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(p.architecture.links).toHaveLength(1);
    expect(p.site_kit!.zone_map.map((z) => z.zone)).toEqual(['Z1']);
    expect(p.concept_visual!.label).toBe('Concept visual — generated, not a product photo');
  });
  it('adds a row for every requirement and records models per step', async () => {
    expect(p.compliance).toHaveLength(6);
    expect(p.compliance.find((c) => c.requirement.includes('Karnataka') || c.requirement.includes('service centres'))!.status).toBe('deviation');
    const steps = await listSteps(env, WS, id);
    expect(steps.map((s) => s.name)).toEqual(expect.arrayContaining(['read_rfq', 'select_solution', 'compose_bom', 'floor_plan', 'concept_visual', 'claim_check', 'orchestrate']));
    expect(steps.find((s) => s.name === 'floor_plan')!.models).toContain('meta:sam-3.1');
    expect(steps.find((s) => s.name === 'concept_visual')!.models).toContain('meta:muse-image-1.0');
    expect(steps.find((s) => s.name === 'orchestrate')!.models.join()).toContain('muse-wonder-1.0');
  });
  it('SAM is called once per concept (billed per call), not re-run by the fallback sweep', () => {
    expect(m.calls.filter((c) => c.url.endsWith('/responses'))).toHaveLength(SAM_CONCEPTS.length);
  });
});

describe('Wonder fallback', () => {
  it('runs the same pipeline on Spark when Wonder is not served', async () => {
    const { id } = await newRun(WS, { wonderDown: true });
    const row = await getProposalRow(env, WS, id);
    expect(row.status).toBe('completed');
    expect(row.orchestrator).toMatch(/muse-spark/);
  }, 60000);
  it('keeps going without a floor plan when SAM fails', async () => {
    const { id } = await newRun(WS, { samDown: true });
    const { proposal } = await loadProposalJson(env, WS, id);
    expect(proposal!.floorplan).toBeUndefined();
    expect((await listSteps(env, WS, id)).find((s) => s.name === 'floor_plan')!.status).toBe('error');
  }, 60000);
});

describe('API', () => {
  let id: string;
  beforeAll(async () => { ({ id } = await newRun(WS)); }, 60000);
  it('requires a customer session', async () => { expect((await call('/api/proposals', {}, '')).status).toBe(401); });
  it('lists, reads, serves assets and print HTML for the owning workspace', async () => {
    const list = await (await call('/api/proposals')).json() as { items: { id: string; client: string | null; total_inr: number | null }[] };
    expect(list.items.find((x) => x.id === id)!.client).toBe('Kurinji Commercial Bank Limited');
    const one = await (await call(`/api/proposals/${id}`)).json() as { status: string; steps: unknown[]; proposal: Proposal };
    expect(one.status).toBe('completed'); expect(one.steps.length).toBeGreaterThan(5); expect(one.proposal.commercials.total_inr).toBeGreaterThan(0);
    const img = await call(`/api/proposals/${id}/assets/${one.proposal.concept_visual!.image_ref}`);
    expect(img.status).toBe(200); expect(img.headers.get('content-type')).toBe('image/jpeg');
    const html = await call(`/api/proposals/${id}/pdf`);
    expect(html.status).toBe(200);
    const text = await html.text();
    expect(text).toContain('Concept visual — generated'); expect(text).toContain('Compliance matrix'); expect(text).not.toContain('<script');
  });
  it('isolates tenants: another workspace gets 404 on read, assets and print, and an empty list', async () => {
    expect((await call(`/api/proposals/${id}`, {}, other)).status).toBe(404);
    expect((await call(`/api/proposals/${id}/assets/concept.jpg`, {}, other)).status).toBe(404);
    expect((await call(`/api/proposals/${id}/pdf`, {}, other)).status).toBe(404);
    expect(((await (await call('/api/proposals', {}, other)).json()) as { items: unknown[] }).items.find((x) => (x as { id: string }).id === id)).toBeUndefined();
    expect(await env.FILES.get(assetKey('ws_kestrel_sensing', id, 'concept.jpg'))).toBeNull();
  });
  it('validates input at the boundary', async () => {
    const post = (body: BodyInit, type?: string) => call('/api/proposals', { method: 'POST', body, headers: type ? { 'content-type': type } : {} });
    expect((await post('{}', 'application/json')).status).toBe(400);
    expect((await post('{"intakeId":"../etc"}', 'application/json')).status).toBe(400);
    expect((await post('{"text":"x","extra":1}', 'application/json')).status).toBe(400);
    const fd = new FormData(); fd.append('file', new File(['x'], 'malware.exe'));
    const bad = await post(fd); expect(bad.status).toBe(400); expect(((await bad.json()) as { code: string }).code).toBe('validation');
    expect((await call('/api/proposals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intakeId: 'int_nope' }) })).status).toBe(404);
  });
  it('POST starts a run through the PROPOSAL workflow binding', async () => {
    const created: unknown[] = [];
    const prev = env.PROPOSAL; env.PROPOSAL = { create: async (o: unknown) => { created.push(o); return {}; } } as never;
    const r = await call('/api/proposals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Please quote 40 ATM alarm panels for our Pune branches.' }) });
    env.PROPOSAL = prev;
    expect(r.status).toBe(201);
    const { proposalId } = await r.json() as { proposalId: string };
    expect(created).toHaveLength(1);
    expect((await getProposalRow(env, WS, proposalId)).status).toBe('queued');
  });
  it('voice transcribe rejects non-WAV audio before any model call', async () => {
    const r = await call('/api/voice/transcribe', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: new Uint8Array(100) });
    expect(r.status).toBe(400);
    expect((await call('/api/voice/transcribe', { method: 'POST', body: new Uint8Array(0) }, other)).status).toBe(400);
  });
});
