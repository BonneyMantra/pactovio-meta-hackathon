import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const DIRS = ['apps/api/src', 'apps/front/public', ...readdirSync(join(ROOT, 'packages')).map((p) => `packages/${p}/src`)];
const files = (dir: string): string[] => {
  let out: string[] = [];
  try { for (const e of readdirSync(dir)) { const p = join(dir, e); out = statSync(p).isDirectory() ? out.concat(files(p)) : /\.(ts|js|html|json)$/.test(e) ? out.concat(p) : out; } } catch { /* absent */ }
  return out;
};

describe('Meta-only search', () => {
  it('no source file calls a non-Meta web search vendor: every search is Muse Spark web_search on the Meta Model API', () => {
    const hits = DIRS.flatMap((d) => files(join(ROOT, d))).filter((f) => /tavily|serpapi|serper\.dev|api\.bing\.microsoft/i.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});
