import type { RunCtx } from './ctx';
import type { GoNoGo } from './schema';
import { similarPast } from './select';

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Bid / no-bid, computed in code from the run (no model call): mandatory eligibility gaps found by the compliance matrix,
 * catalogue coverage of the functional scope, the win rate on the most similar learned proposals, and time left to the deadline.
 */
export function goNoGo(ctx: RunCtx, today = new Date()): GoNoGo | undefined {
  const { rfq, compliance, selection, bom } = ctx.state;
  if (!rfq || !compliance || !selection || !bom) return undefined;
  const reqByText = new Map(rfq.requirements.map((r) => [r.text, r]));
  const rows = compliance.map((c) => ({ ...c, req: reqByText.get(c.requirement) }));
  const elig = rows.filter((r) => r.req && (r.req.category === 'eligibility' || r.req.category === 'commercial') && r.req.mandatory);
  const eligDev = elig.filter((r) => r.status === 'deviation'), eligPart = elig.filter((r) => r.status === 'partial');
  const fn = rows.filter((r) => r.req && r.req.category !== 'eligibility' && r.req.category !== 'commercial');
  const met = fn.filter((r) => r.status === 'complies').length, partial = fn.filter((r) => r.status === 'partial').length;
  const coverage = fn.length ? (met + partial * 0.5) / fn.length : 0.5;

  const similar = similarPast(ctx.brain.past, `${rfq.title} ${rfq.summary} ${rfq.client.sector}`, 8).filter((p) => p.outcome === 'won' || p.outcome === 'lost');
  const won = similar.filter((p) => p.outcome === 'won').length;
  const winRate = similar.length >= 3 ? won / similar.length : null;

  const reasons: string[] = [];
  reasons.push(`Catalogue and engineering cover ${met} of ${fn.length} technical requirements in full${partial ? `, ${partial} in part` : ''}.`);
  if (winRate !== null) reasons.push(`Won ${won} of ${similar.length} closest past bids (${similar.slice(0, 3).map((p) => p.ref).join(', ')}).`);
  if (bom.custom_engineering.length) reasons.push(`${bom.custom_engineering.length} custom-engineering package${bom.custom_engineering.length > 1 ? 's' : ''} (${bom.custom_engineering.reduce((a, w) => a + w.person_days, 0)} person-days) close the gaps.`);
  for (const r of eligDev.slice(0, 3)) reasons.push(`Gap: ${short(r.requirement)}${r.req?.page ? ` (p. ${r.req.page})` : ''}.`);
  for (const r of eligPart.slice(0, Math.max(0, 3 - eligDev.length))) reasons.push(`To confirm: ${short(r.requirement)}${r.req?.page ? ` (p. ${r.req.page})` : ''}.`);
  let days: number | null = null;
  if (rfq.due_date) {
    const due = Date.parse(rfq.due_date.slice(0, 10));
    if (Number.isFinite(due)) { days = Math.round((due - today.getTime()) / 86_400_000); if (days >= 0) reasons.push(`Bid due ${rfq.due_date.slice(0, 10)}: ${days} days to close the gaps.`); }
  }

  let conf = 0.2 + 0.4 * coverage + 0.35 * (winRate ?? 0.5) - 0.07 * eligDev.length - 0.025 * eligPart.length - (days !== null && days < 10 ? 0.05 : 0);
  conf = Math.round(Math.min(0.95, Math.max(0.08, conf)) * 100) / 100;
  const decision: GoNoGo['decision'] = eligDev.length >= 3 || conf < 0.35 ? 'no_go' : eligDev.length || eligPart.length || conf < 0.6 ? 'conditional' : 'go';
  return { decision, confidence: conf, reasons, basis: { coverage: Math.round(coverage * 100) / 100, similar_won: won, similar_decided: similar.length, eligibility_gaps: eligDev.length, eligibility_to_confirm: eligPart.length, days_left: days } };
}
