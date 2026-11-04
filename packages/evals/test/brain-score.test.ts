import { describe, expect, it } from 'vitest';
import { aggregate, jaccard, scoreExtraction, scoreLineItems, toNum } from '../src/brain-score';

const truth = () => ({
  ref: 'RAX/PR/2024/007', revision: 'R0', date: '2024-01-17', validity_days: 60,
  client: { name: 'Mullai Urban Co-operative Bank', sector: 'Banking', city: 'Mysuru' },
  rfq_ref: 'MUCB/OPS/118 dated 8 January 2024', title: 'E-Surveillance for 12 ATM Sites',
  solution_type: 'own_products', outcome: { status: 'won' }, prepared_by: { name: 'Karthik R' }, turnaround_days: 9,
  scope_of_supply: [{ sku: 'RT-AP-8Z', qty: 12 }, { sku: 'RT-ESG-G', qty: 12 }, { sku: 'SVC-INSTALL', qty: 1 }],
  custom_engineering: [{ person_days: 10 }, { person_days: 10 }],
  commercials: { total_inr: 595197 },
  warranty_amc: { warranty_months_from_commissioning: 12, warranty_months_from_dispatch: 18, amc_pct_of_hardware: 10 },
  compliance: [{}, {}, {}, {}],
});

describe('scoreExtraction', () => {
  it('scores an identical record at 1 on every field', () => {
    const r = scoreExtraction(truth(), truth());
    expect(Object.values(r.fields).every((v) => v === 1)).toBe(true);
    expect(r.supply.f1).toBe(1);
  });

  it('normalises case, whitespace, punctuation and currency formatting', () => {
    const e = { ...truth(), client: { name: '  MULLAI urban   co-operative bank ', sector: 'banking', city: 'MYSURU' },
      commercials: { total_inr: '₹5,95,197' }, ref: 'rax/pr/2024/007', rfq_ref: 'MUCB/OPS/118' };
    const r = scoreExtraction(truth(), e);
    expect(r.fields.client_name).toBe(1);
    expect(r.fields.total_inr).toBe(1);
    expect(r.fields.ref).toBe(1);
    expect(r.fields.rfq_ref).toBe(1);
  });

  it('applies numeric tolerance: 0.5% on total, 5% on person-days', () => {
    const near = { ...truth(), commercials: { total_inr: 597000 }, custom_engineering: [{ person_days: 10 }, { person_days: 10.9 }] };
    expect(scoreExtraction(truth(), near).fields.total_inr).toBe(1);
    expect(scoreExtraction(truth(), near).fields.engineering_person_days).toBe(1);
    const far = { ...truth(), commercials: { total_inr: 610000 }, custom_engineering: [{ person_days: 10 }, { person_days: 12 }] };
    expect(scoreExtraction(truth(), far).fields.total_inr).toBe(0);
    expect(scoreExtraction(truth(), far).fields.engineering_person_days).toBe(0);
  });

  it('scores missing extracted fields 0 and absent truth fields null', () => {
    const e = truth() as Record<string, unknown>;
    delete e.turnaround_days;
    const t = truth() as Record<string, unknown>;
    delete t.rfq_ref;
    const r = scoreExtraction(t, e);
    expect(r.fields.turnaround_days).toBe(0);
    expect(r.fields.rfq_ref).toBeNull();
    expect(scoreExtraction(truth(), null).fields.ref).toBe(0);
  });

  it('title uses token Jaccard >= 0.8', () => {
    expect(jaccard('a b c d e', 'a b c d')).toBe(0.8);
    expect(scoreExtraction(truth(), { ...truth(), title: 'E-Surveillance for 12 ATM Sites at Mysuru' }).fields.title).toBe(0);
    expect(scoreExtraction(truth(), { ...truth(), title: 'e-surveillance for 12 ATM sites.' }).fields.title).toBe(1);
  });

  it('counts compliance rows and engineering items', () => {
    const e = { ...truth(), compliance: [{}, {}], custom_engineering: [] };
    const r = scoreExtraction(truth(), e);
    expect(r.fields.compliance_count).toBe(0);
    expect(r.fields.engineering_count).toBe(0);
  });
});

describe('scoreLineItems', () => {
  it('computes SKU precision, recall, F1 and qty exact rate', () => {
    const t = [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 4 }, { sku: 'C', qty: 1 }];
    const e = [{ sku: ' a ', qty: 2 }, { sku: 'B', qty: 5 }, { sku: 'Z', qty: 1 }];
    const s = scoreLineItems(t, e);
    expect(s.matched).toBe(2);
    expect(s.qtyMatched).toBe(1);
    expect(s.precision).toBeCloseTo(2 / 3);
    expect(s.recall).toBeCloseTo(2 / 3);
    expect(s.f1).toBeCloseTo(2 / 3);
  });

  it('matches duplicate SKUs one-to-one and handles empties', () => {
    expect(scoreLineItems([{ sku: 'A', qty: 1 }, { sku: 'A', qty: 1 }], [{ sku: 'A', qty: 1 }]).recall).toBe(0.5);
    expect(scoreLineItems([], []).f1).toBe(0);
  });
});

describe('aggregate', () => {
  it('averages per-field accuracy over non-null docs and macro-means the overall', () => {
    const good = scoreExtraction(truth(), truth());
    const bad = scoreExtraction(truth(), { ...truth(), revision: 'R9', outcome: { status: 'lost' } });
    const a = aggregate([good, bad]);
    expect(a.documents).toBe(2);
    expect(a.fieldAccuracy.revision).toEqual({ accuracy: 0.5, n: 2 });
    expect(a.fieldAccuracy.ref.accuracy).toBe(1);
    expect(a.overallFields).not.toContain('outcome_status');
    const fields = a.overallFields;
    const expected = fields.reduce((s, f) => s + a.fieldAccuracy[f].accuracy, 0) / fields.length;
    expect(a.overall).toBeCloseTo(expected);
    expect(a.overall).toBeLessThan(1);
    expect(a.supply.f1).toBe(1);
  });

  it('is zero-safe on empty input and parses Indian-grouped numbers', () => {
    expect(aggregate([]).overall).toBe(0);
    expect(toNum('INR 5,95,197')).toBe(595197);
    expect(toNum('abc')).toBeNull();
  });
});
