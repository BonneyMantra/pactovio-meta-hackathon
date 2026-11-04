// DOM pieces for the learning animation: reading card, learned list, corpus grid and live brain panel.
import { h, icon } from '../ui.js';
import { inrShort } from '../doc/kit.js';
import { SOLUTION, shareBar, countUp } from './charts.js';

const SOL = Object.fromEntries(SOLUTION.map(([k, l, c]) => [k, { l, c }]));

export function readingCard() {
  const name = h('div.lr-file'), facts = h('div.lr-facts'), state = h('div.lr-state', 'Waiting for the first document…');
  const el = h('div.lr-reading', h('div.lr-page', h('div.lr-lines', Array.from({ length: 9 }, (_, i) => h('i', { style: { width: `${[92, 80, 86, 64, 90, 72, 84, 58, 76][i]}%` } }))), h('div.lr-beam')),
    h('div.lr-meta', state, name, facts));
  return {
    el,
    start(ev, model) {
      el.classList.add('on'); el.classList.remove('done'); name.textContent = ev.file || ev.title || 'Proposal'; state.textContent = model ? `Reading with ${model}` : 'Reading';
      facts.replaceChildren(...['Client', 'Scope', 'Prices', 'Outcome', 'Voice'].map((x, i) => h('span.ghost', { style: { animationDelay: `${i * 90}ms` } }, x)));
    },
    done(ev) {
      el.classList.add('done'); state.textContent = 'Extracted';
      name.textContent = ev.title || ev.file;
      const f = (Array.isArray(ev.facts) && ev.facts.length ? ev.facts : [ev.client, SOL[ev.solution_type]?.l, ev.total_inr ? inrShort(ev.total_inr) : null, ev.outcome]).filter(Boolean).slice(0, 5);
      facts.replaceChildren(...f.map((x, i) => h('span', { style: { animationDelay: `${i * 70}ms` } }, String(x))));
    },
  };
}

export function learnedRow(ev) {
  const sol = SOL[ev.solution_type];
  return h('div.lr-row',
    h('span.lr-ref.mono', ev.ref || ''),
    h('div.lr-row-main', h('div.lr-row-t', ev.title || ev.file), h('div.lr-row-m', [ev.client, ev.sector].filter(Boolean).join(' · ')),
      h('div.lr-row-m', sol ? h('span.lr-sol', h('i', { style: { background: sol.c } }), sol.l) : null, ev.total_inr ? h('b.num', inrShort(ev.total_inr)) : null)),
    ev.outcome ? h(`span.lr-out.${ev.outcome}`, ev.outcome) : null);
}

export function corpusGrid(total) {
  const tiles = Array.from({ length: Math.max(1, total) }, () => h('i'));
  const el = h('div.lr-grid', tiles);
  let at = 0;
  return {
    el,
    resize(n) { while (tiles.length < n) { const t = h('i'); tiles.push(t); el.append(t); } },
    reading(i) { tiles.forEach((t) => t.classList.remove('cur')); tiles[i]?.classList.add('cur'); },
    mark(ev) { const t = tiles[at++]; if (t) { t.classList.remove('cur'); t.className = ev.type === 'file_failed' ? 'fail' : (ev.outcome || 'done'); t.title = [ev.ref, ev.client].filter(Boolean).join(' · '); } },
  };
}

/** Live statistics computed from the extracted documents as they arrive. */
export function livePanel() {
  const seen = [];
  const win = h('div.lr-big.num', '—'), val = h('div.lr-big.num', '₹0'), count = h('div.lr-big.num', '0');
  const mix = h('div'), sectors = h('div.lr-sectors'), style = h('div.lr-style');
  const el = h('div.lr-live',
    h('div.lr-live-head', icon('brain', 16), h('span', 'Company Brain'), h('span.lr-pulse')),
    h('div.lr-kpis', h('div', h('div.xs.muted', 'Proposals'), count), h('div', h('div.xs.muted', 'Win rate'), win), h('div', h('div.xs.muted', 'Value read'), val)),
    h('div.lr-sub', 'How work is sold'), mix,
    h('div.lr-sub', 'Sectors'), sectors, style);
  function update(ev) {
    seen.push(ev);
    const won = seen.filter((x) => x.outcome === 'won').length, lost = seen.filter((x) => x.outcome === 'lost').length;
    countUp(count, seen.length, (v) => String(Math.round(v)), 300);
    if (won + lost) countUp(win, (won / (won + lost)) * 100, (v) => `${Math.round(v)}%`, 300);
    countUp(val, seen.reduce((a, x) => a + (Number(x.total_inr) || 0), 0), inrShort, 300);
    mix.replaceChildren(shareBar(SOLUTION.map(([k, l, c]) => ({ label: l, color: c, value: seen.filter((x) => x.solution_type === k).length, short: '' })), { height: 10 }));
    const tally = new Map();
    seen.forEach((x) => x.sector && tally.set(x.sector, (tally.get(x.sector) || 0) + 1));
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5), max = top[0]?.[1] || 1;
    sectors.replaceChildren(...top.map(([s, n]) => h('div.lr-sec', h('span', s), h('i', h('b', { style: { width: `${(n / max) * 100}%` } })), h('span.num', String(n)))));
  }
  return { el, update, style };
}
