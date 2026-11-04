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
}, 60_000);
afterAll(async () => dispose?.());

describe('tender matching products', () => {
  it('keeps only cited SKUs this workspace sells, with their catalogue names, once each', async () => {
    const cite = await citedProducts(env, a.workspace);
    expect(cite(['Matches the alarm panel [RT-AP-8Z] and analytics [rt-eva-g0, RT-FAKE-9].', 'Proven at a bank [RAX/PR/2025/041] with [RT-AP-8Z].']))
      .toEqual([{ sku: 'RT-AP-8Z', name: 'Alarm Panel – 8/4 zones' }, { sku: 'RT-EVA-G0', name: 'Edge Video Analytics' }]);
  });
  it('never matches another tenant\'s catalogue', async () => {
    expect((await citedProducts(env, a.workspace))(['Fits [OTHER-1].'])).toEqual([]);
    expect((await citedProducts(env, b.workspace))(['Fits [RT-AP-8Z].'])).toEqual([]);
  });
});
