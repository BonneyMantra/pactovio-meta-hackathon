import { z } from 'zod';
import { chatJSON, type CallOptions } from '@pactovio/models';
import { fromRow, HttpError, type DesignRequest } from '@pactovio/contracts';
import type { Env } from '@pactovio/contracts/env';
import { buildMatches, normSku, resolveCitation, uniqueKeys, type Cand, type Judged } from './judge';
import { lexicalRank } from './lexical';

export interface MatchOptions extends Pick<CallOptions, 'onStep' | 'fetch' | 'signal'> {
  /** Test/recording hook: the per-requirement ranking and the candidate list sent to the judge. */
  trace?: (t: { ranks: string[][]; cands: string[] }) => void;
}

const Extracted = z.object({
  buyer_country: z.string().nullable().describe('ISO 3166-1 alpha-2 country of the buyer, from address or signature'),
  requirements: z.array(z.object({
    key: z.string().describe('snake_case identifier, e.g. visibility_range'),
    text: z.string().describe('one requirement, self-contained, with numbers and units'),
    value: z.string().nullable().describe('the headline value, e.g. "10 m - 10 km"'),
    mandatory: z.boolean(),
  })).min(1).max(20),
});

const Verdicts = z.object({
  requirements: z.array(z.object({
    key: z.string(),
    status: z.enum(['MET', 'PARTIAL', 'GAP']),
    sku: z.string().nullable().describe('the catalogue SKU that best answers this requirement, or null for a GAP'),
    note: z.string().describe('one sentence: what the datasheet says versus what was asked'),
    chunk: z.string().regex(/^C\d{1,3}$/).nullable().describe('ONLY the candidate id, such as C7, whose line supports the verdict'),
    quote: z.string().nullable().describe('3 to 12 consecutive words copied exactly from that candidate line, e.g. "10 m to 75 km"; never a summary'),
  })),
  proposed: z.array(z.object({ sku: z.string(), qty: z.number().int().positive(), why: z.string() })),
});

/** Extract requirements (Muse Spark), shortlist datasheet lines lexically, judge MET/PARTIAL/GAP with quotes (Muse Spark), persist. */
export async function matchDesignRequest(env: Env, designRequestId: string, o: MatchOptions = {}): Promise<DesignRequest> {
  const db = env.DB;
  const dr = fromRow<Record<string, unknown>>(await db.prepare('SELECT * FROM design_requests WHERE id = ?').bind(designRequestId).first());
  if (!dr || !dr.id) throw new HttpError(404, 'Design request not found', 'not_found');
  const ws = String(dr.workspace_id);
  const spec = String(dr.spec_text ?? '').trim();
  if (!spec) throw new HttpError(400, 'Design request has no specification text', 'validation');
  const base = { env, onStep: o.onStep, fetch: o.fetch, signal: o.signal };

  // Check customer setup before any paid model request.
  const prows = (await db.prepare('SELECT id, sku, name, unit_price_minor, currency, specs_json FROM products WHERE workspace_id = ?').bind(ws).all<Record<string, unknown>>()).results;
  if (!prows.length) throw new HttpError(409, 'Add your products and prices in Catalogue before matching a design request.', 'catalogue_required');
  const products = prows.map((p) => ({ id: String(p.id), sku: String(p.sku), name: String(p.name), specs: JSON.parse(String(p.specs_json ?? '{}')) as { unit?: string } }));
  const crows = (await db.prepare("SELECT c.id, c.text, e.title, e.meta_json FROM evidence_chunks c JOIN evidence e ON e.id = c.evidence_id WHERE c.workspace_id = ? AND e.kind = 'datasheet' ORDER BY e.id, c.seq").bind(ws).all<Record<string, unknown>>()).results;
  if (!crows.length) throw new HttpError(409, 'Upload your product datasheets in Evidence before matching a design request.', 'datasheets_required');

  const { data: ex } = await chatJSON(Extracted, {
    ...base, role: 'reason', purpose: 'extract requirements', schemaName: 'requirements', temperature: 0, maxTokens: 8000,
    messages: [
      { role: 'system', content: 'You extract technical requirements from a customer enquiry to a sensor manufacturer. List each measurable or checkable requirement separately (range, accuracy, interfaces, protocols, power, environment, ingress, comms, quantity, services, delivery). Always include a requirement with key "quantity" if the number of sites, stations or sets is stated. Do not invent requirements.' },
      { role: 'user', content: `Enquiry from ${dr.customer}:\n\n${spec}` },
    ],
  });
  const requirements = uniqueKeys(ex.requirements).map((r) => ({ key: r.key, text: r.text, mandatory: r.mandatory, ...(r.value ? { value: r.value } : {}) }));

  const chunks = crows.map((c) => {
    const meta = JSON.parse(String(c.meta_json ?? '{}')) as { doc_id?: string | null };
    return { id: String(c.id), text: String(c.text), title: String(c.title), docId: meta.doc_id ?? null };
  });

  const matchable = requirements.filter((r) => r.key !== 'quantity' && r.key !== 'buyer_country');
  const queries = matchable.map((r) => `${r.text}${r.value ? ` (${r.value})` : ''}`);
  const picked = new Map<string, Cand>();
  const add = (item: (typeof chunks)[number]) => { if (!picked.has(item.id)) picked.set(item.id, { cid: `C${picked.size + 1}`, text: item.text, title: item.title, docId: item.docId }); };
  const ranks: string[][] = [];
  queries.forEach((q) => {
    const top = lexicalRank(q, chunks, 6);
    ranks.push(top.map((c) => c.text));
    for (const item of top) add(item);
  });
  const cands = [...picked.values()];
  o.trace?.({ ranks, cands: cands.map((c) => c.text) });

  const { data: v } = await chatJSON(Verdicts, {
    ...base, role: 'reason', purpose: 'judge requirements against datasheets', schemaName: 'verdicts', temperature: 0, maxTokens: 9000,
    messages: [
      { role: 'system', content: 'You are a pre-sales engineer. For each requirement decide MET (datasheet value satisfies it), PARTIAL (close, or needs an accessory or caveat), or GAP (no listed product satisfies it). Judge numbers and units strictly and numerically (an IP67 rating satisfies a requirement of IP66 or better; a 10 m to 75 km range covers 10 m to 10 km). Cite only candidate text: put just the candidate id (for example C7) in chunk and copy 3 to 12 consecutive words from that line exactly into quote. For a GAP use null for both. Keep each note to one short sentence. Name exactly one SKU per requirement. Then propose the quote lines (SKU and quantity) that deliver the whole request: use the stated number of sites or stations as the quantity, include mast, installation days and cloud service only when the enquiry asks for them.' },
      { role: 'user', content: `ENQUIRY (${dr.customer}):\n${spec}\n\nREQUIREMENTS:\n${matchable.map((r) => `- ${r.key}: ${r.text}`).join('\n')}\n\nQUANTITY: ${requirements.find((r) => r.key === 'quantity')?.text ?? 'not stated'}\n\nCATALOGUE:\n${products.map((p) => `- ${p.sku}: ${p.name} (unit: ${p.specs.unit ?? 'each'})`).join('\n')}\n\nDATASHEET CANDIDATES:\n${cands.map((c) => `${c.cid} | ${c.text}`).join('\n')}` },
    ],
  });

  const known = new Set(products.map((p) => p.sku.toUpperCase()));
  const judged: Judged[] = v.requirements.map((r) => ({ ...r, sku: normSku(r.sku, known), citation: resolveCitation(r.chunk, r.quote, cands) }));
  const done = requirements.map((r) => {
    const j = judged.find((x) => x.key === r.key);
    if (!j) return r;
    // A MET verdict without a verifiable quote is downgraded: no citation, no claim.
    const status = j.status === 'MET' && !j.citation ? 'PARTIAL' : j.status;
    return { ...r, result: { status, sku: j.sku, note: j.citation || j.status !== 'MET' ? j.note : `${j.note} (no verifiable datasheet quote)`, citation: j.citation } };
  });
  const country = (ex.buyer_country ?? '').toUpperCase();
  if (country.length === 2 && !done.some((r) => r.key === 'buyer_country')) done.push({ key: 'buyer_country', text: `Buyer country: ${country}`, value: country, mandatory: false });
  const proposed = v.proposed.flatMap((p) => { const sku = normSku(p.sku, known); return sku ? [{ ...p, sku }] : []; });
  const matches = buildMatches(done, proposed, products);

  await db.prepare("UPDATE design_requests SET requirements_json = ?, matches_json = ?, status = 'matched' WHERE id = ?").bind(JSON.stringify(done), JSON.stringify(matches), designRequestId).run();
  return { id: designRequestId, workspace_id: ws, intake_id: (dr.intake_id as string | null) ?? null, customer: String(dr.customer), subject: String(dr.subject), spec_text: spec, requirements: done, matches, status: 'matched' } as DesignRequest;
}
