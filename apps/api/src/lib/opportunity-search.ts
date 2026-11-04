import type { z } from 'zod';
import { HttpError, type OpportunitySearchInput } from '@pactovio/contracts';
import type { Env } from '@pactovio/contracts/env';
import { tokens } from '@pactovio/quote';
import {
  countryFromName, DOMAIN_LABELS, iso2, NOTICE_SOURCES, REGION_LABELS, regionOf, regionsInText, SEGMENT_DOMAINS, type Domain, type Region,
} from '@pactovio/sources';
import type { OnboardingState } from './onboarding-state';
import { withBrain } from './opportunity-brain';
import { cpvWords } from './opportunity-cpv';
import { proposalIndex } from './brain-store';
import { assessNotices, profileHash, readScores, type Readable } from './opportunity-assess';
import { capabilityProfile, cpvHit, cpvPrefixes, profileSummary, profileTerms } from './opportunity-profile';
import { loadDetail } from './opportunity-detail';
import { countryName, noticeValue, toNotice } from './opportunity-notice';
import { loadPool, noticeDomains, viewKey, type ViewTender } from './opportunity-pool';

export type SearchInput = z.output<typeof OpportunitySearchInput>;
const GENERIC = new Set(['services', 'service', 'solutions', 'solution', 'products', 'product', 'systems', 'system', 'supply', 'support', 'general',
  'company', 'quality', 'customer', 'customers', 'industry', 'industries', 'other', 'various', 'management', 'provision']);

// Words of the brain text's own framing ("Catalogue (67 products, first 40)", "Company Brain: learned from ..."), not what the company sells.
const FRAMING = new Set(['catalogue', 'first', 'brain', 'learned', 'past', 'proposals', 'proposal', 'rate', 'sectors', 'served', 'from']);

/** Ranking terms from what the customer confirmed (capabilities, offerings) plus the real catalogue and Company Brain (product names,
 * families, sectors, solution types), so a security-electronics catalogue pulls alarm and surveillance notices into the scored set.
 * Internal ranking signal, never a label. */
export function fitTerms(state: OnboardingState & { brainText?: string }): string[] {
  const keep = (t: string) => t.length >= 4 && !GENERIC.has(t) && !FRAMING.has(t) && !/\d/.test(t);
  const own = [...(state.company.capabilities ?? []), ...(state.profile.offerings ?? [])].flatMap((p) => tokens(p)).filter(keep);
  const brain = tokens((state.brainText ?? '').replace(/\[[^\]]*\]/g, ' ')).filter(keep); // [SKU] codes are not words
  return [...new Set([...own.slice(0, 60), ...brain])].slice(0, 160);
}
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Whole words only (plural allowed): "panel" must not match inside an unrelated word. */
const wordSet = (s: string) => new Set(s.split(/[^\p{L}\p{N}-]+/u).filter(Boolean));
const has = (w: Set<string>, term: string) => w.has(term) || w.has(`${term}s`) || w.has(`${term}es`);
const haystack = (t: ViewTender) => fold([t.title, t.buyer, ...t.lots.map((l) => l.title), typeof t.raw?.description === 'string' ? t.raw.description : ''].join(' '));

/** The user's own country and region first, then regions and countries named in their markets. */
function priorities(state: OnboardingState): { country: string; regions: Set<Region>; countries: Set<string> } {
  const country = state.company.country ?? '', markets = state.profile.markets ?? [];
  const regions = new Set<Region>(regionsInText(markets.join(' ')));
  const own = country ? regionOf(country) : null;
  if (own) regions.add(own);
  const countries = new Set(markets.map((m) => countryFromName(m)).filter(Boolean));
  for (const c of countries) { const r = regionOf(c); if (r) regions.add(r); }
  return { country, regions, countries };
}

type Row = { t: ViewTender; key: string; code: string; region: Region | null; domains: Domain[]; words: string; score?: number; heuristic: number };
// Read and scored notices first, best rubric score first; the recall order decides among notices not read yet (they are read in the
// background, so the list converges on the best fits instead of re-reading a fresh batch on every open).
const tier = (r: Row) => (r.score === undefined ? 1 : 0);
/** The first relevance page deep-assesses the top candidates eagerly (each a full read on Muse Spark) and keeps the best. */
const FIRST_PAGE_CANDIDATES = 12;
const byRelevance = (a: Row, b: Row) => tier(a) - tier(b) || (b.score ?? 0) - (a.score ?? 0) || b.heuristic - a.heuristic
  || (a.t.deadline ?? '9999').localeCompare(b.t.deadline ?? '9999');
const SORTS: Record<SearchInput['sort'], (a: Row, b: Row) => number> = {
  relevance: byRelevance,
  value: (a, b) => (b.t.value_eur ?? -1) - (a.t.value_eur ?? -1) || byRelevance(a, b),
  deadline: (a, b) => (a.t.deadline ?? '9999').localeCompare(b.t.deadline ?? '9999') || byRelevance(a, b),
  newest: (a, b) => (b.t.published_at ?? '').localeCompare(a.t.published_at ?? '') || byRelevance(a, b),
};

function counts<K extends string>(rows: Row[], keysOf: (r: Row) => K[]): Map<K, number> {
  const m = new Map<K, number>();
  for (const r of rows) for (const k of keysOf(r)) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

type Cited = { matched_products: { sku: string; name: string }[]; matched_proposals: { ref: string; client: string; outcome: string; total_inr: number }[] };

/** Catalogue SKUs and past-proposal refs the assessment cites as [CODE], kept only when they really are this workspace's (the model may
 * not invent a match): products from the catalogue, proposals from the Company Brain's learned index with their real outcome. */
export async function citedProducts(env: Env, ws: string): Promise<(texts: string[]) => Cited> {
  const [rows, index] = await Promise.all([
    env.DB.prepare('SELECT sku, name FROM products WHERE workspace_id = ?').bind(ws).all<{ sku: string; name: string }>().then((r) => r.results),
    proposalIndex(env.DB, ws).catch(() => []),
  ]);
  const bySku = new Map(rows.map((p) => [p.sku.toUpperCase(), p]));
  const byRef = new Map(index.map((p) => [p.ref.toUpperCase(), p]));
  return (texts) => {
    const prods = new Map<string, { sku: string; name: string }>(), refs = new Map<string, Cited['matched_proposals'][number]>();
    for (const t of texts) for (const m of t.matchAll(/\[([^\]]{2,80})\]/g)) {
      for (const raw of m[1]!.split(/[,;]\s*/)) {
        const code = raw.trim().toUpperCase(), p = bySku.get(code), r = byRef.get(code);
        if (p) prods.set(p.sku, { sku: p.sku, name: p.name });
        if (r) refs.set(r.ref, { ref: r.ref, client: r.client, outcome: r.outcome, total_inr: r.total_inr });
      }
    }
    return { matched_products: [...prods.values()].slice(0, 6), matched_proposals: [...refs.values()].slice(0, 4) };
  };
}

/** Worldwide pool -> filters -> sort -> one page; only that page (<= 20) is AI-assessed, each notice cached. */
export async function searchOpportunities(env: Env, _workspace: string, state: OnboardingState, input: SearchInput, lang: string, waitUntil?: (p: Promise<unknown>) => void) {
  state = await withBrain(env, _workspace, state); // fit is scored against the catalogue and Company Brain
  const segment = state.company.supplier_segment;
  if (!segment) throw new HttpError(409, 'Choose your supplier segment before searching for opportunities.', 'company_incomplete', { missing: ['supplier_segment'] });
  const now = new Date();
  const domains = input.domains?.length ? input.domains : SEGMENT_DOMAINS[segment];
  const { pool, failed } = await loadPool(env, domains, now);
  const [hash, cap] = await Promise.all([profileHash(state), capabilityProfile(env, state)]);
  const scores = await readScores(env, lang, hash);
  const prio = priorities(state), terms = [...new Set([...fitTerms(state), ...profileTerms(cap)])], cpvs = cpvPrefixes(cap);
  const rows: Row[] = pool.map((t) => {
    const code = iso2(t.country), region = code ? regionOf(code) : null, words = haystack(t);
    const place = code && (code === prio.country || prio.countries.has(code)) ? 3 : region && prio.regions.has(region) ? 2 : 0;
    const head = wordSet(fold([t.title, ...t.lots.map((l) => l.title), cpvWords(t.cpv ?? [])].join(' '))), body = wordSet(words);
    const inHead = terms.filter((x) => has(head, x)).length, inBody = terms.filter((x) => !has(head, x) && has(body, x)).length;
    // Recall: the capability profile's CPV families and multilingual terms, then where the buyer is.
    // Capability first: a notice nothing in the profile recalls ranks below every recalled one, wherever it is; place breaks ties.
    // Recalled = in one of the profile's CPV classes, or two capability terms in the title/lots/CPV words (one generic word is not enough).
    const inCpv = cpvHit(cpvs, t.cpv ?? []), recalled = inCpv || inHead >= 2 || (inHead >= 1 && inBody >= 2);
    const recall = (inCpv ? 20 : 0) + Math.min(inHead * 4 + Math.min(inBody, 4), 28);
    return { t, key: viewKey(t), code, region, domains: noticeDomains(t), words, score: scores[viewKey(t)], heuristic: (recalled ? 100 : 0) + recall * 3 + place * 4 };
  });
  const q = fold(input.q ?? '').split(/\s+/).filter(Boolean);
  const currency = input.currency ?? 'EUR', horizon = input.deadline_within_days ? now.getTime() + input.deadline_within_days * 86_400_000 : null;
  const amount = (r: Row) => {
    const v = noticeValue(r.t as never);
    if (v?.currency === currency) return v.amount_minor / 100;
    return currency === 'EUR' && r.t.value_eur ? r.t.value_eur : null; // EUR also matches the sources' own EUR estimates
  };
  const base = (r: Row) => q.every((w) => r.words.includes(w))
    && (!horizon || (!!r.t.deadline && Date.parse(r.t.deadline) <= horizon))
    && (input.min_value === undefined || (amount(r) ?? -1) >= input.min_value)
    && (input.max_value === undefined || (amount(r) !== null && amount(r)! <= input.max_value));
  const inRegion = (r: Row) => !input.regions?.length || (!!r.region && input.regions.includes(r.region));
  const inCountry = (r: Row) => !input.countries?.length || input.countries.includes(r.code);
  const inDomain = (r: Row) => r.domains.some((d) => domains.includes(d));
  if (failed.length === NOTICE_SOURCES.length && !rows.some(inDomain)) {
    throw new HttpError(503, 'Public tender sources are not answering right now. Try again shortly.', 'sources_unavailable');
  }
  // Each facet counts with every filter except its own, so the UI can show what widening a filter would add.
  const pre = rows.filter(base);
  const facets = {
    regions: [...counts(pre.filter((r) => inCountry(r) && inDomain(r)), (r) => (r.region ? [r.region] : []))].sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: REGION_LABELS[id], count })),
    countries: [...counts(pre.filter((r) => inRegion(r) && inDomain(r)), (r) => (r.code ? [r.code] : []))].sort((a, b) => b[1] - a[1]).slice(0, 60)
      .map(([code, count]) => ({ code, name: countryName(code, lang), count })),
    domains: [...counts(pre.filter((r) => inRegion(r) && inCountry(r)), (r) => r.domains)].sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: DOMAIN_LABELS[id], count })),
  };
  const matched = pre.filter((r) => inRegion(r) && inCountry(r) && inDomain(r)).sort(SORTS[input.sort]);
  const wide = input.sort === 'relevance' && input.offset === 0;
  let page = matched.slice(input.offset, input.offset + (wide ? Math.max(input.limit, FIRST_PAGE_CANDIDATES) : input.limit));
  // Candidates without a cached rubric are read in full: the live notice text and the buyer's documents link.
  const enrich = async (t: Readable): Promise<Readable> => {
    const { detail } = await loadDetail(env, state, t.source as never, t.source_ref);
    const lots = detail.lots.map((l) => [l.title, l.description].filter(Boolean).join(': ')).join('\n');
    return { ...t, readText: [detail.description, lots, detail.award_criteria.length ? `Award criteria: ${detail.award_criteria.map((a) => [a.name ?? a.type, a.weight].filter(Boolean).join(' ')).join('; ')}` : '']
      .filter(Boolean).join('\n\n') || undefined, documentsUrl: detail.documents_url ?? null };
  };
  const { byKey, keys, ai } = await assessNotices(env, state, page.map((r) => r.t), lang, enrich);
  // Eager: the next candidates are assessed in the background so the list is ready on the next open.
  if (wide && waitUntil) {
    const onPage = new Set(page.map((r) => r.key));
    const next = matched.filter((r) => r.score === undefined && !onPage.has(r.key)).slice(0, 8).map((r) => r.t);
    if (next.length) waitUntil(assessNotices(env, state, next, lang, enrich).catch(() => undefined));
  }
  const assessed = new Map(page.map((r, i) => [r.key, byKey.get(keys[i]!) ?? null]));
  page.forEach((r) => { const a = assessed.get(r.key); if (a) r.score = a.score; });
  if (input.sort === 'relevance') page.sort(byRelevance); // fresh assessments reorder within the scored set only
  page = page.slice(0, input.limit);
  const cited = await citedProducts(env, _workspace);
  const notices = page.map((r) => {
    const n = toNotice(r.t, assessed.get(r.key) ?? null, lang, now, segment);
    const rb = n.fit.rubric;
    const fromRubric = rb && {
      matched_products: [...new Map(rb.requirements.flatMap((q) => q.products).map((x) => [x.sku, x])).values()].slice(0, 6),
      matched_proposals: rb.past.map(({ ref, client, outcome, total_inr }) => ({ ref, client, outcome, total_inr })),
    };
    return { ...n, region_label: n.region ? REGION_LABELS[n.region] : null, ...(fromRubric || cited([...n.fit.reasons, ...n.fit.strengths])) };
  });
  return {
    notices, total: matched.length, offset: input.offset, limit: input.limit, sort: input.sort, domains, facets, lang, ai,
    searched_at: now.toISOString(), sources_failed: failed, profile: profileSummary(cap),
  };
}
