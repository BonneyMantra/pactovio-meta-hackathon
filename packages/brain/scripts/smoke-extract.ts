/** Live smoke (not CI): Muse Spark reads one sample proposal PDF and we compare it with the ground-truth JSON.
 *  Usage: set -a; . ./.env.local; set +a; npx tsx packages/brain/scripts/smoke-extract.ts [path/to/proposal.pdf] */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { extractProposal } from '../src';

const pdf = process.argv[2] ?? join(import.meta.dirname, '../../../../pactovio-demo-data/rax-proposals/samples/RAX-PR-2025-041.pdf');
const truthPath = pdf.replace(/\.pdf$/, '.json');
const key = process.env.META_API_KEY ?? process.env.PACTOVIO_META_MODEL_API_KEY;
if (!key) throw new Error('Set META_API_KEY (or PACTOVIO_META_MODEL_API_KEY)');

const { extraction, costUsd, tokensIn, tokensOut } = await extractProposal({ META_API_KEY: key }, new Uint8Array(readFileSync(pdf)), basename(pdf));
const got = extraction.proposal;
const truth = JSON.parse(readFileSync(truthPath, 'utf8'));
const row = (k: string, a: unknown, b: unknown) => process.stdout.write(`${a === b ? 'OK  ' : 'DIFF'} ${k}: extracted=${JSON.stringify(a)} truth=${JSON.stringify(b)}\n`);
row('ref', got.ref, truth.ref);
row('solution_type', got.solution_type, truth.solution_type);
row('total_inr', got.commercials.total_inr, truth.commercials.total_inr);
row('client', got.client.name, truth.client.name);
row('outcome', got.outcome.status, truth.outcome.status);
row('line_items', got.scope_of_supply.length, truth.scope_of_supply.length);
row('payment_terms', got.commercials.payment_terms, truth.commercials.payment_terms);
const skus = new Set<string>(truth.scope_of_supply.map((l: { sku: string }) => l.sku));
const hit = got.scope_of_supply.filter((l) => skus.has(l.sku)).length;
process.stdout.write(`SKU recall ${hit}/${skus.size}; sections=${extraction.section_order.length}; tokens in/out ${tokensIn}/${tokensOut}; cost $${costUsd.toFixed(4)}\n`);
