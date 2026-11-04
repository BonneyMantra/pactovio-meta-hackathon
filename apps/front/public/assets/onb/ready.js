// Onboarding step 4: "Your agent is ready" — a summary of what it learned, then into the chat.
import { h, icon } from '../ui.js';
import { completeCompany, friendlyError } from '../customer-api.js';
import { getBrain } from '../brain-api.js';
import { inrShort } from '../doc/kit.js';
import { countUp, frac } from '../brain/charts.js';

export async function readyStep(root, { onComplete, companyName }) {
  let disposed = false;
  root.replaceChildren(h('div.lr-wait', h('span.pd-spin'), 'Putting it together…'));
  const b = await getBrain().catch(() => null);
  if (disposed) return () => {};
  const s = b?.stats;
  const tiles = [
    ['Products', b?.catalogue_count, (v) => String(Math.round(v)), 'priced from HubSpot'],
    ['Proposals learned', b?.proposals_learned, (v) => String(Math.round(v)), 'from Google Drive'],
    ['Win rate', s?.win_rate != null ? frac(s.win_rate) * 100 : null, (v) => `${Math.round(v)}%`, s ? `${s.won} won · ${s.lost} lost` : 'on decided bids'],
    ['Median deal', s?.median_value_inr, inrShort, 'including GST'],
  ].filter(([, v]) => v != null);
  const nums = tiles.map(() => h('div.ob-tile-v.num', '—'));
  const phrase = b?.style?.phrases?.[0]?.text;
  const status = h('div.small.ink2', { role: 'status' });
  const go = h('button.btn.btn-primary.ob-go', { type: 'button', onclick: async () => {
    go.disabled = true; status.textContent = 'Opening your workspace…';
    try { await completeCompany(); history.replaceState(null, '', '/app#/agent'); await onComplete(); }
    catch (e) { if (!disposed) { status.textContent = friendlyError(e); go.disabled = false; } }
  } }, 'Talk to your agent', icon('arrow', 15));
  root.replaceChildren(h('div.ob-card.ob-ready',
    h('div.ob-ready-mark', icon('check', 26)),
    h('div.access-step', 'STEP 4 · READY'), h('h2.ob-h', 'Your agent is ready'),
    h('p.ink2', `It knows ${companyName || b?.profile?.name || 'your company'}: what you sell, what it costs, how you write and which bids you win. Send it an RFQ and it drafts the proposal.`),
    tiles.length ? h('div.ob-tiles', tiles.map(([k, , , sub], i) => h('div.ob-tile', { style: { animationDelay: `${i * 90}ms` } }, h('div.xs.muted', k), nums[i], h('div.xs.muted', sub)))) : null,
    phrase ? h('blockquote.ob-quote', `“${phrase}”`, h('span', 'A phrase it learned from your proposals')) : null,
    b?.style?.section_order?.length ? h('div.small.ink2', `Writes in your ${b.style.section_order.length}-section structure, from ${b.style.section_order[0]} to ${b.style.section_order[b.style.section_order.length - 1]}.`) : null,
    h('div.ob-actions', status, go)));
  tiles.forEach(([, v, f], i) => setTimeout(() => countUp(nums[i], Number(v), f), 200 + i * 90));
  go.focus();
  return () => { disposed = true; };
}
