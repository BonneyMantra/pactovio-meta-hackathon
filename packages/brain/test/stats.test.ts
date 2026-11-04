import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProposalSchema, computeStats, groundDraft, indexRow, median, styleFacts, type Proposal } from '../src';

const dir = join(__dirname, 'fixtures');
/** Fixtures omit optional fields; the strict extraction schema carries them as null. */
const nullify = (d: any) => {
  d.implementation_plan.forEach((s: any) => { s.start_week ??= null; });
  d.commercials.note ??= null;
  return d;
};
const load = (n: string): Proposal => ProposalSchema.parse(nullify(JSON.parse(readFileSync(join(dir, `${n}.json`), 'utf8'))));
const ps = ['RAX-PR-2025-041', 'RAX-PR-2025-088', 'RAX-PR-2026-012'].map(load);

describe('proposal schema', () => {
  it('accepts the three sample proposals and rejects a bad ref', () => {
    expect(ps).toHaveLength(3);
    expect(ProposalSchema.safeParse({ ...ps[0], ref: 'ACME/1' }).success).toBe(false);
  });
});

describe('computeStats', () => {
  const s = computeStats(ps);
  it('counts and values by solution type from the data', () => {
    const total = ps.reduce((a, p) => a + p.commercials.total_inr, 0);
    const counts = Object.values(s.by_solution_type).reduce((a, x) => a + x.count, 0);
    expect(counts).toBe(3);
    expect(Object.values(s.by_solution_type).reduce((a, x) => a + x.value_inr, 0)).toBe(total);
    expect(Object.values(s.by_solution_type).reduce((a, x) => a + x.value_share, 0)).toBeCloseTo(1, 2);
    for (const p of ps) expect(s.by_solution_type[p.solution_type].count).toBeGreaterThan(0);
  });
  it('value share across lines sums to one', () => {
    expect(Object.values(s.value_share).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
  });
  it('win rate ignores pending and outcomes add up', () => {
    expect(s.won + s.lost + s.pending).toBe(3);
    const w = ps.filter((p) => p.outcome.status === 'won').length, l = ps.filter((p) => p.outcome.status === 'lost').length;
    expect(s.win_rate).toBe(w + l ? Math.round((w / (w + l)) * 1e4) / 1e4 : null);
  });
  it('median, bands, turnaround, engineering days', () => {
    expect(s.median_value_inr).toBe(median(ps.map((p) => p.commercials.total_inr)));
    expect(s.value_bands.reduce((a, b) => a + b.count, 0)).toBe(3);
    expect(s.avg_turnaround_days).toBeCloseTo(ps.reduce((a, p) => a + p.turnaround_days, 0) / 3, 1);
    expect(s.engineering_days_total).toBe(ps.flatMap((p) => p.custom_engineering).reduce((a, e) => a + e.person_days, 0));
  });
  it('top products are Rax SKUs sorted by value; sectors and regions cover every proposal', () => {
    const vals = s.top_products.map((p) => p.value_inr);
    expect(vals).toEqual([...vals].sort((a, b) => b - a));
    expect(s.by_sector.reduce((a, x) => a + x.count, 0)).toBe(3);
    expect(s.by_region.reduce((a, x) => a + x.count, 0)).toBe(3);
    expect(s.typical_margin_note).toMatch(/Average discount/);
  });
  it('is empty-safe', () => {
    const e = computeStats([]);
    expect(e.win_rate).toBeNull();
    expect(e.median_value_inr).toBe(0);
  });
});

describe('style facts and grounding', () => {
  it('derives payment terms, validity and amc from data', () => {
    const f = styleFacts(ps);
    expect(ps.map((p) => p.commercials.payment_terms)).toContain(f.payment_terms);
    expect(f.validity_days).toBe(median(ps.map((p) => p.validity_days)));
    expect(f.warranty).toMatch(/months from commissioning/);
  });
  it('drops rules citing fewer than two real proposals', () => {
    const known = new Set(ps.map((p) => p.ref));
    const out = groundDraft([{ id: 'V1', refs: [ps[0]!.ref, ps[1]!.ref] }, { id: 'V2', refs: [ps[0]!.ref, 'RAX/PR/2099/001'] }, { id: 'V3', refs: [ps[2]!.ref, ps[2]!.ref] }], known);
    expect(out.map((x) => x.id)).toEqual(['V1']);
  });
  it('index row carries key fields', () => {
    expect(indexRow(ps[0]!, 'a.pdf')).toMatchObject({ ref: ps[0]!.ref, client: ps[0]!.client.name, source_file: 'a.pdf' });
  });
});
