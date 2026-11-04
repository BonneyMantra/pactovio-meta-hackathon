// The agent's identity: one company-specific agent that knows the workspace. Used by the sidebar,
// the top bar and Home so every screen reads as "Rax Tech's agent", backed by GET /api/brain.
import { h, icon } from './ui.js';
import { getBrain } from './brain-api.js';

const arr = (v) => (Array.isArray(v) ? v : []);

/** Short company name: "Rax Tech International Pvt Ltd" -> "Rax Tech". */
export function shortName(name = '') {
  const clean = String(name).replace(/\s*\((sample company)\)\s*$/i, '').replace(/\b(private|pvt\.?|limited|ltd\.?|llp|inc\.?|international|corp(oration)?|co\.)\b/gi, '').replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').filter(Boolean);
  const out = words.slice(0, 2).join(' ') || String(name).trim() || 'Your company';
  return out === out.toUpperCase() && out.length > 3 ? out.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : out;
}
export const possessive = (n) => (/s$/i.test(n) ? `${n}’` : `${n}’s`);
export function initials(name = '') { return shortName(name).split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'P'; }

/** First name for the greeting: onboarding person.full_name, else a name-like email local part. */
export function firstName(ctx) {
  const full = ctx.setup?.person?.full_name?.trim();
  if (full) return full.split(/\s+/)[0];
  const local = String(ctx.session?.user?.email || '').split('@')[0].split(/[.+_-]/)[0];
  return /^[a-z]{2,12}$/i.test(local) ? local[0].toUpperCase() + local.slice(1).toLowerCase() : '';
}

/** Loads (and caches on ctx) the brain; never throws: identity is decoration around the real screens. */
export async function loadBrain(ctx, { fresh = false } = {}) {
  if (ctx.brain && !fresh) return ctx.brain;
  try { ctx.brain = await getBrain(); } catch { ctx.brain = ctx.brain || null; }
  return ctx.brain;
}

/** What the agent knows, in one line of facts. */
export function knowledge(brain) {
  const s = brain?.stats;
  return {
    learned: Number(brain?.proposals_learned) || 0,
    products: Number(brain?.catalogue_count) || 0,
    winRate: s?.win_rate == null ? null : Math.round((s.win_rate > 1 ? s.win_rate / 100 : s.win_rate) * 100),
    won: s?.won ?? 0, lost: s?.lost ?? 0, pending: s?.pending ?? 0,
    median: s?.median_value_inr ?? null,
    sectors: arr(s?.by_sector).map((x) => x.sector).filter(Boolean),
    style: brain?.style || null,
    learnedAt: brain?.learned_at || null,
  };
}

/** The avatar: company initials on the brand teal with a live dot. */
export function agentAvatar(name, size = 34) {
  return h('span.ag-av', { style: { '--s': `${size}px` }, 'aria-hidden': 'true' }, initials(name), h('i.ag-live'));
}

/** Sidebar card: who the agent works for and what it knows; links to the Company Brain. */
export function sideAgentCard(ctx, active) {
  const name = shortName(ctx.session?.workspace?.name);
  const k = knowledge(ctx.brain);
  const line = k.learned
    ? `${k.learned} proposals · ${k.products} products`
    : k.products ? `${k.products} products · no proposals yet` : 'Teach it your company';
  return h(`a.ag-side${active ? '.on' : ''}`, { href: '#/brain', title: 'Open the Company Brain' },
    agentAvatar(name, 30),
    h('span.ag-side-txt', h('b', `${possessive(name)} agent`), h('span', line)),
    icon('chev', 14));
}
