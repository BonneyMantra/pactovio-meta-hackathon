import type { Proposal } from './schema';
import type { BrainStats, ProposalIndexRow } from './types';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}
export function mode(xs: string[]): string {
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}
const BANDS = [
  { label: 'Under ₹5 lakh', min_inr: 0, max_inr: 500_000 },
  { label: '₹5 - 25 lakh', min_inr: 500_000, max_inr: 2_500_000 },
  { label: '₹25 lakh - 1 crore', min_inr: 2_500_000, max_inr: 10_000_000 },
  { label: 'Over ₹1 crore', min_inr: 10_000_000, max_inr: null },
];
const engValue = (p: Proposal) => sum(p.custom_engineering.map((e) => e.person_days * e.rate_inr));

/** Every figure is computed from the extracted structured data, never by the model. */
export function computeStats(ps: Proposal[]): BrainStats {
  const totals = ps.map((p) => p.commercials.total_inr);
  const grand = sum(totals) || 1;
  const types = ['own_products', 'own_plus_external', 'own_plus_custom_engineering', 'fully_custom_engineered'] as const;
  const by_solution_type = Object.fromEntries(types.map((t) => {
    const g = ps.filter((p) => p.solution_type === t), v = sum(g.map((p) => p.commercials.total_inr));
    return [t, { count: g.length, value_inr: v, value_share: round(v / grand) }];
  })) as BrainStats['by_solution_type'];

  const line = (t: string) => sum(ps.flatMap((p) => p.scope_of_supply.filter((l) => l.type === t).map((l) => l.amount_inr)));
  const raw = {
    rax_products: line('rax_product'), external: line('external'), services: line('service'),
    custom_engineering: line('custom') + sum(ps.map(engValue)),
  };
  const rawTotal = sum(Object.values(raw)) || 1;
  const value_share = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, round(v / rawTotal)])) as BrainStats['value_share'];

  const won = ps.filter((p) => p.outcome.status === 'won'), lost = ps.filter((p) => p.outcome.status === 'lost');
  const pending = ps.filter((p) => p.outcome.status === 'pending');

  const sectors = new Map<string, { count: number; value_inr: number; won: number; lost: number }>();
  const regions = new Map<string, { count: number; value_inr: number }>();
  for (const p of ps) {
    const s = sectors.get(p.client.sector) ?? { count: 0, value_inr: 0, won: 0, lost: 0 };
    s.count++; s.value_inr += p.commercials.total_inr;
    if (p.outcome.status === 'won') s.won++;
    if (p.outcome.status === 'lost') s.lost++;
    sectors.set(p.client.sector, s);
    const region = p.client.city || p.client.country;
    const r = regions.get(region) ?? { count: 0, value_inr: 0 };
    r.count++; r.value_inr += p.commercials.total_inr;
    regions.set(region, r);
  }

  const prods = new Map<string, { sku: string; description: string; qty: number; value_inr: number; proposals: number }>();
  for (const p of ps) for (const l of p.scope_of_supply.filter((x) => x.type === 'rax_product')) {
    const e = prods.get(l.sku) ?? { sku: l.sku, description: l.description, qty: 0, value_inr: 0, proposals: 0 };
    e.qty += l.qty; e.value_inr += l.amount_inr; e.proposals++;
    prods.set(l.sku, e);
  }

  const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
  const dW = avg(won.map((p) => p.commercials.discount_pct)), dL = avg(lost.map((p) => p.commercials.discount_pct));
  const typical_margin_note = ps.length
    ? `Average discount ${round(avg(ps.map((p) => p.commercials.discount_pct)), 1)}% (won bids ${round(dW, 1)}%, lost bids ${round(dL, 1)}%); ` +
      `${Math.round(value_share.rax_products * 100)}% of quoted value is Rax-made product, ${Math.round(value_share.custom_engineering * 100)}% custom engineering.`
    : 'No proposals learned yet.';

  return {
    by_solution_type, value_share,
    win_rate: won.length + lost.length ? round(won.length / (won.length + lost.length)) : null,
    won: won.length, lost: lost.length, pending: pending.length,
    median_value_inr: median(totals),
    value_bands: BANDS.map((b) => ({ ...b, count: totals.filter((t) => t >= b.min_inr && (b.max_inr === null || t < b.max_inr)).length })),
    avg_turnaround_days: round(avg(ps.map((p) => p.turnaround_days)), 1),
    by_sector: [...sectors.entries()].map(([sector, v]) => ({ sector, ...v })).sort((a, b) => b.value_inr - a.value_inr),
    by_region: [...regions.entries()].map(([region, v]) => ({ region, ...v })).sort((a, b) => b.count - a.count),
    top_products: [...prods.values()].sort((a, b) => b.value_inr - a.value_inr).slice(0, 10),
    engineering_days_total: round(sum(ps.flatMap((p) => p.custom_engineering.map((e) => e.person_days))), 1),
    typical_margin_note,
  };
}

export function indexRow(p: Proposal, sourceFile: string): ProposalIndexRow {
  return { ref: p.ref, title: p.title, client: p.client.name, sector: p.client.sector, city: p.client.city, date: p.date,
    solution_type: p.solution_type, total_inr: p.commercials.total_inr, outcome: p.outcome.status, turnaround_days: p.turnaround_days, source_file: sourceFile };
}
