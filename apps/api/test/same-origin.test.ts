import { describe, expect, it } from 'vitest';
import { sameOrigin } from '../src/lib/customer-security';

const PUBLIC = 'https://pactovio-meta.pages.dev', QA = 'https://qa.pactovio-meta.pages.dev';
function ctx(url: string, origin: string | null, env: Record<string, string>, site = 'same-origin') {
  const headers = new Headers({ 'sec-fetch-site': site });
  if (origin) headers.set('origin', origin);
  return { req: { url, header: (k: string) => headers.get(k) ?? undefined }, env } as never;
}
const env = { PUBLIC_ORIGIN: PUBLIC, EXTRA_ORIGINS: QA };

describe('sameOrigin with an extra qa origin', () => {
  it('accepts the public origin and the listed qa alias on its own host', () => {
    expect(() => sameOrigin(ctx(`${PUBLIC}/api/auth/code/request`, PUBLIC, env))).not.toThrow();
    expect(() => sameOrigin(ctx(`${QA}/api/auth/code/request`, QA, env))).not.toThrow();
  });
  it('rejects unlisted origins, a listed origin posting to another host, missing origin and cross-site', () => {
    expect(() => sameOrigin(ctx(`${QA}/api/x`, 'https://evil.example', env))).toThrow(/same-origin/);
    expect(() => sameOrigin(ctx(`${PUBLIC}/api/x`, QA, env))).toThrow(/same-origin/);
    expect(() => sameOrigin(ctx(`${QA}/api/x`, null, env))).toThrow(/same-origin/);
    expect(() => sameOrigin(ctx(`${QA}/api/x`, QA, env, 'cross-site'))).toThrow(/same-origin/);
  });
  it('keeps the old behaviour when no extra origins are configured', () => {
    expect(() => sameOrigin(ctx(`${QA}/api/x`, QA, { PUBLIC_ORIGIN: PUBLIC }))).toThrow(/same-origin/);
  });
});
