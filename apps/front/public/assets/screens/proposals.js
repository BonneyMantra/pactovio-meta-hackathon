// #/proposals — every proposal the agent has written, from chat or from the Gmail autopilot.
import { h, icon, fmt, chip, empty, errorBox, skeleton } from '../ui.js';
import { listProposals } from '../doc/api.js';
import { inrShort } from '../doc/kit.js';

const SOURCE = { chat: ['agent', 'Chat'], gmail: ['inbox', 'Gmail autopilot'], email: ['inbox', 'Email'], upload: ['file', 'Upload'] };

export async function render(root, _p, ctx) {
  ctx.setCrumbs('Proposals');
  const list = h('div.card', skeleton(5));
  root.append(h('div.page-head',
    h('div', h('h1.title', 'Proposals'), h('div.sub', 'Written from your catalogue, in your house style, with every claim linked to its source.')),
    h('a.btn.btn-primary', { href: '#/agent' }, icon('spark'), 'New from an RFQ')), list);
  try {
    const items = await listProposals();
    if (!items.length) { list.replaceChildren(empty('No proposals yet', 'Drop an RFQ into the chat, or connect Gmail and let the autopilot pick them up.', h('a.btn.btn-primary', { href: '#/agent' }, 'Open the chat'))); return; }
    list.replaceChildren(h('div.wk-scroll', h('table.table', h('thead', h('tr', h('th', 'Proposal'), h('th', 'Client'), h('th.r', 'Value'), h('th', 'From'), h('th', 'Status'), h('th', 'Created'))),
      h('tbody', items.map((p) => {
        const [ico, label] = SOURCE[p.source] || ['file', p.source || '—'];
        const go = () => { location.hash = `#/proposals/${encodeURIComponent(p.id)}`; };
        return h('tr.click', { onclick: go, tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') go(); } },
          h('td', h('div', { style: { fontWeight: 510 } }, p.title || 'Untitled proposal'), h('div.xs.muted.mono', p.ref || p.id)),
          h('td.small', p.client || p.client_name || '—'),
          h('td.r.num.small', p.total_inr ? inrShort(p.total_inr) : '—'),
          h('td.small.ink2', h('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, icon(ico, 14), label)),
          h('td', chip(p.status === 'ready' ? 'completed' : p.status, p.status === 'ready' ? 'Ready' : p.status === 'running' ? 'Writing…' : undefined)),
          h('td.small.muted', fmt.ago(p.created_at)));
      })))));
  } catch (e) { list.replaceChildren(errorBox(e)); }
}
