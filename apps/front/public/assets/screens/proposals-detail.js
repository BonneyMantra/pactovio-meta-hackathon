// #/proposals/:id — the proposal as a print-ready A4 document (GET /api/proposals/:id), with the bid-desk rail.
import { api, h, icon, toast, errorBox, skeleton } from '../ui.js';
import { buildDocument, paginate } from '../doc/document.js';
import { rail } from '../doc/rail.js';
import { liveSteps } from '../doc/steps.js';
import { eligibilityFlags, flagsSig } from '../doc/flags.js';
import { reviewControls } from '../doc/review.js';
import { inrShort } from '../doc/kit.js';
import { productIndex } from '../brain-api.js';
import { getProposal, STAGES } from '../doc/api.js';

const SHEET_PX = 793.7;

export async function render(root, { id }, ctx) {
  ctx.setCrumbs(h('a', { href: '#/proposals' }, 'Proposals'), 'Loading…');
  root.classList.add('pd-page');
  root.replaceChildren(skeleton(6));
  let disposed = false, timer = null, ro = null, live = null, feed = null;
  const [brain, products] = await Promise.all([api('/brain').catch(() => null), productIndex()]);

  async function load(first) {
    let data;
    try { data = await getProposal(id); } catch (e) { if (!disposed) root.replaceChildren(errorBox(e)); return; }
    if (disposed) return;
    const p = data;
    if (p.status !== 'ready' || !p.scope_of_supply) return progress(p, first);
    show(p, !first);
  }

  // Built once, then patched each poll: finished steps tick in place and the clock keeps running between polls.
  function progress(p, first) {
    ctx.setCrumbs(h('a', { href: '#/proposals' }, 'Proposals'), 'Writing…');
    if (p.status === 'failed') { stopLive(); root.replaceChildren(errorBox(new Error(p.error || 'This proposal run failed. Try the request again from the chat.'))); return; }
    if (!live) {
      const list = liveSteps(), bar = h('i'), count = h('span'), clock = h('span.num'), title = h('h2.h3'), flags = h('div');
      const t0 = Date.parse(p.created_at) || Date.now();
      const tickClock = () => { const s = Math.max(0, Math.floor((Date.now() - t0) / 1000)); clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
      live = { list, bar, count, title, flags, fsig: '', clock: setInterval(tickClock, 1000) };
      tickClock();
      root.replaceChildren(h('div.card.pd-running',
        h('span.access-step', 'PROPOSAL IN PROGRESS'), title,
        h('p.small.ink2', 'Pactovio is reading the request, pricing it from your catalogue and writing it in your house style. This page opens the document as soon as it is ready.'),
        h('div.pd-run-meta.xs.muted', count, clock), h('div.pd-run-bar', bar), list.el, flags));
    }
    live.title.textContent = p.title || 'Writing your proposal';
    const elig = p.partial?.eligibility;
    if (elig && flagsSig(elig) !== live.fsig) { live.fsig = flagsSig(elig); live.flags.replaceChildren(eligibilityFlags(elig) || ''); }
    const done = live.list.update(p.steps);
    live.count.textContent = `${done} of ${STAGES.length} steps done`;
    live.bar.style.width = `${Math.max(4, (done / STAGES.length) * 100)}%`;
    openFeed();
    clearTimeout(timer);
    timer = setTimeout(() => load(false), first ? 1200 : feed ? 6000 : 2000);
  }
  function stopLive() { if (live) clearInterval(live.clock); live = null; closeFeed(); }

  // Server-sent step events (GET /api/proposals/:id/events) refresh the page the moment a step finishes; the timer above stays
  // as a slow safety poll. Any stream error, timeout or a browser without EventSource falls back to the 2 s poll.
  function openFeed() {
    if (feed !== null || disposed || typeof EventSource !== 'function') return;
    try { feed = new EventSource(`/api/proposals/${encodeURIComponent(id)}/events`); } catch { feed = false; return; }
    const soon = () => { if (disposed) return; clearTimeout(timer); timer = setTimeout(() => load(false), 150); };
    const stop = () => { closeFeed(); feed = false; soon(); };
    feed.addEventListener('step', soon);
    feed.addEventListener('status', soon);
    for (const ev of ['done', 'timeout', 'fault', 'error']) feed.addEventListener(ev, stop);
  }
  function closeFeed() { if (feed) feed.close(); }

  function show(p, reveal) {
    stopLive();
    const supplier = brain?.profile?.legal_name || brain?.profile?.name || ctx.session?.workspace?.name || 'Supplier';
    ctx.setCrumbs(h('a', { href: '#/proposals' }, 'Proposals'), p.ref || p.title || 'Proposal');
    const doc = buildDocument({
      p, id, supplier, products,
      nameOf: (sku) => products.get(sku)?.name || null,
      thumb: (sku) => products.get(sku)?.thumb || null,
      order: p.section_order || brain?.style?.section_order,
    });
    const stage = h('div.pd-stage', doc);
    const print = () => {
      const was = document.title;
      document.title = [p.ref?.replace(/\//g, '-'), p.client?.name].filter(Boolean).join(' ') || 'Proposal';
      window.print();
      setTimeout(() => { document.title = was; }, 500);
    };
    const heading = h('h1', p.title);
    const review = reviewControls({ p, id, doc, relayout: () => layout(root, stage, doc), onTitle: (t) => { heading.textContent = t; } });
    root.replaceChildren(
      h('div.pd-top',
        h('div', h('div.xs.muted', [p.client?.name, p.ref, p.commercials?.total_inr ? inrShort(p.commercials.total_inr) : null].filter(Boolean).join(' · ')), heading),
        h('div.pd-actions', review.el,
          h('button.btn.btn-secondary.btn-sm', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(location.href); toast('Link copied'); } catch { toast('Copy the address bar link to share'); } } }, icon('clip', 14), 'Copy link'),
          h('button.btn.btn-secondary.btn-sm', { type: 'button', onclick: print }, icon('download', 14), 'Download PDF'))),
      h('div.pd-wrap', stage, rail(p, brain)));
    if (reveal) doc.classList.add('pd-reveal');
    layout(root, stage, doc);
    ro = new ResizeObserver(() => fit(root, stage, doc));
    ro.observe(stage);
  }

  await load(true);
  return () => { disposed = true; clearTimeout(timer); stopLive(); ro?.disconnect(); };
}

async function layout(root, stage, doc) {
  root.classList.remove('pd-fluid');
  doc.style.zoom = '';
  const imgs = [...doc.querySelectorAll('.pd-visual img, .pd-plan img')];
  await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => null))), new Promise((r) => setTimeout(r, 4000))]);
  try { await document.fonts?.ready; } catch { /* fonts are optional */ }
  paginate(doc);
  fit(root, stage, doc);
}

function fit(root, stage, doc) {
  const w = stage.clientWidth - 32, scale = Math.min(1, w / SHEET_PX);
  const fluid = scale < 0.6;
  root.classList.toggle('pd-fluid', fluid);
  doc.style.zoom = fluid ? '' : String(scale);
}
