/**
 * Brain extraction eval. Usage:
 *   npx tsx scripts/evals/brain-extraction.ts --truth <dir> --snapshot <file> --out <json>
 * truth: directory of source proposal JSON files; snapshot: {workspace_id, run_id, queried_at,
 * documents:[{proposal_ref, proposal}]} exported read-only from brain_documents.
 * The committed output holds refs and numbers only, never document text.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregate, FIELD_NAMES, normRef, scoreExtraction, type DocScore } from '../../packages/evals/src/brain-score';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`missing --${name}`);
  return v;
}

const truthDir = arg('truth');
const snap = JSON.parse(readFileSync(arg('snapshot'), 'utf8'));
const truths = readdirSync(truthDir).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(truthDir, f), 'utf8')));
const extracted = new Map<string, Record<string, unknown>>();
for (const d of snap.documents) {
  const ref = d.proposal?.ref ?? d.proposal_ref;
  if (ref && d.proposal) extracted.set(normRef(ref), d.proposal);
}

const results: DocScore[] = [];
const missing: string[] = [];
for (const t of truths) {
  const ex = extracted.get(normRef(t.ref));
  if (!ex) { missing.push(t.ref); continue; }
  results.push(scoreExtraction(t, ex));
}
const agg = aggregate(results);
const round = (n: number): number => Math.round(n * 10000) / 10000;

const out = {
  generated_at: new Date().toISOString(),
  source: { workspace_id: snap.workspace_id, run_id: snap.run_id, snapshot_queried_at: snap.queried_at, database: 'pactovio-meta (read-only SELECT)' },
  coverage: { matched: results.length, truth_documents: truths.length, rate: round(results.length / truths.length), missing_refs: missing },
  overall: { score: round(agg.overall), fields: agg.overallFields, note: 'Macro mean of per-field accuracy over matched documents. outcome_status is reported but excluded: the app overrides outcome from HubSpot.' },
  field_accuracy: Object.fromEntries(Object.entries(agg.fieldAccuracy).map(([k, v]) => [k, { accuracy: round(v.accuracy), n: v.n }])),
  scope_of_supply: Object.fromEntries(Object.entries(agg.supply).map(([k, v]) => [k, round(v)])),
  per_ref: results.map((r) => ({
    ref: r.ref,
    score: round(mean(agg.overallFields.map((f) => r.fields[f]).filter((v): v is 0 | 1 => v !== null))),
    sku_f1: round(r.supply.f1),
    failed_fields: FIELD_NAMES.filter((f) => r.fields[f] === 0),
  })),
};
writeFileSync(arg('out'), JSON.stringify(out, null, 2) + '\n');

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const lines = [
  `Coverage: ${results.length}/${truths.length}   Overall: ${pct(agg.overall)}`,
  '', '| field | accuracy | n |', '|---|---|---|',
  ...Object.entries(agg.fieldAccuracy).map(([k, v]) => `| ${k} | ${pct(v.accuracy)} | ${v.n} |`),
  '', `SKU P/R/F1: ${pct(agg.supply.precision)} / ${pct(agg.supply.recall)} / ${pct(agg.supply.f1)}   qty exact: ${pct(agg.supply.qtyExactRate)}`,
];
process.stdout.write(lines.join('\n') + '\n');
