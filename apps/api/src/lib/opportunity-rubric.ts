import { z } from 'zod';
import type { FitRubric, NoticeAssessment } from '@pactovio/contracts';
import type { Money } from '@pactovio/sources';

/**
 * The explainable tender-fit rubric. Muse Spark reads the notice and extracts evidence (requirements mapped to catalogue SKUs, the most
 * similar past proposals, eligibility checks); every sub-score and the weighted total are computed here from that evidence, after the
 * SKUs and proposal refs are verified against the workspace's own catalogue and Company Brain.
 */
export const WEIGHTS = { capability: 40, track_record: 25, eligibility: 20, commercial: 15 } as const;
export const CAP_BELOW = 30, CAP_AT = 35;
export const CHECKS = ['Region and service presence', 'Certifications', 'Turnover and lots', 'Language', 'Deadline'] as const;

/** What the model returns for one notice (structured output). */
export const DeepRead = z.object({
  title: z.string().trim().min(1).max(400),
  summary: z.string().trim().min(1).max(700),
  requirements: z.array(z.object({ text: z.string().trim().min(1).max(240), skus: z.array(z.string().max(80)).max(4), coverage: z.enum(['full', 'partial', 'none']) })).min(1).max(8),
  similar_proposals: z.array(z.object({ ref: z.string().max(80), similarity: z.enum(['high', 'medium', 'low']), why: z.string().trim().max(240) })).max(3),
  eligibility: z.array(z.object({ check: z.enum(CHECKS), status: z.enum(['ok', 'risk', 'unknown']), note: z.string().trim().max(240) })).max(5),
  deciding_factor: z.string().trim().min(1).max(300),
  top_risk: z.string().trim().min(1).max(300),
});
export type DeepRead = z.infer<typeof DeepRead>;

export interface Evidence {
  products: { sku: string; name: string }[];
  proposals: { ref: string; client: string; sector: string; solution_type: string; total_inr: number; outcome: string }[];
}

/** Indicative conversion for comparing a notice's value with deals priced in rupees (labelled "about" in the UI). */
const TO_INR: Record<string, number> = { INR: 1, EUR: 90, GBP: 107, USD: 84, CHF: 95, PLN: 21, SEK: 8, NOK: 8, DKK: 12, CZK: 3.6, RON: 18, HUF: 0.23, OMR: 218, AED: 23, SAR: 22 };
export const toInr = (v: Money | undefined): number | null => {
  const rate = v ? TO_INR[v.currency.toUpperCase()] : undefined;
  return v && rate && v.amount_minor >= 100_00 ? Math.round((v.amount_minor / 100) * rate) : null;
};
export const crore = (inr: number) => (inr >= 1e7 ? `₹${(inr / 1e7).toFixed(inr >= 1e8 ? 0 : 1)} Cr` : `₹${(inr / 1e5).toFixed(1)} L`);

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : null; };

/** Deal-size band from the Company Brain: median of every learned proposal, and the range of the won ones. */
export function dealBand(ev: Evidence) {
  const all = ev.proposals.map((p) => p.total_inr).filter((x) => x > 0), won = ev.proposals.filter((p) => p.outcome === 'won').map((p) => p.total_inr).filter((x) => x > 0);
  return { median_inr: median(all), won_min_inr: won.length ? Math.min(...won) : null, won_max_inr: won.length ? Math.max(...won) : null };
}

export function commercialScore(valueInr: number | null, band: ReturnType<typeof dealBand>): { score: number; note: string } {
  if (valueInr === null) return { score: 50, note: 'Value not stated in the notice, scored neutral.' };
  if (!band.median_inr) return { score: 50, note: `About ${crore(valueInr)}; no past deals to compare with yet.` };
  const inWon = band.won_min_inr !== null && band.won_max_inr !== null && valueInr >= band.won_min_inr * 0.8 && valueInr <= band.won_max_inr * 1.25;
  const ratio = valueInr / band.median_inr, off = Math.abs(Math.log10(ratio));
  const score = Math.round(Math.max(10, Math.min(100, inWon ? 100 - 20 * off : 90 - 45 * off)));
  const band_ = band.won_min_inr !== null ? `, won deals ${crore(band.won_min_inr)}–${crore(band.won_max_inr!)}` : '';
  const rel = ratio >= 1.25 ? `${ratio.toFixed(1)}× the median deal` : ratio <= 0.8 ? `${(1 / ratio).toFixed(1)}× smaller than the median deal` : 'close to the median deal';
  return { score, note: `About ${crore(valueInr)}, ${rel} (${crore(band.median_inr)}${band_}).` };
}

const SIM = { high: 1, medium: 0.6, low: 0.3 } as const, OUT: Record<string, number> = { won: 1, pending: 0.75, lost: 0.55 };
const CHECK_PTS = { ok: 1, unknown: 0.6, risk: 0.1 } as const;
const clean = (s: string) => s.trim().replace(/^\[|\]$/g, '').toUpperCase();

/** Verify the model's evidence against the workspace and compute the rubric. Pure: easy to test, nothing invented survives. */
export function scoreRubric(read: DeepRead, ev: Evidence, value: Money | undefined, meta: { model: string; chars: number; documents_url: string | null }): FitRubric {
  const bySku = new Map(ev.products.map((p) => [p.sku.toUpperCase(), p])), byRef = new Map(ev.proposals.map((p) => [p.ref.toUpperCase(), p]));
  const requirements = read.requirements.map((r) => {
    const products = [...new Map(r.skus.map((s) => bySku.get(clean(s))).filter((p): p is Evidence['products'][number] => !!p).map((p) => [p.sku, { sku: p.sku, name: p.name }])).values()];
    // A product requirement the model marks covered but cites no real SKU for is at most partial.
    const coverage = r.coverage === 'full' && !products.length && r.skus.length ? 'partial' : r.coverage;
    return { text: r.text, coverage, products };
  });
  const coverage_pct = Math.round((100 * requirements.reduce((n, r) => n + (r.coverage === 'full' ? 1 : r.coverage === 'partial' ? 0.5 : 0), 0)) / requirements.length);
  const past = read.similar_proposals.flatMap((s) => { const p = byRef.get(clean(s.ref)); return p ? [{ ...p, similarity: s.similarity, why: s.why }] : []; })
    .filter((p, i, a) => a.findIndex((x) => x.ref === p.ref) === i);
  const pts = past.map((p) => SIM[p.similarity] * (OUT[p.outcome] ?? 0.6)).sort((a, b) => b - a);
  const track = pts.length ? Math.round(Math.min(100, 100 * (pts[0]! + 0.25 * (pts[1] ?? 0)))) : 10;
  const won = past.filter((p) => p.outcome === 'won');
  const track_note = !past.length ? 'No comparable past proposal in the Company Brain.'
    : `${past.length} comparable proposal${past.length === 1 ? '' : 's'}${won.length ? `, ${won.length} won` : ', none won'}: closest ${past[0]!.ref} (${past[0]!.client}, ${past[0]!.outcome}).`;
  const eligibility = CHECKS.map((check) => read.eligibility.find((e) => e.check === check) ?? { check, status: 'unknown' as const, note: 'Not stated in the notice.' });
  const elig = Math.round((100 * eligibility.reduce((n, e) => n + CHECK_PTS[e.status], 0)) / eligibility.length);
  const band = dealBand(ev), valueInr = toInr(value), comm = commercialScore(valueInr, band);
  const scores = { capability: coverage_pct, track_record: track, eligibility: elig, commercial: comm.score };
  const weighted = Math.round((WEIGHTS.capability * scores.capability + WEIGHTS.track_record * scores.track_record + WEIGHTS.eligibility * scores.eligibility + WEIGHTS.commercial * scores.commercial) / 100);
  // Capability gate: when the catalogue covers under 30% of the requirements, no track record or deal size makes it a bid.
  const capped = coverage_pct < CAP_BELOW && weighted > CAP_AT, overall = capped ? CAP_AT : weighted;
  const risks = eligibility.filter((e) => e.status === 'risk').length;
  const verdict = overall >= 70 && risks <= 1 && coverage_pct >= 60 ? 'bid' : overall >= 50 && coverage_pct >= 40 ? 'bid_with_conditions' : 'pass';
  return {
    version: 2, model: meta.model, weights: { ...WEIGHTS }, scores, weighted, capped, overall, verdict, verdict_note: read.deciding_factor, top_risk: read.top_risk,
    requirements, coverage_pct, past, track_note, eligibility,
    commercial: { value_inr: valueInr, value_label: valueInr ? crore(valueInr) : null, ...band, note: comm.note },
    read: { chars: meta.chars, documents: false, documents_url: meta.documents_url },
  };
}

const VERDICT = { bid: 'Bid', bid_with_conditions: 'Bid with conditions', pass: 'Pass' } as const;
export const verdictLabel = (v: FitRubric['verdict']) => VERDICT[v];

/** The rubric in the older NoticeAssessment shape too, so saving, the deadlines and the list ordering keep working unchanged. */
export function toAssessment(read: DeepRead, rubric: FitRubric): NoticeAssessment {
  const covered = rubric.requirements.filter((r) => r.coverage !== 'none' && r.products.length);
  return {
    title: read.title, summary: read.summary, score: rubric.overall,
    reasons: [`${verdictLabel(rubric.verdict)}: ${read.deciding_factor}`.slice(0, 300)],
    strengths: covered.slice(0, 3).map((r) => `${r.text} [${r.products.map((p) => p.sku).join(', ')}]`.slice(0, 300)),
    risks: [read.top_risk.slice(0, 300)], rubric,
  };
}
