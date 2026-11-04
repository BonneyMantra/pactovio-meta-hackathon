/**
 * What a company says about itself across its own past proposals: where it designs, builds and supports from,
 * who does the work. Repeated statements are the company's record; eligibility checks read them as facts.
 */
const ABOUT_SELF = /\b(our|we|rax)\b/i;
const TOPIC = /\b(facilit(y|ies)|office|offices|headquarter\w*|located|based in|service (centre|center|team|engineer\w*)|support (centre|center|team|desk)|field engineer\w*|engineers?|ex-works|in-house|remote(ly)?|on-site|onsite|warehouse|depot)\b/i;

const sentences = (t: unknown): string[] => (typeof t === 'string' ? t.split(/(?<=[.!?])\s+/) : []);

function texts(p: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (v: unknown) => { if (typeof v === 'string') out.push(...sentences(v)); else if (Array.isArray(v)) v.forEach(add); };
  add(p.executive_summary); add(p.solution_overview); add(p.assumptions); add(p.exclusions);
  const c = p.commercials as Record<string, unknown> | undefined; add(c?.note); add(c?.payment_terms);
  const w = p.warranty_amc as Record<string, unknown> | undefined; if (w) add(Object.values(w));
  return out;
}

/** Top self-statements by how many proposals repeat them (near-duplicates merged on a normalised key). */
export function selfStatements(learned: Record<string, unknown>[], max = 10): string[] {
  const seen = new Map<string, { text: string; n: number }>();
  for (const p of learned) {
    const keys = new Set<string>();
    for (const s of texts(p)) {
      const t = s.trim();
      if (t.length < 25 || t.length > 260 || !ABOUT_SELF.test(t) || !TOPIC.test(t)) continue;
      // Variants of one statement share the words around their topic ("in-house at our Chennai facility").
      const words = t.toLowerCase().replace(/[^a-z0-9 -]/g, ' ').split(/\s+/).filter(Boolean);
      const at = words.findIndex((w) => TOPIC.test(w));
      const k = words.slice(at, at + 5).join(' ');
      if (keys.has(k)) continue;
      keys.add(k);
      const e = seen.get(k);
      if (e) { e.n++; if (t.length < e.text.length) e.text = t; } else seen.set(k, { text: t, n: 1 });
    }
  }
  return [...seen.values()].sort((a, b) => b.n - a.n).slice(0, max).map((e) => `${e.text} (in ${e.n} past proposal${e.n > 1 ? 's' : ''})`);
}
