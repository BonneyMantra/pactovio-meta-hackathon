import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '@pactovio/contracts/env';
import { matchDesignRequest, type MatchOptions } from '../src';
import { makeSampleEnv } from './helpers';

/** Replays ONE recorded live run (extract + judge on the Westbay port enquiry, recorded before the move to Meta; the model name is anonymised). Chat responses are the recorded ones; datasheet shortlisting is lexical and runs live in the test. */
const rec = JSON.parse(readFileSync(resolve(__dirname, '../../../fixtures/samples/recorded/westbay-match.json'), 'utf8')) as {
  trace: { ranks: string[][]; cands: string[] };
  chat: { schema: string; body: unknown }[];
};

let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env, dispose } = await makeSampleEnv()), 90_000);
afterAll(async () => dispose?.());

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');

/** The recording was made with another shortlist, so its candidate ids (C7...) point at other lines. Re-point each verdict at the candidate that holds its quote in the live lexical shortlist. */
let liveCands: string[] = [];
const trace: NonNullable<MatchOptions['trace']> = (t) => { liveCands = t.cands; };
function remapCandidates(body: any) {
  const msg = body.choices[0].message;
  const j = JSON.parse(msg.content) as { requirements: { chunk: string | null; quote: string | null }[] };
  for (const r of j.requirements) {
    if (!r.quote) continue;
    const i = liveCands.findIndex((c) => norm(c).includes(norm(r.quote!)));
    if (i >= 0) r.chunk = `C${i + 1}`;
  }
  msg.content = JSON.stringify(j);
}

function replayFetch(mutate?: (schema: string, body: any) => void): typeof fetch {
  const queue = rec.chat.map((c) => JSON.parse(JSON.stringify(c)) as { schema: string; body: unknown });
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.endsWith('/chat/completions')) throw new Error(`unexpected live call to ${url}`);
    const sent = JSON.parse(String(init?.body)) as { response_format?: { json_schema?: { name?: string } } };
    const next = queue.shift();
    if (!next || next.schema !== sent.response_format?.json_schema?.name) throw new Error(`replay order mismatch: wanted ${next?.schema}, got ${sent.response_format?.json_schema?.name}`);
    if (next.schema === 'verdicts') remapCandidates(next.body);
    mutate?.(next.schema, next.body);
    return new Response(JSON.stringify(next.body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const env_ = () => env;

describe('matchDesignRequest (recorded run)', () => {
  it('extracts requirements, judges each against datasheet lines with verifiable citations, proposes quote lines, persists', async () => {
    const steps: string[] = [];
    const dr = await matchDesignRequest(env_(), 'dsg_sample_westbay', { fetch: replayFetch(), trace, onStep: (s) => { steps.push(s.purpose); } });
    expect(steps).toEqual(['extract requirements', 'judge requirements against datasheets']);
    expect(dr.status).toBe('matched');

    const judged = dr.requirements.filter((r) => r.result);
    expect(judged.length).toBeGreaterThanOrEqual(8);
    const met = judged.filter((r) => r.result!.status === 'MET');
    expect(met.length).toBeGreaterThanOrEqual(4);

    // Every citation is a verbatim datasheet line with a page and a document, checked against the stored chunks.
    const chunks = (await env.DB.prepare("SELECT c.text FROM evidence_chunks c JOIN evidence e ON e.id = c.evidence_id WHERE e.kind = 'datasheet'").all<{ text: string }>()).results.map((c) => norm(c.text));
    const cited = judged.filter((r) => r.result!.citation);
    expect(cited.length).toBeGreaterThanOrEqual(4);
    for (const r of cited) {
      const c = r.result!.citation!;
      expect(c.page).toBeGreaterThanOrEqual(1);
      expect(c.doc).toMatch(/datasheet/);
      expect(c.doc_id).toMatch(/^doc_k_ds_/);
      expect(chunks.some((t) => t.includes(norm(c.quote)))).toBe(true);
    }
    // No MET claim without a citation.
    for (const r of met) expect(r.result!.citation).not.toBeNull();

    const range = dr.requirements.find((r) => r.key === 'range')!.result!;
    expect(range.sku).toBe('VS-210');
    expect(range.status).toBe('MET');
    expect(range.citation!.quote).toMatch(/75 km/);

    const vs = dr.matches.find((m) => m.sku === 'VS-210')!;
    expect(vs.proposed_qty).toBe(6);
    expect(vs.product_id).toBe('prd_k_vs210');
    expect(vs.citations!.length).toBeGreaterThan(0);
    expect(dr.matches.every((m) => m.product_id.startsWith('prd_k_'))).toBe(true);

    const row = await env.DB.prepare('SELECT status, matches_json FROM design_requests WHERE id = ?').bind('dsg_sample_westbay').first<{ status: string; matches_json: string }>();
    expect(row?.status).toBe('matched');
    expect(JSON.parse(row!.matches_json)).toHaveLength(dr.matches.length);
  });

  it('downgrades a MET verdict whose quote is not in the cited datasheet line (no citation, no claim)', async () => {
    const tamper = (schema: string, body: any) => {
      if (schema !== 'verdicts') return;
      const msg = body.choices[0].message;
      const j = JSON.parse(msg.content) as { requirements: { quote: string | null }[] };
      for (const r of j.requirements) if (r.quote) r.quote = `${r.quote} and also 500 km range`;
      msg.content = JSON.stringify(j);
    };
    const dr = await matchDesignRequest(env_(), 'dsg_sample_westbay', { fetch: replayFetch(tamper), trace });
    const judged = dr.requirements.filter((r) => r.result);
    expect(judged.every((r) => r.result!.status !== 'MET')).toBe(true);
    expect(judged.every((r) => r.result!.citation === null)).toBe(true);
    expect(judged.some((r) => /no verifiable datasheet quote/.test(r.result!.note))).toBe(true);
  });

  it('rejects an empty spec and an unknown id without calling a model', async () => {
    await env.DB.prepare("UPDATE design_requests SET spec_text = '' WHERE id = 'dsg_k_kilbrook'").run();
    const never = (async () => { throw new Error('live call'); }) as unknown as typeof fetch;
    await expect(matchDesignRequest(env_(), 'dsg_k_kilbrook', { fetch: never })).rejects.toMatchObject({ status: 400 });
    await expect(matchDesignRequest(env_(), 'dsg_nope', { fetch: never })).rejects.toMatchObject({ status: 404 });
  });
});
