import type { Proposal } from './schema';

/** Indian digit grouping: 4584026 -> "45,84,026". */
export function groupInr(n: number): string {
  const s = String(Math.abs(Math.round(n)));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${rest ? `${rest},` : ''}${last3}`;
}
export const fmtInr = (n: number): string => `₹${groupInr(n)}`;

const pct = (amount: number, p: number): number => Math.round((amount * p) / 100);

export interface TotalsInput {
  supply: { qty: number; unit_price_inr: number }[];
  engineering: { person_days: number; rate_inr: number }[];
  discount_pct: number;
  /** 18 for a domestic (India) buyer, 0 for export. */
  gst_pct: 0 | 18;
  hardwareBase?: number;
  amc_pct?: number;
}

/** All commercial totals in integer rupees, computed in code (never by a model). */
export function computeTotals(t: TotalsInput): Pick<Proposal['commercials'], 'supply_subtotal_inr' | 'engineering_subtotal_inr' | 'subtotal' | 'discount_pct' | 'discount_inr' | 'taxable_inr' | 'gst_pct' | 'gst_inr' | 'total_inr'> {
  const supply = t.supply.reduce((s, l) => s + Math.round(l.qty * l.unit_price_inr), 0);
  const eng = t.engineering.reduce((s, l) => s + Math.round(l.person_days * l.rate_inr), 0);
  const subtotal = supply + eng;
  const discount_pct = Math.min(15, Math.max(0, t.discount_pct));
  const discount_inr = pct(subtotal, discount_pct);
  const taxable_inr = subtotal - discount_inr;
  const gst_inr = pct(taxable_inr, t.gst_pct);
  return { supply_subtotal_inr: supply, engineering_subtotal_inr: eng, subtotal, discount_pct, discount_inr, taxable_inr, gst_pct: t.gst_pct, gst_inr, total_inr: taxable_inr + gst_inr };
}

export const lineAmount = (qty: number, unit: number): number => Math.round(qty * unit);
export const amcAnnual = (base: number, amcPct: number): number => pct(base, amcPct);

/** Catalogue price (minor units, INR paise) to whole rupees. */
export const minorToInr = (minor: number): number => Math.round(minor / 100);

/** True when every figure in commercials re-derives from the lines. Used by tests and the claim check. */
export function totalsConsistent(p: Pick<Proposal, 'scope_of_supply' | 'custom_engineering' | 'commercials'>): boolean {
  const c = computeTotals({ supply: p.scope_of_supply, engineering: p.custom_engineering, discount_pct: p.commercials.discount_pct, gst_pct: p.commercials.gst_pct });
  return c.total_inr === p.commercials.total_inr && c.subtotal === p.commercials.subtotal && p.scope_of_supply.every((l) => l.amount_inr === lineAmount(l.qty, l.unit_price_inr));
}
