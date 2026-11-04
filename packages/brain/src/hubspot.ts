export interface HubspotProductRaw { id: string; properties?: Record<string, string | null | undefined> }
export interface CatalogueItem {
  external_id: string; sku: string; name: string; family: string; description: string;
  unit_price_minor: number; currency: string; image_url: string | null; page_url: string | null; product_type: string | null;
}

export const HUBSPOT_PROPS = ['name', 'hs_sku', 'description', 'price', 'hs_product_type', 'hs_url', 'hs_images', 'hs_cost_of_goods_sold', 'hs_recurring_billing_period'];

const FAMILY_BY_PREFIX: [RegExp, string][] = [
  [/^RT-?(AP|ALM)/i, 'Alarm and intrusion'], [/^RT-?EVA/i, 'Edge video analytics'], [/^RT-?PC?MU/i, 'Power and battery monitoring'],
  [/^RT-?(DFI|THD|TH|DL|CC)/i, 'Cold-chain IoT'], [/^RT-?(GW|4G|COM)/i, 'Communication'], [/^RT-?(EM|ENR|MTR)/i, 'Energy monitoring'],
];
const FAMILY_BY_WORD: [RegExp, string][] = [
  [/alarm|siren|zone|intrusion|panic/i, 'Alarm and intrusion'], [/video|camera|analytic/i, 'Edge video analytics'], [/battery|power|pcmu|ups/i, 'Power and battery monitoring'],
  [/temperature|humidity|freezer|cold|logger/i, 'Cold-chain IoT'], [/gateway|4g|gsm|modem|communication/i, 'Communication'], [/energy|meter/i, 'Energy monitoring'],
  [/licen[cs]e|platform|software|dashboard/i, 'Software and platform'], [/install|commission|amc|support|service/i, 'Services'],
];

/** Category: a real HubSpot product type wins, then the SKU prefix, then the name. */
export function inferFamily(sku: string, name: string, productType?: string | null): string {
  for (const [re, f] of FAMILY_BY_PREFIX) if (re.test(sku)) return f;
  const hay = `${name} ${productType ?? ''}`;
  for (const [re, f] of FAMILY_BY_WORD) if (re.test(hay)) return f;
  return productType && !/^(non-?inventory|inventory|service)$/i.test(productType) ? productType : 'General';
}

/** HubSpot `price` is a decimal string in the account currency; the Rax account prices in INR. */
export function toMinor(price: string | null | undefined): number | null {
  if (price == null || price === '') return null;
  const n = Number(String(price).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

const url = (v?: string | null) => { const t = (v ?? '').split(/[;,\s]+/).find((x) => /^https?:\/\//i.test(x)); return t ?? null; };

export function mapHubspotProduct(raw: HubspotProductRaw, currency = 'INR'): CatalogueItem | null {
  const p = raw.properties ?? {};
  const name = (p.name ?? '').trim();
  const price = toMinor(p.price);
  if (!name || price === null) return null;
  const sku = (p.hs_sku ?? '').trim().toUpperCase() || `HS-${raw.id}`;
  return {
    external_id: String(raw.id), sku, name, family: inferFamily(sku, name, p.hs_product_type), description: (p.description ?? '').trim().slice(0, 2000),
    unit_price_minor: price, currency, image_url: url(p.hs_images), page_url: url(p.hs_url), product_type: p.hs_product_type ?? null,
  };
}
