import { z } from 'zod';
import type { Env } from '@pactovio/contracts/env';
import { chatJSON } from '@pactovio/models';
import { aiPrecheck } from './ai-status';
import { profileHash, profileText, type Profile } from './opportunity-assess';

/**
 * Recall beyond literal words: Muse Spark reads the company profile, the real catalogue and the Company Brain once and derives a
 * capability profile (domains, product families, buyer sectors, regions, CPV codes) plus search terms in the languages public
 * notices are written in. Cached per profile hash for 7 days; the search uses it to pull candidates from the worldwide pool.
 */
export const CapabilityProfile = z.object({
  domains: z.array(z.string().trim().min(1).max(80)).max(8),
  product_families: z.array(z.string().trim().min(1).max(80)).max(10),
  buyer_sectors: z.array(z.string().trim().min(1).max(80)).max(8),
  regions_served: z.array(z.string().trim().min(1).max(80)).max(8),
  cpv_prefixes: z.array(z.string().regex(/^\d{3,8}$/)).max(24),
  terms: z.array(z.object({ lang: z.string().regex(/^[a-z]{2}$/), words: z.array(z.string().trim().min(3).max(40)).max(24) })).max(10),
});
export type CapabilityProfile = z.infer<typeof CapabilityProfile>;
const TTL = 7 * 86400;
const key = (hash: string) => `opp:cap:v1:${hash}`;

const SYSTEM = `You build a capability profile for one supplier so public tenders worldwide can be matched to it.
From the profile, catalogue and past proposals return:
domains: what the company delivers, as 3-8 short phrases; product_families: up to 10; buyer_sectors: the kinds of buyers it serves (banks, retail, government, transport ...);
regions_served: countries or regions where it has delivered or has offices;
cpv_prefixes: up to 24 EU CPV code prefixes (3 to 8 digits, no check digit) for the supplies, works and services it can bid on, most specific first;
terms: single words a tender notice for this company's work would contain, in English (en) and in French, German, Spanish, Italian, Polish, Portuguese, Dutch, Swedish and Romanian (codes fr de es it pl pt nl sv ro), up to 24 words each, lower case, singular, no brand names or SKUs.
Use only the evidence given. Return JSON {"domains","product_families","buyer_sectors","regions_served","cpv_prefixes","terms":[{"lang","words"}]}.`;

export async function capabilityProfile(env: Env, p: Profile): Promise<CapabilityProfile | null> {
  if (!p.brainText) return null; // derived from the catalogue and Company Brain; without them the confirmed profile terms are the recall
  const k = key(await profileHash(p));
  try {
    const hit = await env.CACHE.get(k);
    const ok = hit ? CapabilityProfile.safeParse(JSON.parse(hit)) : null;
    if (ok?.success) return ok.data;
  } catch { /* miss */ }
  if (await aiPrecheck(env)) return null;
  try {
    const { data } = await chatJSON(CapabilityProfile, {
      env: env as never, role: 'fast', purpose: 'tender capability profile', schemaName: 'capability_profile', maxTokens: 2600, temperature: 0, timeoutMs: 45000,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: profileText(p) }],
    });
    await env.CACHE.put(k, JSON.stringify(data), { expirationTtl: TTL }).catch(() => undefined);
    return data;
  } catch { return null; }
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Every multilingual term, folded like the notice text, for whole-word matching. */
export const profileTerms = (c: CapabilityProfile | null): string[] =>
  c ? [...new Set(c.terms.flatMap((t) => t.words).flatMap((w) => fold(w).split(/\s+/)).filter((w) => w.length >= 4))] : [];
/** CPV codes pad with zeros ("32000000" is the whole division); the meaningful prefix drops them, and anything broader than a
 * 4-digit class ("32", "302", "48") would recall half the pool, so it is not used for recall. */
export const cpvPrefixes = (c: CapabilityProfile | null): string[] =>
  c ? [...new Set(c.cpv_prefixes.map((p) => p.replace(/0+$/, '')).filter((p) => p.length >= 4))] : [];
/** True when any notice CPV code falls in one of the profile's CPV classes. */
export const cpvHit = (prefixes: string[], codes: string[]) => codes.some((code) => prefixes.some((p) => String(code).startsWith(p)));
/** Compact summary returned with the search so the UI can say how candidates were recalled. */
export const profileSummary = (c: CapabilityProfile | null) => c && {
  domains: c.domains, product_families: c.product_families, buyer_sectors: c.buyer_sectors, regions_served: c.regions_served,
  cpv_count: cpvPrefixes(c).length, terms_count: profileTerms(c).length, languages: c.terms.map((t) => t.lang),
};
