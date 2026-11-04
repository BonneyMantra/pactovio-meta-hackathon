import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProposalSchema, applyOutcomes, computeStats, mapDeals, parseRef, stageStatus } from '../src';

const load = (n: string) => {
  const d = JSON.parse(readFileSync(join(__dirname, 'fixtures', `${n}.json`), 'utf8'));
  d.implementation_plan.forEach((s: any) => { s.start_week ??= null; }); d.commercials.note ??= null; // eslint-disable-line @typescript-eslint/no-explicit-any
  return ProposalSchema.parse(d);
};
const ps = ['RAX-PR-2025-041', 'RAX-PR-2025-088', 'RAX-PR-2026-012'].map(load);
const deal = (id: string, dealname: string, dealstage: string, closedate?: string, amount = '100') => ({ id, properties: { dealname, dealstage, closedate, amount } });

describe('deal outcomes', () => {
  it('parses refs only from the start of the deal name', () => {
    expect(parseRef('RAX/PR/2025/041 · E-Surveillance Retrofit')).toBe('RAX/PR/2025/041');
    expect(parseRef('rax/pr/2025/041 - x')).toBe('RAX/PR/2025/041');
    expect(parseRef('Follow up on RAX/PR/2025/041')).toBeNull();
    expect(parseRef(undefined)).toBeNull();
  });
  it('maps stages', () => {
    expect([stageStatus('closedwon'), stageStatus('closedlost'), stageStatus('presentationscheduled'), stageStatus(null)]).toEqual(['won', 'lost', 'pending', 'pending']);
  });
  it('latest deal per ref wins', () => {
    const m = mapDeals([deal('1', 'RAX/PR/2025/041 · A', 'closedlost', '2025-05-01T00:00:00Z'), deal('2', 'RAX/PR/2025/041 · A', 'closedwon', '2025-06-01T00:00:00Z'), deal('3', 'Unrelated', 'closedwon')]);
    expect(m.size).toBe(1);
    expect(m.get('RAX/PR/2025/041')).toMatchObject({ status: 'won', decided_on: '2025-06-01', deal_id: '2' });
  });
  it('joins by ref, keeps PDF outcome when no deal, and feeds stats', () => {
    const forced = ps.map((p) => ({ ...p, outcome: { ...p.outcome, status: 'pending' as const, decided_on: null } }));
    const m = mapDeals([deal('1', `${forced[0]!.ref} · x`, 'closedwon', '2025-04-02T00:00:00Z'), deal('2', `${forced[1]!.ref} · y`, 'closedlost', '2025-10-15T00:00:00Z')]);
    const joined = applyOutcomes(forced, m);
    expect(joined.map((j) => j.outcome_source)).toEqual(['hubspot', 'hubspot', 'pdf']);
    expect(joined.map((j) => j.proposal.outcome.status)).toEqual(['won', 'lost', 'pending']);
    expect(joined[0]!.proposal.outcome.decided_on).toBe('2025-04-02');
    const s = computeStats(joined.map((j) => j.proposal));
    expect([s.won, s.lost, s.pending, s.win_rate]).toEqual([1, 1, 1, 0.5]);
  });
});
