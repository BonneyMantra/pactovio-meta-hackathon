import { describe, expect, it } from 'vitest';
import { commercialScore, dealBand, scoreRubric, toAssessment, type DeepRead, type Evidence } from '../src/lib/opportunity-rubric';

const ev: Evidence = {
  products: [{ sku: 'RT-AAP-16Z', name: 'Alarm panel 16 zone' }, { sku: 'RT-IPC-4MP', name: '4MP IP camera' }],
  proposals: [
    { ref: 'RAX/PR/2026/042', client: 'Kurinji Bank', sector: 'Banking', solution_type: 'atm_esurveillance', total_inr: 2_00_00_000, outcome: 'won' },
    { ref: 'RAX/PR/2025/111', client: 'Metro Retail', sector: 'Retail', solution_type: 'cctv', total_inr: 50_00_000, outcome: 'lost' },
    { ref: 'RAX/PR/2024/048', client: 'State Co-op Bank', sector: 'Banking', solution_type: 'alarm', total_inr: 1_00_00_000, outcome: 'won' },
  ],
};
const read: DeepRead = {
  title: 'Alarm points', summary: 'Supply of alarm points.',
  requirements: [
    { text: 'Intrusion alarm panels', skus: ['[RT-AAP-16Z]'], coverage: 'full' },
    { text: 'IP cameras', skus: ['RT-IPC-4MP'], coverage: 'partial' },
    { text: 'Invented sensor', skus: ['FAKE-1'], coverage: 'full' },
    { text: 'Fire suppression', skus: [], coverage: 'none' },
  ],
  similar_proposals: [{ ref: 'RAX/PR/2026/042', similarity: 'high', why: 'bank alarms' }, { ref: 'RAX/PR/9999/001', similarity: 'high', why: 'invented' }],
  eligibility: [{ check: 'Region and service presence', status: 'risk', note: 'No office in Poland' }, { check: 'Language', status: 'ok', note: 'English accepted' }],
  deciding_factor: 'The alarm panels match.', top_risk: 'No service presence in Poland.',
};

describe('tender fit rubric', () => {
  const r = scoreRubric(read, ev, { amount_minor: 1_400_000_00, currency: 'EUR' }, { model: 'meta:muse-spark-1.3', chars: 1200, documents_url: null });
  it('keeps only real SKUs and refs, and downgrades an uncited "full"', () => {
    expect(r.requirements[0]!.products.map((p) => p.sku)).toEqual(['RT-AAP-16Z']);
    expect(r.requirements[2]).toMatchObject({ coverage: 'partial', products: [] });
    expect(r.past.map((p) => p.ref)).toEqual(['RAX/PR/2026/042']);
    expect(r.past[0]).toMatchObject({ outcome: 'won', client: 'Kurinji Bank' });
  });
  it('computes coverage, track record, eligibility and the weighted total in code', () => {
    expect(r.coverage_pct).toBe(50); // 1 + 0.5 + 0.5 + 0 of 4
    expect(r.scores.track_record).toBe(100);
    expect(r.eligibility).toHaveLength(5); // missing checks become unknown
    expect(r.scores.eligibility).toBe(Math.round((100 * (0.1 + 1 + 0.6 * 3)) / 5));
    const w = r.weights, s = r.scores;
    expect(r.capped).toBe(false);
    expect(r.overall).toBe(Math.round((w.capability * s.capability + w.track_record * s.track_record + w.eligibility * s.eligibility + w.commercial * s.commercial) / 100));
    expect(['bid', 'bid_with_conditions', 'pass']).toContain(r.verdict);
  });
  it('compares the value with the median and the won band', () => {
    const band = dealBand(ev);
    expect(band).toEqual({ median_inr: 1_00_00_000, won_min_inr: 1_00_00_000, won_max_inr: 2_00_00_000 });
    expect(commercialScore(null, band).score).toBe(50);
    expect(commercialScore(1_50_00_000, band).score).toBeGreaterThan(commercialScore(50_00_00_000, band).score);
  });
  it('caps the fit when the catalogue covers under 30% of the requirements', () => {
    const low = scoreRubric({ ...read, requirements: [{ text: 'Sirens', skus: [], coverage: 'none' }, { text: 'Panels', skus: ['RT-AAP-16Z'], coverage: 'partial' }] },
      ev, { amount_minor: 1_500_000_000, currency: 'INR' }, { model: 'm', chars: 1, documents_url: null });
    expect(low.coverage_pct).toBe(25);
    expect(low.weighted).toBeGreaterThan(35);
    expect(low).toMatchObject({ capped: true, overall: 35, verdict: 'pass' });
  });
  it('keeps the old assessment shape for saving and ordering', () => {
    const a = toAssessment(read, r);
    expect(a.score).toBe(r.overall);
    expect(a.reasons[0]).toMatch(/^(Bid|Bid with conditions|Pass): /);
    expect(a.rubric).toBe(r);
  });
});
