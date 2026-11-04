import type { Env } from '@pactovio/contracts/env';
import { lexicalScores } from '@pactovio/quote';
import { minorToInr } from './money';

export interface CatalogueItem { sku: string; name: string; family: string; description: string; unit: string; price_inr: number }

/** Workspace catalogue priced in INR. Internal costs (`product_costs`) are never read. Rows without an INR price are skipped. */
export async function loadCatalogue(env: Pick<Env, 'DB'>, workspaceId: string): Promise<CatalogueItem[]> {
  const rs = await env.DB.prepare('SELECT sku, name, family, specs_json, unit_price_minor, currency FROM products WHERE workspace_id = ? ORDER BY sku').bind(workspaceId).all<{ sku: string; name: string; family: string | null; specs_json: string; unit_price_minor: number; currency: string }>();
  const out: CatalogueItem[] = [];
  for (const r of rs.results) {
    let specs: { description?: string; unit?: string; prices?: Record<string, number> } = {};
    try { specs = JSON.parse(r.specs_json) as typeof specs; } catch { /* keep empty */ }
    const minor = typeof specs.prices?.INR === 'number' ? specs.prices.INR : r.currency === 'INR' ? r.unit_price_minor : null;
    if (minor === null || !Number.isSafeInteger(minor) || minor < 0) continue;
    out.push({ sku: r.sku, name: r.name, family: r.family ?? '', description: String(specs.description ?? '').slice(0, 400), unit: specs.unit || 'nos', price_inr: minorToInr(minor) });
  }
  return out;
}

const text = (c: CatalogueItem) => `${c.sku} ${c.name} ${c.family} ${c.description}`;

/** Lexical shortlist: union over requirements of the top-k items, ranked by best score. The model ranks within this set only. */
export function shortlist(items: CatalogueItem[], queries: string[], perQuery = 6, cap = 40): CatalogueItem[] {
  const best = new Map<string, { item: CatalogueItem; score: number }>();
  const docs = items.map((c) => ({ text: text(c), c }));
  for (const q of queries) {
    for (const r of lexicalScores(q, docs, perQuery)) {
      const cur = best.get(r.item.c.sku);
      if (!cur || r.score > cur.score) best.set(r.item.c.sku, { item: r.item.c, score: r.score });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, cap).map((x) => x.item);
}
