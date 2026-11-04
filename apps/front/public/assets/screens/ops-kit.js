// Shared pieces for the ops screens (quotes, agent, connections, billing).
import { h, fmt } from '../ui.js';
import { brandTile } from '../brand-logos.js';

// Brand tiles live in ../brand-logos.js (real Simple Icons glyphs or official brand files).
export { BRAND } from '../brand-logos.js';
export function logoTile(provider, size = 36, name = '') { return brandTile(provider, size, name); }

/** Small stacked brand marks ("4 sources used"). */
export function sourceMarks(providers) {
  return h('span.src-marks', providers.map((p) => logoTile(p, 16)));
}

export function meter(label, used, cap, hint) {
  const pct = cap ? Math.min(100, Math.round((Number(used) / Number(cap)) * 100)) : 0;
  return h('div.meter',
    h('div.meter-top', h('span', label), h('span.num.muted', cap ? `${used ?? 0} / ${cap}` : String(used ?? '—'))),
    h('div.meter-bar', h('span', { style: { width: `${pct}%` } })),
    hint ? h('div.xs.muted', { style: { marginTop: '6px' } }, hint) : null);
}

export const opt = (v, fallback = '—') => (v == null || v === '' ? fallback : v);

export function money(minor, cur) { return minor == null ? '—' : fmt.money(minor, cur || 'USD'); }

/** Prompt-free confirm: a tiny inline popover row that resolves true/false. */
export function confirmRow(anchor, text, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    const row = h('div.action-req.fade-in', { style: { marginTop: '10px' } },
      h('div.label', text),
      h('button.btn.btn-secondary.btn-xs', { onclick: () => { row.remove(); resolve(false); } }, 'Cancel'),
      h('button.btn.btn-primary.btn-xs', { onclick: () => { row.remove(); resolve(true); } }, okLabel));
    anchor.after(row);
  });
}

export function sectionHead(title, right) {
  return h('div.section-title', h('h3', title), right || null);
}

export function backLink(href, label) {
  return h('a.back-link', { href }, '← ', label);
}
