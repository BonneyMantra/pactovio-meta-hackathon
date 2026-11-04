import { decodeHtml } from '@pactovio/sources';
import { assertPublicUrl, assertResolvesPublic, parsePublicUrl, SiteError } from './site-guard';

/** Company logo discovery: the homepage's own declared logo, fetched through an https-only, public-host-only guard. */
export type LogoType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/svg+xml' | 'image/x-icon';
export const LOGO_MAX_BYTES = 1_048_576;
export const PAGE_MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 6000, MAX_REDIRECTS = 3;

export function sniffLogo(b: Uint8Array): LogoType | null {
  const ascii = (from: number, n: number) => String.fromCharCode(...b.slice(from, from + n));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (b.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  const head = new TextDecoder().decode(b.slice(0, 2048)).replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

/** Bare domains become https URLs; anything not public https is refused (null). */
export function websiteUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || !raw.trim() || /^http:\/\//i.test(raw.trim())) return null;
  try { const u = parsePublicUrl(raw); return u.protocol === 'https:' ? u : null; } catch { return null; }
}

async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (Number(res.headers.get('content-length') ?? 0) > max) { await res.body?.cancel().catch(() => undefined); return null; }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total); let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** Guarded GET: https only, public hosts only (DoH-checked), at most 3 redirects. Returns null on any failure. */
export async function guardedGet(start: URL, accept: string, max: number, fetchFn: typeof fetch): Promise<{ url: URL; bytes: Uint8Array } | null> {
  let url = start;
  const resolved = new Set<string>();
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== 'https:') return null;
      assertPublicUrl(url);
      if (!resolved.has(url.hostname)) { await assertResolvesPublic(url.hostname, fetchFn); resolved.add(url.hostname); }
      const res = await fetchFn(url.href, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept, 'user-agent': 'PactovioSetupReader/1.0 (+https://pactovio.pages.dev)' } });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!location) return null;
        url = new URL(location, url); url.hash = '';
        continue;
      }
      if (!res.ok) { await res.body?.cancel().catch(() => undefined); return null; }
      const bytes = await readCapped(res, max);
      return bytes ? { url, bytes } : null;
    }
  } catch (e) { if (e instanceof SiteError || e instanceof TypeError || e instanceof DOMException) return null; throw e; }
  return null;
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decodeHtml(m[1] ?? m[2] ?? m[3] ?? '').trim() : '';
};
const sizeOf = (tag: string) => Math.max(0, ...[...attr(tag, 'sizes').matchAll(/(\d+)x\d+/gi)].map((m) => Number(m[1])));

/** Ordered logo candidates: JSON-LD Organization logo, apple-touch-icon, og:image, largest icon, /favicon.ico. */
export function logoCandidates(html: string, page: URL): string[] {
  const out: string[] = [];
  const add = (raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim() || /^data:/i.test(raw.trim())) return;
    try { const u = new URL(raw.trim(), page); u.hash = ''; if (!out.includes(u.href)) out.push(u.href); } catch { /* not a URL */ }
  };
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const nodes = ([] as unknown[]).concat(JSON.parse(m[1]!.trim())).flatMap((n) => ((n as { '@graph'?: unknown[] })?.['@graph'] ?? [n]));
      for (const n of nodes as Record<string, unknown>[]) {
        if (!([] as unknown[]).concat(n?.['@type'] ?? []).some((t) => /^(Organization|Corporation|LocalBusiness|.*Organization)$/i.test(String(t)))) continue;
        for (const l of ([] as unknown[]).concat(n.logo ?? [])) add(typeof l === 'string' ? l : (l as { url?: unknown; contentUrl?: unknown })?.url ?? (l as { contentUrl?: unknown })?.contentUrl);
      }
    } catch { /* malformed JSON-LD */ }
  }
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const rel = (tag: string) => attr(tag, 'rel').toLowerCase().split(/\s+/);
  for (const t of links.filter((l) => rel(l).includes('apple-touch-icon') || rel(l).includes('apple-touch-icon-precomposed')).sort((a, b) => sizeOf(b) - sizeOf(a))) add(attr(t, 'href'));
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (['og:image', 'og:image:secure_url'].includes((attr(m[0], 'property') || attr(m[0], 'name')).toLowerCase())) add(attr(m[0], 'content'));
  }
  for (const t of links.filter((l) => rel(l).includes('icon')).sort((a, b) => sizeOf(b) - sizeOf(a))) add(attr(t, 'href'));
  add('/favicon.ico');
  return out;
}

/** Find and download the company logo. Null when no candidate is a safe, supported image. */
export async function findCompanyLogo(site: URL, fetchFn: typeof fetch = fetch):
  Promise<{ bytes: Uint8Array; type: LogoType; source: string } | null> {
  const page = await guardedGet(site, 'text/html,application/xhtml+xml', PAGE_MAX_BYTES, fetchFn);
  const candidates = page ? logoCandidates(new TextDecoder('utf-8').decode(page.bytes), page.url) : [];
  if (!page) candidates.push(new URL('/favicon.ico', site).href);
  let tried = 0;
  for (const href of candidates) {
    let u: URL;
    try { u = new URL(href); } catch { continue; }
    if (u.protocol !== 'https:' || /^(\[|\d)/.test(u.hostname)) continue; // never fetched: http and IP literals
    if (++tried > 5) break;
    const img = await guardedGet(u, 'image/*', LOGO_MAX_BYTES, fetchFn);
    const type = img && img.bytes.byteLength > 0 ? sniffLogo(img.bytes) : null;
    if (img && type) return { bytes: img.bytes, type, source: img.url.href };
  }
  return null;
}
