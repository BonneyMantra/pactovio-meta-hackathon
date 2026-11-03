/**
 * Lexical retrieval for the evidence library: idf-weighted cosine over term sets. Deterministic, no model call,
 * no stored vectors. Scores are in 0..1 so the status rules in matrix-rules.ts can threshold them.
 */
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'for', 'with', 'in', 'on', 'at', 'is', 'are', 'be', 'by', 'as', 'it', 'its', 'we', 'our', 'you', 'your', 'that', 'this', 'from', 'than', 'must', 'shall', 'will', 'should', 'any', 'all', 'such', 'has', 'have']);

/** Lowercase terms; a trailing plural "s" is dropped so "certificates" meets "certificate". Numbers and units stay as terms. */
export function terms(s: string): string[] {
  const raw = s.toLowerCase().match(/[a-z][a-z0-9-]*|\d+(?:[.,]\d+)?/g) ?? [];
  return raw.filter((t) => !STOP.has(t)).map((t) => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

export interface LexIndex { sets: Set<string>[]; idf: Map<string, number>; norms: number[] }

export function buildIndex(docs: string[]): LexIndex {
  const sets = docs.map((d) => new Set(terms(d)));
  const df = new Map<string, number>();
  for (const s of sets) for (const t of s) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log(1 + sets.length / n));
  const norms = sets.map((s) => { let w = 0; for (const t of s) w += idf.get(t)!; return w; });
  return { sets, idf, norms };
}

/** Score of one query against every document: shared idf mass over the geometric mean of both masses. */
export function scoreQuery(index: LexIndex, query: string): number[] {
  const q = new Set(terms(query));
  let qMass = 0;
  for (const t of q) qMass += index.idf.get(t) ?? Math.log(1 + index.sets.length);
  return index.sets.map((s, i) => {
    let shared = 0;
    for (const t of q) if (s.has(t)) shared += index.idf.get(t)!;
    const denom = Math.sqrt(qMass * index.norms[i]!);
    return denom ? shared / denom : 0;
  });
}
