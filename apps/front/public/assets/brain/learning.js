// The agent learning from past proposals: Drive connect → folder pick → live reading animation driven by the real
// learning events (GET /api/brain/progress) → deal outcomes from HubSpot → style profile → ready.
// Used in onboarding and at #/brain/learning.
import { h, icon, errorBox } from '../ui.js';
import { friendlyError, connectorDestination } from '../customer-api.js';
import { getBrain } from '../brain-api.js';
import { driveFolders, startLearn, learnProgress, connectProvider, LEARN_MODEL } from './learn-api.js';
import { readingCard, learnedRow, corpusGrid, livePanel } from './learn-parts.js';

const day = (iso) => { try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };

/** opts: { onDone(brain), onStart(), returnTo, restart } — returns a dispose function. */
export function learningView(root, opts = {}) {
  let disposed = false, poll = null, tick = null;
  const dispose = () => { disposed = true; clearTimeout(poll); clearTimeout(tick); };

  async function start() {
    root.replaceChildren(h('div.lr-wait', h('span.pd-spin'), 'Checking what Pactovio has already learned…'));
    try {
      const s = await learnProgress();
      if (disposed) return;
      if (s.status === 'running') return animate(s);
      if (s.status === 'done' && !opts.restart) return finished(await getBrain().catch(() => null));
      pick(s.status === 'failed' ? s.error : null);
    } catch (e) { if (!disposed) root.replaceChildren(errorBox(e)); }
  }

  async function pick(lastError) {
    root.replaceChildren(h('div.lr-wait', h('span.pd-spin'), 'Opening your Google Drive…'));
    let folders;
    try { folders = await driveFolders(); } catch (e) { if (!disposed) return connectDrive(e); }
    if (disposed) return;
    folders.sort((a, b) => Number(/proposal/i.test(b.name)) - Number(/proposal/i.test(a.name)) || String(b.modified || '').localeCompare(String(a.modified || '')));
    let chosen = folders.find((f) => /proposal/i.test(f.name)) || folders[0];
    const status = h('div.small.ink2', { role: 'status' }, lastError ? 'The last attempt stopped early. Choose the folder to try again.' : '');
    const go = h('button.btn.btn-primary', { type: 'button', disabled: !chosen, onclick: async () => {
      go.disabled = true; status.textContent = 'Starting…';
      try { await startLearn(chosen); if (!disposed) animate(await learnProgress()); }
      catch (e) { status.textContent = e.code === 'already_running' ? 'Already learning — picking up the live progress…' : friendlyError(e); if (e.code === 'already_running') animate(await learnProgress()); else go.disabled = false; }
    } }, 'Learn from this folder', icon('arrow', 15));
    const list = h('div.lr-folders', { role: 'radiogroup', 'aria-label': 'Drive folders' }, folders.slice(0, 12).map((f) => h('button.lr-folder', { type: 'button', role: 'radio', 'aria-checked': String(f === chosen), onclick: (e) => {
      chosen = f; list.querySelectorAll('.lr-folder').forEach((b) => b.setAttribute('aria-checked', 'false')); e.currentTarget.setAttribute('aria-checked', 'true'); go.disabled = false;
    } }, h('span.lr-fico', icon('folder', 18)), h('span', h('strong.small', f.name), h('span.xs.muted', f.modified ? `Updated ${day(f.modified)}` : 'Folder')), icon('check', 16))));
    root.replaceChildren(h('div.lr-pick', h('div.access-step', 'STEP 3 · GOOGLE DRIVE'), h('h2.h3', 'Which folder holds your past proposals?'),
      h('p.small.ink2', `${LEARN_MODEL} reads every PDF in the folder: structure, prices, products, outcome and the way your team writes. Nothing is changed in Drive.`),
      folders.length ? list : h('p.small.ink2', 'No folders found in this Drive.'), h('div.lr-pick-foot', status, go)));
    go.focus();
  }

  function connectDrive(err) {
    const quiet = !err || err.code === 'not_connected' || err.status === 404 || err.status === 409;
    const status = h('div.small.ink2', { role: 'status' }, quiet ? '' : friendlyError(err));
    const btn = h('button.btn.btn-primary', { type: 'button', onclick: async () => {
      btn.disabled = true; status.textContent = 'Opening Google…';
      try { location.assign(connectorDestination(await connectProvider('googledrive', opts.returnTo || '/app#/brain/learning'))); }
      catch (x) { status.textContent = friendlyError(x); btn.disabled = false; }
    } }, 'Connect Google Drive', icon('out', 15));
    root.replaceChildren(h('div.lr-pick', h('div.access-step', 'STEP 3 · GOOGLE DRIVE'), h('h2.h3', 'Teach it from your past proposals'),
      h('p.small.ink2', 'Your past proposals live in Google Drive. Connect it, choose the folder, and the agent reads every one: what you offered, how you priced it, how you write and which bids you won.'),
      h('div.ob-connect', h('span.lr-fico', icon('folder', 20)), h('div', h('strong', 'Google Drive'), h('div.small.ink2', 'Reads the PDFs in the folder you choose')), btn), status));
    btn.focus();
  }

  function animate(first) {
    opts.onStart?.(first);
    let total = first.total || 0;
    const queue = [], seen = new Set(), inflight = new Set();
    let lastSeq = 0, finishedState = null;
    const read = readingCard(), grid = corpusGrid(Math.max(total, 1)), live = livePanel();
    const learned = h('div.lr-list'), counter = h('span.num', '0'), of = h('span.muted', total ? ` / ${total}` : ''), bar = h('i');
    const title = h('h2', total ? 'Reading your proposals' : 'Opening the folder');
    const phase = h('div.lr-phase', { role: 'status', 'aria-live': 'polite' }, h('span.pd-spin'), h('span', `Listing the PDFs in ${first.folder?.name || 'the folder'}`));
    root.replaceChildren(h('div.lr',
      h('div.lr-top', h('div', h('div.access-step', first.folder?.name ? `GOOGLE DRIVE · ${first.folder.name.toUpperCase()}` : 'GOOGLE DRIVE'), title,
        h('p.small.ink2', 'Every document is read in full: what was offered, how it was priced, how it was written and whether it won.')),
        h('div.lr-count', counter, of, h('div.lr-bar', bar))),
      phase,
      h('div.lr-body', h('div.lr-left', read.el, learned), h('div.lr-mid', h('div.lr-sub', 'Proposals'), grid.el, h('div.lr-key', h('span', h('i.won'), 'Won'), h('span', h('i.lost'), 'Lost'), h('span', h('i.pending'), 'Open'))), live.el)));
    let done = 0;
    const setPhase = (text, busy = true) => phase.replaceChildren(busy ? h('span.pd-spin') : h('span.lr-phase-ok', icon('check', 13)), h('span', text));
    const readingLabel = () => (inflight.size > 1 ? `${LEARN_MODEL} · ${inflight.size} documents at once` : LEARN_MODEL);
    const step = () => {
      if (disposed) return;
      const ev = queue.shift();
      if (ev) handle(ev);
      if (!queue.length && finishedState) return complete(finishedState);
      const held = ev?.type === 'file_done' ? (queue.length > 16 ? 160 : 620) : 0;
      tick = setTimeout(step, Math.max(held, queue.length > 12 ? 60 : queue.length > 4 ? 130 : 240));
    };
    function handle(ev) {
      if (ev.type === 'started') {
        total = ev.total || total; of.textContent = ` / ${total}`; grid.resize(total); title.textContent = 'Reading your proposals';
        setPhase(`Found ${total} proposal PDFs · reading them with ${LEARN_MODEL}`);
      } else if (ev.type === 'file_started') {
        inflight.add(ev.index); read.start(ev, readingLabel()); grid.reading(ev.index - 1);
      } else if (ev.type === 'file_done' || ev.type === 'file_failed') {
        inflight.delete(ev.index);
        done += 1; counter.textContent = String(done); bar.style.width = `${total ? (done / total) * 100 : 0}%`; grid.mark(ev);
        if (ev.type === 'file_done') { read.done(ev); live.update(ev); learned.prepend(learnedRow(ev)); while (learned.children.length > 6) learned.lastElementChild.remove(); }
      } else if (ev.type === 'outcomes') {
        title.textContent = 'Checking which bids you won'; setPhase(ev.message || 'Reading deal outcomes from HubSpot', !/^Matched/.test(ev.message || ''));
      } else if (ev.type === 'deriving') {
        title.textContent = 'Learning how you write'; setPhase(`${LEARN_MODEL} is distilling your structure, voice and commercial terms`);
      }
    }
    async function pull() {
      try {
        const s = await learnProgress(lastSeq);
        for (const ev of s.events) { if (!seen.has(ev.seq)) { seen.add(ev.seq); queue.push(ev); lastSeq = Math.max(lastSeq, ev.seq || 0); } }
        if (s.total && s.total !== total) { total = s.total; of.textContent = ` / ${total}`; grid.resize(total); }
        if (s.status === 'done' || s.status === 'failed') { finishedState = s; return; }
      } catch { /* transient; keep polling */ }
      if (!disposed) poll = setTimeout(pull, 1200);
    }
    async function complete(s) {
      if (s.status === 'failed') {
        title.textContent = 'Learning stopped early'; setPhase(s.error || 'Some documents could not be read.', false);
        phase.append(h('button.btn.btn-secondary.btn-sm', { type: 'button', onclick: () => pick(s.error) }, 'Try again'));
        return;
      }
      const b = await getBrain().catch(() => null);
      if (disposed) return;
      title.textContent = 'Company Brain ready';
      setPhase(`Learned from ${b?.proposals_learned ?? done} proposals · ${b?.style?.voice_rules?.length ?? 0} writing rules, each grounded in your documents`, false);
      live.final(b);
      tick = setTimeout(() => finished(b), 5200); // long enough to read what it learned
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
