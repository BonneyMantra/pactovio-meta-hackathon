import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '@pactovio/contracts/env';
import { buildApp } from '../src/app';
import { sniffLogo } from '../src/lib/company-logo';
import { customerFixture } from './customer-fixture';
import { makeEnv } from './helpers';

let env: Env, dispose: () => Promise<void>;
let a: Awaited<ReturnType<typeof customerFixture>>, b: typeof a;
const { app } = buildApp();
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const get = (path = '/workspaces/logo', cookie = a.cookie) => app.fetch(new Request(`https://pactovio.example/api${path}`, { headers: { cookie } }), env, ctx);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const OG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const SITE = 'https://www.rax-tech-demo.com';
let seen: string[];
function stub(html: string) {
  seen = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (url.hostname === 'cloudflare-dns.com') return Response.json({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
    seen.push(url.href);
    if (url.href === `${SITE}/`) return new Response(html, { headers: { 'content-type': 'text/html' } });
    if (url.href === `${SITE}/images/logo.png`) return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    if (url.href === `${SITE}/og.jpg`) return new Response(OG, { headers: { 'content-type': 'image/jpeg' } });
    return new Response('nope', { status: 404 });
  }));
}
const setSite = (ws: string, website: string) => env.DB.prepare(`UPDATE company_onboarding SET data_json = json_patch(data_json, ?) WHERE workspace_id = ?`).bind(JSON.stringify({ website }), ws).run();
beforeAll(async () => { ({ env, dispose } = await makeEnv()); a = await customerFixture(env); b = await customerFixture(env); }, 60000);
afterAll(async () => dispose?.());
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/workspaces/logo', () => {
  it('needs a customer session', async () => {
    expect((await get('/workspaces/logo', '')).status).toBe(401);
  });
  it('returns 404 no_logo when the workspace has no website', async () => {
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'No company logo found', code: 'no_logo' });
  });
  it('prefers the JSON-LD Organization logo over og:image, stores it per workspace and serves the R2 copy next time', async () => {
    await setSite(a.workspace, 'www.rax-tech-demo.com');
    stub(`<html><head><meta property="og:image" content="/og.jpg"><link rel="icon" href="/favicon.ico">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","logo":{"@type":"ImageObject","url":"/images/logo.png"}}</script></head></html>`);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(seen).toContain(`${SITE}/images/logo.png`);
    expect(seen).not.toContain(`${SITE}/og.jpg`);
    const calls = seen.length;
    const again = await get();
    expect(again.status).toBe(200);
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(PNG);
    expect(seen.length).toBe(calls);
    expect((await get('/workspaces/logo', b.cookie)).status).toBe(404); // another workspace never sees it
  });
  it('never fetches an http:// or IP-literal logo, falling back to a safe candidate', async () => {
    await setSite(b.workspace, SITE);
    stub(`<html><head><script type="application/ld+json">{"@type":"Organization","logo":"http://www.rax-tech-demo.com/images/logo.png"}</script>
      <link rel="apple-touch-icon" href="https://169.254.169.254/icon.png"><meta property="og:image" content="/og.jpg"></head></html>`);
    const res = await get('/workspaces/logo', b.cookie);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(seen.some((u) => u.startsWith('http://') || u.includes('169.254'))).toBe(false);
  });
  it('sniffs svg and rejects html served as an image', () => {
    expect(sniffLogo(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml');
    expect(sniffLogo(new TextEncoder().encode('<html><svg/></html>'))).toBeNull();
  });
});
