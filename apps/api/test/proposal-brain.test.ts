import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '@pactovio/contracts/env';
import { getBrain, readBrainTables } from '@pactovio/proposal';
import { goNoGo } from '../../../packages/proposal/src/gonogo';
import { customerFixture } from './customer-fixture';
import { makeEnv } from './helpers';

let env: Env, dispose: () => Promise<void>, A: string, B: string, EMPTY: string;
const NOW = new Date().toISOString();

const style = {
  section_order: ['Executive summary', 'Commercials'],
  voice_rules: [{ id: 'V1', text: 'Lead with the buyer outcome.', refs: ['r1'] }, { id: 'V2', text: 'No superlatives.', refs: [] }],
  phrases: [{ text: 'engineered for the field', refs: ['r1'] }],
  payment_terms: '30% advance, 60% on delivery, 10% on commissioning.', amc_pct: 8, validity_days: 45,
};
const eng = (work_package: string, rate_inr: number) => ({ work_package, description: '', rate_inr });
const prop = (ref: string, over: Record<string, unknown> = {}) => ({
  ref, title: `ATM intrusion alarm retrofit ${ref}`, solution_type: 'own_products', date: '2025-03-01',
  client: { name: 'Kurinji Commercial Bank', sector: 'banking', city: 'Chennai' },
  scope_of_supply: [{ sku: 'RT-AP-8Z' }], commercials: { total_inr: 4_500_000 },
  warranty_amc: { warranty_months_from_commissioning: 12, warranty_months_from_dispatch: 18 },
  prepared_by: { name: 'Anita Rao', title: 'Pre-sales Lead' }, outcome: { status: 'pending' },
  custom_engineering: [eng('Panel firmware', 14000)], ...over,
});

async function seedDocs(ws: string, runId: string, docs: Record<string, unknown>[]) {
  await env.DB.prepare("INSERT INTO brain_learn_runs (id, workspace_id, folder_id, status, total, started_at) VALUES (?, ?, 'folderXXXXXX', 'completed', ?, ?)").bind(runId, ws, docs.length, NOW).run();
  let i = 0;
  for (const d of docs) {
    await env.DB.prepare("INSERT INTO brain_documents (id, workspace_id, run_id, drive_file_id, filename, status, proposal_ref, proposal_json, updated_at) VALUES (?, ?, ?, ?, ?, 'done', ?, ?, ?)")
      .bind(`bdoc_${runId}_${i}`, ws, runId, `f${runId}${i}`, `p${i}.pdf`, d.ref as string, JSON.stringify(d), `2025-01-0${++i}`).run();
  }
}

beforeAll(async () => {
  ({ env, dispose } = await makeEnv());
  A = (await customerFixture(env)).workspace; B = (await customerFixture(env)).workspace; EMPTY = (await customerFixture(env)).workspace;
  await env.DB.prepare('UPDATE workspaces SET profile_json = ? WHERE id = ?').bind('{}', EMPTY).run();
  await env.DB.prepare('INSERT INTO company_brain (workspace_id, style_json, stats_json, proposals_learned, learned_at) VALUES (?, ?, ?, 3, ?)')
    .bind(A, JSON.stringify(style), JSON.stringify({ win_rate: 0.4 }), NOW).run();
  await seedDocs(A, 'brn_aaaaaaaaaaaaaaaaaaaa', [
    prop('PR/1', { custom_engineering: [eng('Panel firmware', 14000), eng('Dashboard integration', 10000)] }),
    prop('PR/2', { custom_engineering: [eng('Embedded controller', 16000), eng('CMS portal', 12000)], validity_days: 90 }),
    prop('PR/3', { warranty_amc: { warranty_months_from_commissioning: 24, warranty_months_from_dispatch: 30 }, prepared_by: { name: 'Vikram Shah', title: 'Director' }, outcome: { status: 'lost' } }),
  ]);
  await env.DB.prepare("INSERT INTO brain_outcomes (workspace_id, ref, status, deal_id, dealname, synced_at) VALUES (?, 'PR/1', 'won', 'd1', 'Deal 1', ?)").bind(A, NOW).run();
  await seedDocs(B, 'brn_bbbbbbbbbbbbbbbbbbbb', [prop('PR/B1', { title: 'Cold chain telemetry rollout' })]);
}, 60000);
afterAll(async () => { await dispose?.(); });

describe('readBrainTables', () => {
  it('maps B1 style profile objects to the strings the bid engine applies', async () => {
    const { brain } = await readBrainTables(env.DB, A);
    const s = brain!.style!;
    expect(s.voice_rules).toEqual(['V1: Lead with the buyer outcome.', 'V2: No superlatives.']);
    expect(s.voice_rule_ids).toEqual(['V1', 'V2']);
    expect(s.phrases).toEqual(['engineered for the field']);
    expect(s.payment_terms).toBe(style.payment_terms);
    expect(s.amc_pct).toBe(8); expect(s.validity_days).toBe(45);
    expect(s.section_order).toEqual(style.section_order);
    expect(brain!.proposals_learned).toBe(3);
    expect(brain!.stats).toEqual({ win_rate: 0.4 });
  });
  it('derives warranty, engineering rates and prepared_by from the learned proposals', async () => {
    const s = (await readBrainTables(env.DB, A)).brain!.style!;
    expect(s.warranty_months_commissioning).toBe(12); expect(s.warranty_months_dispatch).toBe(18);
    expect(s.prepared_by).toEqual({ name: 'Anita Rao', title: 'Pre-sales Lead' });
    // firmware: panel/embedded/controller rates [14000,14000,16000,14000...] -> median; software: dashboard/cms/integration
    expect(s.engineering_rates_inr!.firmware).toBe(14000);
    expect(s.engineering_rates_inr!.software).toBe(11000);
    expect(s.engineering_rates_inr!.default).toBe(14000);
  });
  it('HubSpot outcome overrides the PDF outcome on the matching ref', async () => {
    const { past } = await readBrainTables(env.DB, A);
    const by = Object.fromEntries(past.map((p) => [p.ref, p.outcome]));
    expect(by['PR/1']).toBe('won');       // PDF said pending, HubSpot says won
    expect(by['PR/2']).toBe('pending');
    expect(by['PR/3']).toBe('lost');      // PDF outcome kept when no HubSpot row
    expect(past.find((p) => p.ref === 'PR/1')).toMatchObject({ sector: 'banking', client: 'Kurinji Commercial Bank', total_inr: 4_500_000, skus: ['RT-AP-8Z'] });
  });
  it('never returns another workspace\'s rows', async () => {
    const a = await readBrainTables(env.DB, A), b = await readBrainTables(env.DB, B);
    expect(a.past.map((p) => p.ref).sort()).toEqual(['PR/1', 'PR/2', 'PR/3']);
    expect(b.past.map((p) => p.ref)).toEqual(['PR/B1']);
    expect(b.brain!.style?.voice_rules).toBeUndefined();
    expect(b.brain!.style?.payment_terms).toBeUndefined();
    expect(b.past.some((p) => a.past.some((x) => x.ref === p.ref))).toBe(false);
  });
  it('a workspace with no rows and an empty profile returns no brain', async () => {
    expect(await readBrainTables(env.DB, EMPTY)).toEqual({ brain: null, past: [] });
    expect(await getBrain(env, EMPTY)).toEqual({ brain: null, past: [] });
    expect(await getBrain(env, 'ws_does_not_exist')).toEqual({ brain: null, past: [] });
  });
  it('a workspace with only a profile returns a brain with just the profile', async () => {
    const { workspace: P } = await customerFixture(env);
    const r = await getBrain(env, P);
    expect(r.past).toEqual([]);
    expect(r.brain!.profile.legal_name).toBe('Meridian Instruments');
    expect(r.brain!.style).toBeUndefined();
  });
});

const req = (id: number, category: string, mandatory = true) => ({ id: `R${id}`, text: `Requirement ${id} ${category}`, category, mandatory, page: id });
function runCtx(reqs: ReturnType<typeof req>[], status: (r: ReturnType<typeof req>) => string, past: unknown[] = [], due = '2026-11-14', custom: unknown[] = []) {
  return {
    brain: { brain: null, past },
    state: {
      rfq: { title: 'ATM intrusion alarm retrofit', summary: 'alarm panels for ATM sites', client: { name: 'Kurinji', sector: 'banking' }, due_date: due, requirements: reqs },
      compliance: reqs.map((r) => ({ requirement: r.text, status: status(r), response: '' })),
      selection: { lines: [], gaps: [] }, bom: { custom_engineering: custom },
    },
  } as any;
}
const hist = (n: number, won: number) => Array.from({ length: n }, (_, i) => ({ ref: `H${i}`, title: 'ATM intrusion alarm retrofit', solution_type: 'own_products', sector: 'banking', outcome: i < won ? 'won' : 'lost' }));
const TODAY = new Date('2026-11-04T00:00:00Z');

describe('goNoGo', () => {
  const fn = [req(1, 'functional'), req(2, 'functional'), req(3, 'functional')];
  it('returns undefined until rfq, compliance, selection and bom exist', () => {
    const c = runCtx(fn, () => 'complies'); delete c.state.bom;
    expect(goNoGo(c, TODAY)).toBeUndefined();
  });
  it('all complies with a good win history is go, with days_left from due_date', () => {
    const r = goNoGo(runCtx(fn, () => 'complies', hist(5, 5)), TODAY)!;
    expect(r.decision).toBe('go');
    expect(r.basis.days_left).toBe(10);
    expect(r.basis).toMatchObject({ coverage: 1, similar_won: 5, similar_decided: 5, eligibility_gaps: 0 });
    expect(r.confidence).toBeGreaterThanOrEqual(0.08); expect(r.confidence).toBeLessThanOrEqual(0.95);
    expect(r.reasons.join(' ')).toContain('Won 5 of 5');
  });
  it('a mandatory eligibility deviation is conditional with a Gap reason', () => {
    const reqs = [...fn, req(4, 'eligibility')];
    const r = goNoGo(runCtx(reqs, (q) => (q.category === 'eligibility' ? 'deviation' : 'complies'), hist(5, 5)), TODAY)!;
    expect(r.decision).toBe('conditional');
    expect(r.reasons.some((s) => s.startsWith('Gap:'))).toBe(true);
    expect(r.basis.eligibility_gaps).toBe(1);
  });
  it('three eligibility deviations is no_go', () => {
    const reqs = [...fn, req(4, 'eligibility'), req(5, 'eligibility'), req(6, 'commercial')];
    const r = goNoGo(runCtx(reqs, (q) => (q.category === 'functional' ? 'complies' : 'deviation'), hist(5, 5)), TODAY)!;
    expect(r.decision).toBe('no_go');
    expect(r.basis.eligibility_gaps).toBe(3);
  });
  it('clamps confidence to [0.08, 0.95] and flags a poor all-deviation bid', () => {
    const bad = goNoGo(runCtx(fn, () => 'deviation', hist(6, 0), '2026-11-06'), TODAY)!;
    expect(bad.decision).toBe('no_go'); expect(bad.confidence).toBe(0.15); // 0.2 base - 0.05 short-deadline penalty
    const reqs = Array.from({ length: 8 }, (_, i) => req(i, 'eligibility'));
    const floor = goNoGo(runCtx(reqs, () => 'deviation', hist(6, 0), '2026-11-06'), TODAY)!;
    expect(floor.confidence).toBe(0.08);
  });
  it('past due dates give negative days_left and no countdown reason; missing due_date gives null', () => {
    const past = goNoGo(runCtx(fn, () => 'complies', [], '2026-10-30'), TODAY)!;
    expect(past.basis.days_left).toBe(-5);
    expect(past.reasons.some((s) => s.startsWith('Bid due'))).toBe(false);
    const c = runCtx(fn, () => 'complies'); c.state.rfq.due_date = undefined;
    expect(goNoGo(c, TODAY)!.basis.days_left).toBeNull();
  });
  it('reports custom engineering packages in the reasons', () => {
    const r = goNoGo(runCtx(fn, () => 'complies', [], '2026-11-14', [{ person_days: 12 }, { person_days: 8 }]), TODAY)!;
    expect(r.reasons.join(' ')).toContain('2 custom-engineering packages (20 person-days)');
  });
});
