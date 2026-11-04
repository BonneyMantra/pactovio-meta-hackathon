// The agent learning from past proposals: folder pick → live reading animation driven by real ingest events
// (GET /api/brain/ingest) → style profile → ready. Used in onboarding and at #/brain/learning.
import { api, h, icon, errorBox } from '../ui.js';
import { friendlyError, connectorDestination } from '../customer-api.js';
import { driveFolders, startIngest, ingestState, getBrain } from '../brain-api.js';
import { readingCard, learnedRow, corpusGrid, livePanel } from './learn-parts.js';

/** opts: { onDone(brain), returnTo, restart } — returns a dispose function. */
export function learningView(root, opts = {}) {
  let disposed = false, poll = null, tick = null;
  const queue = [], seen = new Set();
  let lastSeq = 0;
  const dispose = () => { disposed = true; clearTimeout(poll); clearTimeout(tick); };

  async function start() {
    root.replaceChildren(h('div.lr-wait', h('span.pd-spin'), 'Checking what Pactovio has already learned…'));
    try {
      const s = await ingestState();
      if (disposed) return;
      if (s.status === 'running') return animate(s);
      if (s.status === 'done' && !opts.restart) return finished(await getBrain().catch(() => null));
      pick();
    } catch (e) { if (!disposed) root.replaceChildren(errorBox(e)); }
  }

  async function pick() {
    root.replaceChildren(h('div.lr-wait', h('span.pd-spin'), 'Opening your Google Drive…'));
    let folders;
    try { folders = await driveFolders(); } catch (e) { if (!disposed) return connectDrive(e); }
    if (disposed) return;
    let chosen = folders.find((f) => /proposal/i.test(f.name)) || folders[0];
    const go = h('button.btn.btn-primary', { type: 'button', disabled: !chosen, onclick: async () => {
      go.disabled = true; status.textContent = 'Starting…';
      try { await startIngest(chosen); if (!disposed) animate(await ingestState()); } catch (e) { status.textContent = friendlyError(e); go.disabled = false; }
    } }, 'Learn from this folder', icon('arrow', 15));
    const status = h('div.small.ink2', { role: 'status' });
    const list = h('div.lr-folders', { role: 'radiogroup', 'aria-label': 'Drive folders' }, folders.map((f) => h('button.lr-folder', { type: 'button', role: 'radio', 'aria-checked': String(f === chosen), onclick: (e) => {
      chosen = f; list.querySelectorAll('.lr-folder').forEach((b) => b.setAttribute('aria-checked', 'false')); e.currentTarget.setAttribute('aria-checked', 'true'); go.disabled = false;
    } }, h('span.lr-fico', icon('folder', 18)), h('span', h('strong.small', f.name), h('span.xs.muted', f.file_count != null ? `${f.file_count} files` : 'Folder')), icon('check', 16))));
    root.replaceChildren(h('div.lr-pick', h('div.access-step', 'GOOGLE DRIVE'), h('h2.h3', 'Which folder holds your past proposals?'),
      h('p.small.ink2', 'Pactovio reads every PDF in the folder: structure, prices, products, outcome and the way your team writes. Nothing is changed in Drive.'),
      folders.length ? list : h('p.small.ink2', 'No folders found in this Drive.'), h('div.lr-pick-foot', status, go)));
  }

  function connectDrive(err) {
    const status = h('div.small.ink2', { role: 'status' }, err?.status && err.status !== 404 ? friendlyError(err) : '');
    root.replaceChildren(h('div.lr-pick', h('div.access-step', 'GOOGLE DRIVE'), h('h2.h3', 'Connect Google Drive'),
      h('p.small.ink2', 'Your past proposals live in Drive. Connect it read-only and choose the folder.'), status,
      h('button.btn.btn-primary', { type: 'button', onclick: async (e) => {
        e.currentTarget.disabled = true; status.textContent = 'Opening Google…';
        try { const r = await api('/connectors/googledrive/connect', { method: 'POST', body: { redirect_to: opts.returnTo || '/app#/brain/learning' } }); location.assign(connectorDestination(r?.redirect_url)); }
        catch (x) { status.textContent = friendlyError(x); e.currentTarget.disabled = false; }
      } }, 'Connect Google Drive', icon('out', 15))));
  }

  function animate(first) {
    const total = first.total || 45;
    const read = readingCard(), grid = corpusGrid(total), live = livePanel();
    const learned = h('div.lr-list'), counter = h('span.num', '0'), bar = h('i');
    const title = h('h2', 'Reading your proposals');
    root.replaceChildren(h('div.lr',
      h('div.lr-top', h('div', h('div.access-step', first.folder?.name ? `GOOGLE DRIVE · ${first.folder.name.toUpperCase()}` : 'GOOGLE DRIVE'), title,
        h('p.small.ink2', 'Every document is read in full: what was offered, how it was priced, how it was written and whether it won.')),
        h('div.lr-count', counter, h('span.muted', ` / ${total}`), h('div.lr-bar', bar))),
      h('div.lr-body', h('div.lr-left', read.el, learned), h('div.lr-mid', h('div.lr-sub', 'Corpus'), grid.el, h('div.lr-key', h('span', h('i.won'), 'Won'), h('span', h('i.lost'), 'Lost'), h('span', h('i.pending'), 'Open'))), live.el)));
    let done = 0, startedIdx = 0, finishedState = false;
    const model = first.model || null;
    const step = () => {
      if (disposed) return;
      const ev = queue.shift();
      if (ev) {
        if (ev.type === 'file_started') { read.start(ev, ev.model || model); grid.reading(startedIdx++); }
        else if (ev.type === 'file_done' || ev.type === 'file_failed') {
          done += 1; counter.textContent = String(done); bar.style.width = `${(done / total) * 100}%`; grid.mark(ev);
          if (ev.type === 'file_done') { read.done(ev); live.update(ev); learned.prepend(learnedRow(ev)); while (learned.children.length > 6) learned.lastElementChild.remove(); }
        } else if (ev.type === 'style') showStyle();
      }
      if (!queue.length && finishedState) return complete();
      const held = ev?.type === 'file_done' ? (queue.length > 16 ? 180 : 720) : 0;
      tick = setTimeout(step, Math.max(held, queue.length > 12 ? 70 : queue.length > 4 ? 140 : 260));
    };
    async function showStyle() {
      title.textContent = 'Learning how you write';
      const b = await getBrain().catch(() => null);
      const order = b?.style?.section_order || [];
      if (order.length) live.style.replaceChildren(h('div.lr-sub', 'Your section order'), h('ol.lr-order', order.map((s, i) => h('li', { style: { animationDelay: `${i * 80}ms` } }, s))));
    }
    async function pull() {
      try {
        const s = await ingestState(lastSeq);
        for (const ev of s.events) { const k = ev.seq ?? `${ev.type}:${ev.file}`; if (!seen.has(k)) { seen.add(k); queue.push(ev); if (Number.isFinite(ev.seq)) lastSeq = Math.max(lastSeq, ev.seq); } }
        if (s.total && s.total !== total) grid.resize(s.total);
        if (s.status === 'done' || s.status === 'failed') { finishedState = true; if (s.status === 'failed') title.textContent = 'Learning stopped early'; return; }
      } catch { /* transient; keep polling */ }
      if (!disposed) poll = setTimeout(pull, 1000);
    }
    async function complete() {
      title.textContent = 'Company Brain ready';
      const b = await getBrain().catch(() => null);
      if (!disposed) setTimeout(() => finished(b), 900);
    }
    pull(); step();
  }

  function finished(brain) {
    if (disposed) return;
    if (opts.onDone) return opts.onDone(brain);
    location.hash = '#/brain';
  }

  start();
  return dispose;
}
