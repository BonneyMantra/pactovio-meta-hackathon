// #/proposals/:id — the proposal as a print-ready A4 document (GET /api/proposals/:id), with the bid-desk rail.
import { api, h, icon, toast, errorBox, skeleton } from '../ui.js';
import { buildDocument, paginate } from '../doc/document.js';
import { rail, steps } from '../doc/rail.js';
import { inrShort } from '../doc/kit.js';
import { productIndex } from '../brain-api.js';

const SHEET_PX = 793.7;

export async function render(root, { id }, ctx) {
  ctx.setCrumbs(h('a', { href: '#/proposals' }, 'Proposals'), 'Loading…');
  root.classList.add('pd-page');
  root.replaceChildren(skeleton(6));
  let disposed = false, timer = null, ro = null;
  const [brain, products] = await Promise.all([api('/brain').catch(() => null), productIndex()]);

  async function load(first) {
    let data;
    try { data = await api(`/proposals/${encodeURIComponent(id)}`); } catch (e) { if (!disposed) root.replaceChildren(errorBox(e)); return; }
    if (disposed) return;
    const p = data.proposal ? { ...data.proposal, id: data.id, status: data.status, steps: data.steps ?? data.proposal.steps } : data;
    if (p.status && p.status !== 'ready' && !p.scope_of_supply) return progress(p, first);
    show(p, !first);
  }

  function progress(p, first) {
    ctx.setCrumbs(h('a', { href: '#/proposals' }, 'Proposals'), 'Writing…');
    if (p.status === 'failed') { root.replaceChildren(errorBox(new Error(p.error || 'This proposal run failed. Try the request again from the chat.'))); return; }
    root.replaceChildren(h('div.card.pd-running',
      h('span.access-step', 'PROPOSAL IN PROGRESS'), h('h2.h3', p.title || 'Writing your proposal'),
      h('p.small.ink2', 'Pactovio is reading the request, pricing it from your catalogue and writing it in your house style. This page opens the document as soon as it is ready.'),
      steps(p.steps)));
    timer = setTimeout(() => load(false), first ? 1200 : 2000);
  }

  function show(p, reveal) {
    const supplier = brain?.profile?.name || ctx.session?.workspace?.name || 'Supplier';
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
    root.replaceChildren(
      h('div.pd-top',
        h('div', h('div.xs.muted', [p.client?.name, p.ref, p.commercials?.total_inr ? inrShort(p.commercials.total_inr) : null].filter(Boolean).join(' · ')), h('h1', p.title)),
        h('div.pd-actions',
          h('button.btn.btn-secondary.btn-sm', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(location.href); toast('Link copied'); } catch { toast('Copy the address bar link to share'); } } }, icon('clip', 14), 'Copy link'),
          h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: print }, icon('download', 14), 'Download PDF'))),
      h('div.pd-wrap', stage, rail(p, brain)));
    if (reveal) doc.classList.add('pd-reveal');
    layout(root, stage, doc);
    ro = new ResizeObserver(() => fit(root, stage, doc));
    ro.observe(stage);
  }

  await load(true);
  return () => { disposed = true; clearTimeout(timer); ro?.disconnect(); };
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
