import type { ModelEnv } from '@pactovio/contracts/env';
import { chatJSON, type StepLogger } from '@pactovio/models';
import type { Extraction, Proposal } from './schema';
import { median, mode } from './stats';
import { StyleDraft, type StyleProfile } from './types';

type Learned = { proposal: Proposal; section_order: string[]; voice_notes: string[] };

/** Numbers and fixed terms are computed in code from the extracted data. */
export function styleFacts(ps: Proposal[]): Pick<StyleProfile, 'payment_terms' | 'warranty' | 'amc_pct' | 'validity_days' | 'discount_pattern'> {
  const w = mode(ps.map((p) => `${p.warranty_amc.warranty_months_from_commissioning}|${p.warranty_amc.warranty_months_from_dispatch}`)).split('|');
  const d = ps.map((p) => p.commercials.discount_pct), withDiscount = d.filter((x) => x > 0);
  const maxD = d.length ? Math.max(...d) : 0;
  return {
    payment_terms: mode(ps.map((p) => p.commercials.payment_terms)),
    warranty: ps.length ? `${w[0]} months from commissioning or ${w[1]} months from dispatch, whichever is earlier` : '',
    amc_pct: median(ps.map((p) => p.warranty_amc.amc_pct_of_hardware)),
    validity_days: median(ps.map((p) => p.validity_days)),
    discount_pattern: ps.length
      ? `${withDiscount.length} of ${ps.length} proposals carry a discount; typical ${withDiscount.length ? Math.round(median(withDiscount.map((x) => x * 10))) / 10 : 0}%, never above ${maxD}%`
      : '',
  };
}

const digest = (l: Learned) => ({
  ref: l.proposal.ref, sections: l.section_order, voice: l.voice_notes,
  opening: l.proposal.executive_summary.slice(0, 360), payment: l.proposal.commercials.payment_terms, warranty: l.proposal.warranty_amc.text.slice(0, 200),
});

/** Keep only rules/phrases whose citations name >= 2 distinct, real learned refs. */
export function groundDraft<T extends { refs: string[] }>(items: T[], known: Set<string>): T[] {
  return items.map((i) => ({ ...i, refs: [...new Set(i.refs.filter((r) => known.has(r)))] })).filter((i) => i.refs.length >= 2);
}

export async function deriveStyle(env: ModelEnv, learned: Learned[], onStep?: StepLogger, fetchImpl?: typeof fetch): Promise<StyleProfile> {
  const known = new Set(learned.map((l) => l.proposal.ref));
  const { data } = await chatJSON(StyleDraft, {
    env, purpose: 'brain: derive style profile', role: 'reason', model: 'meta:muse-spark-1.3@medium', maxTokens: 6000, timeoutMs: 180_000, schemaName: 'style_profile', onStep, fetch: fetchImpl,
    messages: [
      { role: 'system', content: 'You study how a company writes its commercial proposals. Output: the usual section order (most common order of top-level sections); voice_rules (id like V1, a concrete, checkable writing rule); phrases (recurring wording worth reusing verbatim). Every rule and phrase must be seen in at least two documents and cite those documents by their exact ref in `refs`. Do not invent refs. Do not state numbers such as prices or percentages.' },
      { role: 'user', content: JSON.stringify(learned.slice(0, 60).map(digest)) },
    ],
  });
  const voice_rules = groundDraft(data.voice_rules, known), phrases = groundDraft(data.phrases, known);
  if (voice_rules.length < 3 || phrases.length < 3) throw new Error('Style profile was not grounded in at least two proposals per rule');
  return { section_order: data.section_order, voice_rules, phrases, ...styleFacts(learned.map((l) => l.proposal)) };
}

export type { Extraction };
