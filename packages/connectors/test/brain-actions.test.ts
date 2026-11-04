import { describe, expect, it } from 'vitest';
import type { Env } from '@pactovio/contracts/env';
import { makeCtx, PROVIDER_ACTIONS } from '../src';
import type { ConnectorRow } from '../src/store';
import { fakeComposio } from './fake-composio';

const ctxFor = (provider: string, handlers: Parameters<typeof fakeComposio>[0], proxy?: NonNullable<Parameters<typeof fakeComposio>[1]>['proxy']) => {
  const f = fakeComposio(handlers, { proxy });
  const row: ConnectorRow = { id: 'cnx', workspace_id: 'ws_t', provider, status: 'connected', external_account_id: 'ca_test', meta: {}, connected_at: null };
  return { f, ctx: makeCtx({ COMPOSIO_API_KEY: 'k' } as Env, row, { fetch: f.fetch }) };
};
const PDF_B64 = btoa('%PDF-1.4 test');

describe('company brain readers', () => {
  it('hubspot.list_products pages through every product', async () => {
    let n = 0;
    const { ctx } = ctxFor('hubspot', {}, (r) => {
      n++;
      const after = (r as { parameters?: { name: string; value: string }[] }).parameters?.find((p) => p.name === 'after')?.value;
      return after ? { status: 200, data: { results: [{ id: '3' }] } } : { status: 200, data: { results: [{ id: '1' }, { id: '2' }], paging: { next: { after: 'cur2' } } } };
    });
    const out = await PROVIDER_ACTIONS.hubspot!.list_products!.run({}, ctx);
    expect((out.details!.products as unknown[]).length).toBe(3);
    expect(n).toBe(2);
  });
  it('googledrive.list_folders and list_files read Drive through FIND_FILE', async () => {
    const { ctx, f } = ctxFor('googledrive', { GOOGLEDRIVE_FIND_FILE: (a) => ({ files: [{ id: 'fold123456', name: 'Rax Proposals', size: '10' }], q: a.q }) });
    const folders = await PROVIDER_ACTIONS.googledrive!.list_folders!.run({ name: "Rax's" }, ctx);
    expect(folders.details!.folders).toEqual([{ id: 'fold123456', name: 'Rax Proposals', modified: null }]);
    expect(f.called('GOOGLEDRIVE_FIND_FILE')[0]!.args.q).toContain("name contains 'Rax\\'s'");
    const files = await PROVIDER_ACTIONS.googledrive!.list_files!.run({ folder_id: 'fold123456' }, ctx);
    expect(files.details!.files).toEqual([{ id: 'fold123456', name: 'Rax Proposals', size: 10 }]);
    await expect(PROVIDER_ACTIONS.googledrive!.list_files!.run({ folder_id: "x' or '1'='1" }, ctx)).rejects.toThrow();
  });
  it('googledrive.download_file falls back to the raw API and rejects non-PDF', async () => {
    const ok = ctxFor('googledrive', {}, () => ({ status: 200, data: { data: PDF_B64 } }));
    const out = await PROVIDER_ACTIONS.googledrive!.download_file!.run({ file_id: 'abc' }, ok.ctx);
    expect(out.details!.bytes).toBe(13);
    const bad = ctxFor('googledrive', {}, () => ({ status: 200, data: { data: btoa('<html>') } }));
    await expect(PROVIDER_ACTIONS.googledrive!.download_file!.run({ file_id: 'abc' }, bad.ctx)).rejects.toThrow(/not a PDF/);
  });
});

describe('hubspot.list_deals', () => {
  it('pages through all deals', async () => {
    const { ctx } = ctxFor('hubspot', {}, (r) => {
      const after = (r as { parameters?: { name: string; value: string }[] }).parameters?.find((p) => p.name === 'after')?.value;
      return after ? { status: 200, data: { results: [{ id: '3' }] } } : { status: 200, data: { results: [{ id: '1' }, { id: '2' }], paging: { next: { after: 'x' } } } };
    });
    const out = await PROVIDER_ACTIONS.hubspot!.list_deals!.run({}, ctx);
    expect((out.details!.deals as unknown[]).length).toBe(3);
  });
});
