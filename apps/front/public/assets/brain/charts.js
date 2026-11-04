// Small chart kit for the Company Brain: stacked share bars, horizontal bars, column bands, tooltips.
// Palette validated (categorical, light): #006d96, #40a6c8, #e06a1b, #9b3c06 — always direct-labelled.
import { h } from '../ui.js';

export const SOLUTION = [
  ['own_products', 'Own products', '#006d96'],
  ['own_plus_external', 'Own + third-party', '#40a6c8'],
  ['own_plus_custom_engineering', 'Own + custom engineering', '#e06a1b'],
  ['fully_custom_engineered', 'Fully custom-engineered', '#9b3c06'],
];
export const VALUE = [
  ['rax_products', 'Own products', '#006d96'], ['external', 'Third-party', '#40a6c8'],
  ['custom_engineering', 'Custom engineering', '#e06a1b'], ['services', 'Services', '#9b3c06'],
];
export const frac = (v) => { const n = Number(v) || 0; return n > 1 ? n / 100 : n; };
export const pctTxt = (v) => `${Math.round(frac(v) * 100)}%`;

let tip;
function tooltip() {
  if (!tip) { tip = h('div.bc-tip', { role: 'tooltip' }); document.body.append(tip); }
  return tip;
}
/** Hover/focus tooltip on any mark; content is a list of [label, value] rows. */
export function hover(el, title, rows) {
  const show = (e) => {
    const t = tooltip();
    t.replaceChildren(h('div.bc-tip-t', title), ...rows.map(([k, v]) => h('div.bc-tip-r', h('span', k), h('b', v))));
    t.classList.add('on');
    const r = el.getBoundingClientRect(), x = e?.clientX ?? r.left + r.width / 2;
    t.style.left = `${Math.min(window.innerWidth - 230, Math.max(8, x - 100))}px`;
    t.style.top = `${r.top - 10}px`;
  };
  const hide = () => tip?.classList.remove('on');
  el.setAttribute('tabindex', '0');
  el.addEventListener('mousemove', show); el.addEventListener('focus', show);
  el.addEventListener('mouseleave', hide); el.addEventListener('blur', hide);
  return el;
}

/** One 100% bar split into segments [{ key, label, color, value, display }]. */
export function shareBar(segments, { label, height = 14 } = {}) {
  const total = segments.reduce((a, s) => a + (s.value || 0), 0) || 1;
  return h('div.bc-share',
    label ? h('div.bc-share-l', label) : null,
    h('div.bc-share-bar', { style: { height: `${height}px` } }, segments.filter((s) => s.value > 0).map((s) => hover(
      h('span', { style: { flexGrow: String(s.value), background: s.color } }, (s.value / total) >= 0.09 ? h('em', s.short ?? `${Math.round((s.value / total) * 100)}%`) : null),
      s.label, [['Share', `${Math.round((s.value / total) * 100)}%`], ...(s.display ? [['Value', s.display]] : [])]))));
}

export function legend(items) {
  return h('div.bc-legend', items.map(([, label, color, extra]) => h('span', h('i', { style: { background: color } }), label, extra ? h('b', extra) : null)));
}

/** Horizontal bars: rows [{ label, value, display, parts?: [{ value, color, label }] }]. */
export function hbars(rows, { max } = {}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value || 0));
  return h('div.bc-hbars', rows.map((r) => h('div.bc-hrow',
    h('div.bc-hl', r.label),
    hover(h('div.bc-htrack', h('div.bc-hfill', { style: { width: `${((r.value || 0) / top) * 100}%` } },
      (r.parts || [{ value: r.value, color: '#006d96' }]).filter((p) => p.value > 0).map((p) => h('span', { style: { flexGrow: String(p.value), background: p.color } })))),
    r.label, r.tip || [['Value', r.display ?? String(r.value)]]),
    h('div.bc-hv.num', r.display ?? String(r.value)))));
}

/** Column bars with optional inner "won" share: bands [{ label, count, won? }]. */
export function columns(bands) {
  const top = Math.max(1, ...bands.map((b) => b.count || 0));
  return h('div.bc-cols', bands.map((b) => h('div.bc-col',
    h('div.bc-cv.num', String(b.count ?? 0)),
    hover(h('div.bc-cbar', { style: { height: `${((b.count || 0) / top) * 100}%` } },
      b.won != null ? h('span', { style: { height: `${b.count ? (b.won / b.count) * 100 : 0}%` } }) : null),
    b.label, [['Proposals', String(b.count ?? 0)], ...(b.won != null ? [['Won', String(b.won)]] : [])]),
    h('div.bc-cl', b.label))));
}

/** Count-up for hero numbers; respects reduced motion. */
export function countUp(el, to, format = (v) => String(Math.round(v)), ms = 900) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !Number.isFinite(to)) { el.textContent = format(to); return; }
  const from = Number(el.dataset.v || 0), t0 = performance.now();
  el.dataset.v = String(to);
  const step = (t) => { const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3; el.textContent = format(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
