/**
 * Offline scorer for Company Brain PDF extraction.
 *
 * Compares the source record a PDF was rendered from (truth) with the record Muse Spark
 * extracted from that PDF (extracted). Both use the ProposalSchema shape; only the fields
 * read here matter, so inputs are loosely typed and missing values are tolerated.
 *
 * Scoring conventions
 * - Every scalar field scores 1 (match), 0 (mismatch or missing in extraction) or null
 *   (absent in the truth, so the field is excluded from that document's average).
 * - Text is normalised: NFKC, lower-case, punctuation to spaces, whitespace collapsed.
 * - Numbers accept numeric strings with currency symbols, "INR" and thousands separators
 *   (including the Indian 5,95,197 grouping).
 * - total_inr matches within 0.5% relative tolerance; amc_pct within 0.01 points.
 * - title matches when token Jaccard similarity >= 0.8.
 * - Line items: SKU precision = matched/extracted, recall = matched/truth, F1 harmonic mean.
 *   Duplicate SKUs are matched one-to-one. qty is exact-match on matched SKUs.
 * - Custom engineering: item count equality, and total person-days within 5% relative.
 * - Compliance: row count equality.
 * - overall = macro mean of the per-field accuracies in OVERALL_FIELDS.
 */

export type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const FIELD_NAMES = [
  'ref', 'revision', 'date', 'validity_days', 'client_name', 'client_sector', 'client_city',
  'rfq_ref', 'title', 'solution_type', 'outcome_status', 'prepared_by', 'turnaround_days',
  'total_inr', 'warranty_months_commissioning', 'warranty_months_dispatch', 'amc_pct',
  'engineering_count', 'engineering_person_days', 'compliance_count',
] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

/** outcome_status is reported but not in the overall: the app overrides outcome from HubSpot. */
export const OVERALL_FIELDS: readonly FieldName[] = FIELD_NAMES.filter((f) => f !== 'outcome_status');

export const norm = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number'
    ? String(v).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    : '';

export const normRef = (v: unknown): string => norm(v).replace(/ /g, '');

export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number(v.replace(/[₹,\s]|inr|rs\.?/gi, '').replace(/%$/, ''));
  return v.trim() === '' || !Number.isFinite(n) ? null : n;
}

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '';
const get = (o: Rec | null | undefined, path: string): unknown =>
  path.split('.').reduce<any>((a, k) => (a == null ? undefined : a[k]), o); // eslint-disable-line @typescript-eslint/no-explicit-any

export function jaccard(a: string, b: string): number {
  const x = new Set(norm(a).split(' ').filter(Boolean));
  const y = new Set(norm(b).split(' ').filter(Boolean));
  if (x.size === 0 && y.size === 0) return 1;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

const within = (a: number, b: number, rel: number): boolean =>
  a === b || Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b));

type Cmp = (t: unknown, e: unknown) => boolean;
const text: Cmp = (t, e) => norm(t) === norm(e) && norm(e) !== '';
const exactNum: Cmp = (t, e) => toNum(t) !== null && toNum(t) === toNum(e);
const ref: Cmp = (t, e) => normRef(t) === normRef(e) && normRef(e) !== '';
/** rfq_ref in the source often carries "dated 8 January 2024": accept id-only extraction. */
const rfq: Cmp = (t, e) => {
  const a = norm(t), b = norm(e);
  return b !== '' && (a === b || a.startsWith(b + ' ') || b.startsWith(a + ' '));
};

const SCALARS: Array<[FieldName, string, Cmp]> = [
  ['ref', 'ref', ref], ['revision', 'revision', text], ['date', 'date', (t, e) => t === e],
  ['validity_days', 'validity_days', exactNum], ['client_name', 'client.name', text],
  ['client_sector', 'client.sector', text], ['client_city', 'client.city', text],
  ['rfq_ref', 'rfq_ref', rfq], ['title', 'title', (t, e) => jaccard(String(t), String(e ?? '')) >= 0.8],
  ['solution_type', 'solution_type', text], ['outcome_status', 'outcome.status', text],
  ['prepared_by', 'prepared_by.name', text], ['turnaround_days', 'turnaround_days', exactNum],
  ['total_inr', 'commercials.total_inr', (t, e) => toNum(t) !== null && toNum(e) !== null && within(toNum(t)!, toNum(e)!, 0.005)],
  ['warranty_months_commissioning', 'warranty_amc.warranty_months_from_commissioning', exactNum],
  ['warranty_months_dispatch', 'warranty_amc.warranty_months_from_dispatch', exactNum],
  ['amc_pct', 'warranty_amc.amc_pct_of_hardware', (t, e) => toNum(t) !== null && toNum(e) !== null && Math.abs(toNum(t)! - toNum(e)!) < 0.01],
];

export interface LineItemScore {
  truthCount: number; extractedCount: number; matched: number; qtyMatched: number;
  precision: number; recall: number; f1: number;
}

const sku = (s: unknown): string => String(s ?? '').trim().toUpperCase();
const f1of = (p: number, r: number): number => (p + r === 0 ? 0 : (2 * p * r) / (p + r));

export function scoreLineItems(truth: Rec[], extracted: Rec[]): LineItemScore {
  const pool = new Map<string, Rec[]>();
  for (const l of extracted) pool.set(sku(l.sku), [...(pool.get(sku(l.sku)) ?? []), l]);
  let matched = 0, qtyMatched = 0;
  for (const t of truth) {
    const cand = pool.get(sku(t.sku))?.shift();
    if (!cand) continue;
    matched++;
    if (toNum(t.qty) !== null && toNum(t.qty) === toNum(cand.qty)) qtyMatched++;
  }
  const precision = extracted.length ? matched / extracted.length : 0;
  const recall = truth.length ? matched / truth.length : 0;
  return { truthCount: truth.length, extractedCount: extracted.length, matched, qtyMatched, precision, recall, f1: f1of(precision, recall) };
}

export interface DocScore {
  ref: string;
  fields: Record<FieldName, 0 | 1 | null>;
  supply: LineItemScore;
}

const arr = (v: unknown): Rec[] => (Array.isArray(v) ? v : []);
const days = (rows: Rec[]): number => rows.reduce((s, r) => s + (toNum(r.person_days) ?? 0), 0);

/** Score one extracted record against its truth record. `extracted` null = nothing extracted. */
export function scoreExtraction(truth: Rec, extracted: Rec | null): DocScore {
  const ex = extracted ?? {};
  const fields = {} as Record<FieldName, 0 | 1 | null>;
  for (const [name, path, cmp] of SCALARS) {
    const t = get(truth, path);
    fields[name] = !present(t) ? null : present(get(ex, path)) && cmp(t, get(ex, path)) ? 1 : 0;
  }
  const tEng = arr(truth.custom_engineering), eEng = arr(ex.custom_engineering);
  fields.engineering_count = tEng.length === eEng.length ? 1 : 0;
  fields.engineering_person_days = within(days(tEng), days(eEng), 0.05) ? 1 : 0;
  fields.compliance_count = arr(truth.compliance).length === arr(ex.compliance).length ? 1 : 0;
  return { ref: String(truth.ref ?? ''), fields, supply: scoreLineItems(arr(truth.scope_of_supply), arr(ex.scope_of_supply)) };
}

export interface Aggregate {
  documents: number;
  fieldAccuracy: Record<string, { accuracy: number; n: number }>;
  overall: number;
  overallFields: FieldName[];
  supply: { precision: number; recall: number; f1: number; qtyExactRate: number; macroF1: number; truthItems: number; extractedItems: number };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function aggregate(results: DocScore[]): Aggregate {
  const fieldAccuracy: Aggregate['fieldAccuracy'] = {};
  for (const f of FIELD_NAMES) {
    const vals = results.map((r) => r.fields[f]).filter((v): v is 0 | 1 => v !== null);
    fieldAccuracy[f] = { accuracy: mean(vals), n: vals.length };
  }
  const scored = OVERALL_FIELDS.filter((f) => fieldAccuracy[f].n > 0);
  const sum = (k: keyof LineItemScore): number => results.reduce((s, r) => s + r.supply[k], 0);
  const matched = sum('matched'), tc = sum('truthCount'), ec = sum('extractedCount');
  const precision = ec ? matched / ec : 0, recall = tc ? matched / tc : 0;
  return {
    documents: results.length,
    fieldAccuracy,
    overall: mean(scored.map((f) => fieldAccuracy[f].accuracy)),
    overallFields: scored,
    supply: {
      precision, recall, f1: f1of(precision, recall),
      qtyExactRate: matched ? sum('qtyMatched') / matched : 0,
      macroF1: mean(results.map((r) => r.supply.f1)),
      truthItems: tc, extractedItems: ec,
    },
  };
}
