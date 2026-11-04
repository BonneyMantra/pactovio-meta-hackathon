// Speech hints for Muse Voice Transcribe: the proper nouns on an attached RFQ's first page (buyer, places, people, codes),
// so a name the speaker pronounces loosely ("Koorinji") is transcribed the way the document spells it ("Kurinji").
import { extractPdf } from '@pactovio/pack';

const MAX = 12;
// Capitalised words that are ordinary document vocabulary, not names worth biasing the recogniser towards.
const COMMON = new Set(`request proposal proposals tender quotation invitation bid bidder bidders rfp rfq rfi eoi document documents section annexure annex
reference ref date dated issue issued last submission pre meeting contact head department information technology procurement security
limited ltd private pvt company corporation the and for of to in on at by with from this that these those its their is are be must only any all
confidential notice page volume part schedule tuesday monday wednesday thursday friday saturday sunday january february march april may june july
august september october november december ist gmt utc road street floor house building no number sites site branches branch atm atms
integrated access control alarm intrusion surveillance system systems services service supply installation commissioning maintenance
mr mrs ms dr sir madam dear subject regards`.split(/\s+/));

const isCaps = (w: string) => w.length > 1 && w === w.toUpperCase();
const cap = (w: string) => w[0] + w.slice(1).toLowerCase();

/** Rank capitalised tokens by how often they appear, keep the first-seen order on ties; add the most frequent 2–3 word name. */
export function keywordsFromText(text: string): string[] {
  const tokens = text.match(/[A-Za-z][A-Za-z'-]*[A-Za-z]/g) ?? [];
  const seen = new Set(tokens);
  // A capitals heading word ("KURINJI") counts as the name it spells elsewhere ("Kurinji"); a lone code ("ITD") is dropped.
  const title = (w: string) => (isCaps(w) && seen.has(cap(w)) ? cap(w) : w);
  const count = new Map<string, { n: number; first: number }>();
  tokens.forEach((t, i) => {
    if (!/^[A-Z]/.test(t) || t.length < 3 || COMMON.has(t.toLowerCase())) return;
    const k = title(t), c = count.get(k);
    if (c) c.n++; else count.set(k, { n: 1, first: i });
  });
  const words = [...count.entries()].filter(([w, c]) => !isCaps(w) || c.n > 1)
    .sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first).map(([w]) => w);
  const phrases = new Map<string, number>();
  for (const m of text.matchAll(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,2})\b/g)) {
    const p = m[1]!.split(/\s+/).map((w) => (isCaps(w) ? cap(w) : w)).join(' ');
    if (p.split(' ').some((w) => !COMMON.has(w.toLowerCase()))) phrases.set(p, (phrases.get(p) ?? 0) + 1);
  }
  const top = [...phrases.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])[0]?.[0];
  // The phrase already carries its generic words ("Commercial", "Bank"); keep only its first, distinctive word on its own.
  const inTop = new Set(top ? top.split(' ').slice(1) : []);
  return [...new Set([...(top ? [top] : []), ...words.filter((w) => !inTop.has(w))])].slice(0, MAX);
}

/** First page of a PDF (or the head of a text file) → keywords. Never throws: no hints is a valid answer. */
export async function keywordsFromFile(name: string, bytes: Uint8Array): Promise<string[]> {
  try {
    if (/\.pdf$/i.test(name)) {
      const { pages } = await extractPdf(bytes);
      return keywordsFromText(pages.slice(0, 2).map((p) => p.text).join('\n'));
    }
    if (/\.(txt|eml|md)$/i.test(name)) return keywordsFromText(new TextDecoder().decode(bytes.subarray(0, 6000)));
  } catch { /* unreadable: no hints */ }
  return [];
}

/** ASR artefacts at its internal chunk joins: "RFP RFP", "RFPFP", "Hi.Hi.", "fromFP from", "document..". */
export function tidyTranscript(t: string): string {
  return t
    .replace(/\b([a-z]+)[A-Z]{2,}\s+\1\b/g, '$1')
    .replace(/\b([A-Z]*([A-Z]{2,}))\2\b/g, '$1')
    .replace(/\b(\w+(?:[\s,.]+\w+){0,2})([\s,.]+)\1\b/gi, '$1')
    .replace(/\.{2,}/g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
