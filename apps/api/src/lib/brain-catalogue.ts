import type { Env } from '@pactovio/contracts/env';
import { HttpError } from '@pactovio/contracts';
import { runAction } from '@pactovio/connectors';
import { HUBSPOT_PROPS, mapHubspotProduct, type CatalogueItem, type HubspotProductRaw } from '@pactovio/brain';
import { randomToken } from './db';
import { fetchPublic, parsePublicUrl, registrableDomain } from './site-guard';
import { sniffImage, storeImage, type ProductImageRow } from './product-image';

export interface SyncResult { imported: number; updated: number; skipped: number; images_fetched: number; images_failed: number; total_in_hubspot: number }
type Existing = { id: string; sku: string; name: string; family: string | null; specs_json: string; unit_price_minor: number; currency: string; image_key: string | null; image_source_url: string | null };

const specsOf = (it: CatalogueItem, prev: Record<string, unknown> = {}) => ({
  ...prev, unit: 'each', description: it.description, source: 'hubspot', hubspot_id: it.external_id,
  ...(it.page_url ? { source_url: it.page_url } : {}), ...(it.product_type ? { hubspot_product_type: it.product_type } : {}),
  ...(it.unit_price_minor === 0 ? { zero_price_confirmed: false } : {}),
});

/** Idempotent upsert keyed on (workspace, SKU). Products a person created or edited by hand (source != hubspot) are never overwritten. */
export async function upsertCatalogue(db: D1Database, ws: string, items: CatalogueItem[]): Promise<{ imported: number; updated: number; skipped: number; touched: { id: string; item: CatalogueItem; image_key: string | null; image_source_url: string | null }[] }> {
  const existing = (await db.prepare('SELECT id, sku, name, family, specs_json, unit_price_minor, currency, image_key, image_source_url FROM products WHERE workspace_id = ?').bind(ws).all<Existing>()).results;
  const bySku = new Map(existing.map((e) => [e.sku.toUpperCase(), e]));
  const seen = new Set<string>();
  const stmts: D1PreparedStatement[] = [];
  const touched: { id: string; item: CatalogueItem; image_key: string | null; image_source_url: string | null }[] = [];
  let imported = 0, updated = 0, skipped = 0;
  for (const it of items) {
    if (seen.has(it.sku)) { skipped++; continue; }
    seen.add(it.sku);
    const cur = bySku.get(it.sku);
    if (!cur) {
      const id = `prd_${randomToken(10)}`;
      stmts.push(db.prepare('INSERT INTO products (id, workspace_id, sku, name, family, specs_json, unit_price_minor, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, ws, it.sku, it.name, it.family, JSON.stringify(specsOf(it)), it.unit_price_minor, it.currency));
      touched.push({ id, item: it, image_key: null, image_source_url: null });
      imported++;
      continue;
    }
    let prev: Record<string, unknown> = {};
    try { prev = JSON.parse(cur.specs_json) as Record<string, unknown>; } catch { /* keep empty */ }
    if (prev.source !== 'hubspot') { skipped++; continue; }
    touched.push({ id: cur.id, item: it, image_key: cur.image_key, image_source_url: cur.image_source_url });
    const next = JSON.stringify(specsOf(it, prev));
    if (cur.name === it.name && cur.family === it.family && cur.unit_price_minor === it.unit_price_minor && cur.currency === it.currency && cur.specs_json === next) { skipped++; continue; }
    stmts.push(db.prepare('UPDATE products SET name = ?, family = ?, specs_json = ?, unit_price_minor = ?, currency = ? WHERE id = ? AND workspace_id = ?')
      .bind(it.name, it.family, next, it.unit_price_minor, it.currency, cur.id, ws));
    updated++;
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return { imported, updated, skipped, touched };
}

const IMAGE_OPTS = { accept: 'image/png,image/jpeg,image/webp', maxBytes: 5_000_000, types: /^image\/(png|jpe?g|webp)/i };

/** Download a HubSpot product image through the SSRF guard and store it with the existing product-image handling. */
async function fetchImage(env: Env, row: ProductImageRow, url: string): Promise<void> {
  const start = parsePublicUrl(url);
  const img = await fetchPublic(start, registrableDomain(start.hostname), (i, init) => fetch(i, init), new Set(), IMAGE_OPTS);
  if (!sniffImage(img.bytes)) throw new HttpError(422, 'Not a PNG, JPEG or WebP image', 'image_unreadable');
  await storeImage(env, row, img.bytes, img.url.href);
}

export async function syncHubspot(env: Env, ws: string): Promise<SyncResult> {
  const r = await runAction(env, ws, 'hubspot', 'list_products', { properties: HUBSPOT_PROPS.join(',') });
  if (!r.ok) {
    const o = r.output as { error?: string; code?: string };
    throw new HttpError(o.code === 'not_connected' ? 409 : 502, o.code === 'not_connected' ? 'Connect HubSpot first.' : 'HubSpot products could not be read. Try again shortly.', o.code === 'not_connected' ? 'not_connected' : 'provider_error');
  }
  const raw = ((r.output as { details?: { products?: HubspotProductRaw[] } }).details?.products ?? []);
  const items = raw.map((p) => mapHubspotProduct(p)).filter((x): x is CatalogueItem => !!x);
  const res = await upsertCatalogue(env.DB, ws, items);
  let fetched = 0, failed = 0;
  const todo = res.touched.filter((t) => t.item.image_url && (!t.image_key || t.image_source_url !== t.item.image_url));
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async (t) => {
      try {
        await fetchImage(env, { id: t.id, workspace_id: ws, specs_json: null, image_key: t.image_key }, t.item.image_url!);
        fetched++;
      } catch { failed++; }
    }));
  }
  return { imported: res.imported, updated: res.updated, skipped: res.skipped + (raw.length - items.length), images_fetched: fetched, images_failed: failed, total_in_hubspot: raw.length };
}
