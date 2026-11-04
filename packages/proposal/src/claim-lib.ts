import { claimCheckSync as engineCheck, claimTokens } from '@pactovio/engine';
import type { Evidence } from '@pactovio/contracts';

export { claimTokens };
export const splitSentencesOf = (text: string): string[] => text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);

/** Engine claim check over a synthetic evidence corpus ({id, title, text}). */
export function claimCheckSync(text: string, corpus: { id: string; title: string; text: string }[], allow: string[] = []) {
  const ev = corpus.map((c) => ({ id: c.id, workspace_id: '', kind: 'doc', title: c.title, issuer: null, scope: null, valid_to: null, r2_key: null, text: c.text })) as unknown as Evidence[];
  return engineCheck(text, ev, { allow });
}
