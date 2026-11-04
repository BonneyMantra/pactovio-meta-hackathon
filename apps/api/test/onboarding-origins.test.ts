import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { flowOrigin, isSiteOrigin, qaHandoff, siteOrigins } from '../src/lib/onboarding-origins';
import { sameOrigin } from '../src/lib/customer-security';

const QA = 'https://qa.pactovio-meta.pages.dev';
const env = { PUBLIC_ORIGIN: 'https://pactovio-meta.pages.dev', EXTRA_ORIGINS: QA };

function run(url: string, fn: (c: never) => unknown, headers: Record<string, string> = {}, e: Record<string, string> = env) {
  const app = new Hono();
  app.all('*', (c) => { try { return c.json({ v: fn(c as never) ?? null }); } catch (x) { return c.json({ err: (x as { code?: string }).code ?? 'error' }, 403); } });
  return Promise.resolve(app.request(url, { method: 'POST', headers }, e)).then((r) => r.json() as Promise<{ v?: unknown; err?: string }>);
}

describe('site origins', () => {
  it('lists the public alias and the QA host only', () => {
    expect(siteOrigins(env)).toEqual([env.PUBLIC_ORIGIN, QA]);
    expect(isSiteOrigin(env, 'https://evil.pages.dev')).toBe(false);
    expect(siteOrigins({ PUBLIC_ORIGIN: env.PUBLIC_ORIGIN, EXTRA_ORIGINS: 'not a url' })).toEqual([env.PUBLIC_ORIGIN]);
  });

  it('accepts same-origin posts from either host and rejects others', async () => {
    expect(await run(`${QA}/api/auth/code/request`, sameOrigin, { origin: QA })).toEqual({ v: null });
    expect(await run(`${env.PUBLIC_ORIGIN}/api/auth/code/request`, sameOrigin, { origin: env.PUBLIC_ORIGIN })).toEqual({ v: null });
    expect(await run(`${env.PUBLIC_ORIGIN}/api/x`, sameOrigin, { origin: 'https://evil.example' })).toEqual({ err: 'origin_forbidden' });
    expect(await run(`${env.PUBLIC_ORIGIN}/api/x`, sameOrigin, { origin: QA, 'sec-fetch-site': 'cross-site' })).toEqual({ err: 'origin_forbidden' });
  });

  it('starts flows on the host they came from', async () => {
    expect(await run(`${QA}/api/connectors/hubspot/connect`, flowOrigin)).toEqual({ v: QA });
    expect(await run('https://pactovio-meta-api.workers.dev/api/x', flowOrigin)).toEqual({ v: env.PUBLIC_ORIGIN });
  });

  it('hands a cookieless verifier callback on the public alias to the QA host, and nothing else', async () => {
    const q = '/api/connectors/verifier?session_uri=abc';
    expect(await run(`${env.PUBLIC_ORIGIN}${q}`, (c) => qaHandoff(c, false))).toEqual({ v: `${QA}${q}` });
    expect(await run(`${env.PUBLIC_ORIGIN}${q}`, (c) => qaHandoff(c, true))).toEqual({ v: null });
    expect(await run(`${QA}${q}`, (c) => qaHandoff(c, false))).toEqual({ v: null });
    expect(await run(`${env.PUBLIC_ORIGIN}${q}`, (c) => qaHandoff(c, false), {}, { PUBLIC_ORIGIN: env.PUBLIC_ORIGIN })).toEqual({ v: null });
  });
});
