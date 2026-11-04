import type { Proposal } from './schema';

export interface HubspotDealRaw { id: string; properties?: Record<string, string | null | undefined> }
export interface DealOutcome { ref: string; status: 'won' | 'lost' | 'pending'; decided_on: string | null; amount_inr: number | null; deal_id: string; dealname: string }
export type OutcomeSource = 'hubspot' | 'pdf';

export const DEAL_PROPS = ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline'];
const REF = /RAX\/PR\/20\d{2}\/\d{3}/i;

/** Deal names start with the proposal ref ("RAX/PR/2025/041 · Title"). */
export function parseRef(dealname: string | null | undefined): string | null {
  const m = REF.exec((dealname ?? '').trim());
  return m && (dealname ?? '').trim().toUpperCase().startsWith(m[0].toUpperCase()) ? m[0].toUpperCase() : null;
}
export function stageStatus(stage: string | null | undefined): 'won' | 'lost' | 'pending' {
  const s = stage ?? '';
  if (/closed.?lost|lost/i.test(s)) return 'lost';
  if (/closed.?won|won/i.test(s)) return 'won';
  return 'pending';
}

/** One outcome per ref; when a ref has several deals the latest close date wins. */
export function mapDeals(raw: HubspotDealRaw[]): Map<string, DealOutcome> {
  const out = new Map<string, DealOutcome>();
  for (const d of raw) {
    const p = d.properties ?? {}, ref = parseRef(p.dealname);
    if (!ref) continue;
    const amount = Number(p.amount);
    const decided = p.closedate ? String(p.closedate).slice(0, 10) : null;
    const o: DealOutcome = { ref, status: stageStatus(p.dealstage), decided_on: decided, amount_inr: Number.isFinite(amount) && p.amount ? Math.round(amount) : null, deal_id: String(d.id), dealname: String(p.dealname) };
    const prev = out.get(ref);
    if (!prev || (o.decided_on ?? '') >= (prev.decided_on ?? '')) out.set(ref, o);
  }
  return out;
}

/** Join CRM outcomes onto extracted proposals; refs without a deal keep the PDF-derived outcome. */
export function applyOutcomes(ps: Proposal[], deals: Map<string, DealOutcome>): { proposal: Proposal; outcome_source: OutcomeSource }[] {
  return ps.map((p) => {
    const d = deals.get(p.ref.toUpperCase());
    if (!d) return { proposal: p, outcome_source: 'pdf' as const };
    return { proposal: { ...p, outcome: { status: d.status, decided_on: d.status === 'pending' ? null : d.decided_on, reason: p.outcome.reason } }, outcome_source: 'hubspot' as const };
  });
}
