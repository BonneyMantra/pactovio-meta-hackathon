import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '@pactovio/contracts/env';
import { citedProducts } from '../src/lib/opportunity-search';
import { customerFixture } from './customer-fixture';
import { makeEnv } from './helpers';

let env: Env;
let dispose: () => Promise<void>;
let a: Awaited<ReturnType<typeof customerFixture>>, b: Awaited<ReturnType<typeof customerFixture>>;
beforeAll(async () => {
  ({ env, dispose } = await makeEnv());
  a = await customerFixture(env); b = await customerFixture(env);
  const add = (id: string, ws: string, sku: string, name: string) => env.DB.prepare("INSERT INTO products (id, workspace_id, sku, name, specs_json, unit_price_minor, currency) VALUES (?, ?, ?, ?, '{}', 100, 'INR')").bind(id, ws, sku, name).run();
  await add('pc1', a.workspace, 'RT-AP-8Z', 'Alarm Panel – 8/4 zones');
  await add('pc2', a.workspace, 'RT-EVA-G0', 'Edge Video Analytics');
  await add('pc3', b.workspace, 'OTHER-1', 'Another tenant product');
  const FIX = JSON.parse(readFileSync(join(__dirname, '../../../packages/brain/test/fixtures/RAX-PR-2025-041.json'), 'utf8'));
  const pj = (ref: string, status: string) => JSON.stringify({ ...FIX, ref, outcome: { status, decided_on: null, reason: 'r' },
    implementation_plan: FIX.implementation_plan.map((x: object) => ({ start_week: null, ...x })), commercials: { ...FIX.commercials, note: null } });
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO brain_learn_runs (id, workspace_id, folder_id, status, total, started_at) VALUES ('brn_citedcitedcited0001', ?, 'f', 'completed', 1, ?)").bind(a.workspace, now).run();
  await env.DB.prepare("INSERT INTO brain_documents (id, workspace_id, run_id, drive_file_id, filename, status, proposal_ref, proposal_json, updated_at) VALUES ('bdoc_c1', ?, 'brn_citedcitedcited0001', 'fc1', 'a.pdf', 'done', 'RAX/PR/2025/041', ?, ?)").bind(a.workspace, pj('RAX/PR/2025/041', 'won'), now).run();
}, 60_000);
afterAll(async () => dispose?.());

describe('tender matching products', () => {
  it('keeps only cited SKUs this workspace sells, with their catalogue names, once each', async () => {
    const cite = await citedProducts(env, a.workspace);
    const out = cite(['Matches the alarm panel [RT-AP-8Z] and analytics [rt-eva-g0, RT-FAKE-9].', 'Proven at a bank [RAX/PR/2025/041] with [RT-AP-8Z].']);
    expect(out.matched_products).toEqual([{ sku: 'RT-AP-8Z', name: 'Alarm Panel – 8/4 zones' }, { sku: 'RT-EVA-G0', name: 'Edge Video Analytics' }]);
    expect(out.matched_proposals).toEqual([expect.objectContaining({ ref: 'RAX/PR/2025/041', outcome: 'won' })]);
    expect(cite(['Like [RAX/PR/2099/999].']).matched_proposals).toEqual([]); // a ref the brain never learned is never shown
  });
  it('never matches another tenant\'s catalogue', async () => {
    expect((await citedProducts(env, a.workspace))(['Fits [OTHER-1].']).matched_products).toEqual([]);
    expect((await citedProducts(env, b.workspace))(['Fits [RT-AP-8Z] like [RAX/PR/2025/041].'])).toEqual({ matched_products: [], matched_proposals: [] });
  });
});
