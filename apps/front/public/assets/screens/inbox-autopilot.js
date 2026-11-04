// Gmail autopilot panel at the top of the Inbox (GET /api/autopilot): what arrived while you were away,
// what was ignored, and which RFQs already have a proposal written.
import { h, icon, fmt } from '../ui.js';
import { autopilot } from '../brain-api.js';
import { inrShort } from '../doc/kit.js';
import { modelChip } from '../doc/rail.js';
import { senderName } from './work-kit.js';
import { logoTile } from './ops-kit.js';

const CLASS = { rfq: ['RFQ / RFP', 'accent'], marketing: ['Marketing', ''], other: ['Other', 'info'] };

function item(it) {
  const [label, tone] = CLASS[it.class] || [it.class, ''];
  const right = it.status === 'proposal_ready' && it.proposal_id
    ? h('a.btn.btn-primary.btn-sm', { href: `#/proposals/${encodeURIComponent(it.proposal_id)}` }, 'Open proposal', icon('arrow', 14))
    : it.status === 'running' ? h('span.ap-run', h('span.pd-spin'), 'Writing proposal', modelChip(it.model))
      : it.status === 'ignored' ? h('span.xs.muted', 'Ignored') : h('span.xs.muted', 'Left for you');
  return h(`div.ap-item.${it.status}`,
    h('div.ap-main',
      h('div.ap-top', h('span.ap-from', senderName(it.from)), h(`span.chip${tone ? '.' + tone : ''}`, h('span.dot'), label),
        it.confidence != null ? h('span.xs.muted.num', `${Math.round(it.confidence * 100)}%`) : null, h('span.xs.muted.num.ap-time', fmt.ago(it.received_at))),
      h('div.ap-subj', it.subject || '(no subject)'),
      it.attachments?.length ? h('div.ap-att', it.attachments.map((a) => h('span', icon('clip', 12), a))) : null),
    h('div.ap-side', it.status === 'proposal_ready' && it.value_inr ? h('div.ap-val.num', inrShort(it.value_inr)) : null, right));
}

export function autopilotPanel() {
  const el = h('section.ap', h('div.skeleton', { style: { height: '120px', borderRadius: '14px' } }));
  let timer = null, open = false;
  async function load() {
    let r;
    try { r = await autopilot(); } catch { el.remove(); return; }
    if (!r?.enabled && !(r?.items || []).length) { el.remove(); return; }
    const items = r.items || [], s = r.summary || {};
    const ready = items.filter((i) => i.status === 'proposal_ready'), running = items.filter((i) => i.status === 'running');
    const ignored = items.filter((i) => i.status === 'ignored'), left = items.filter((i) => !['proposal_ready', 'running', 'ignored'].includes(i.status));
    const ign = h('div.ap-list.ap-ign', { hidden: !open }, ignored.map(item));
    const toggle = h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { open = !open; ign.hidden = !open; toggle.lastChild.textContent = open ? 'Hide' : `Show ${ignored.length} ignored`; } }, icon('down', 14), h('span', open ? 'Hide' : `Show ${ignored.length} ignored`));
    const stat = (n, label, cls) => h(`div.ap-stat${cls ? '.' + cls : ''}`, h('b.num', String(n ?? 0)), h('span', label));
    el.replaceChildren(
      h('div.ap-head',
        h('div.ap-title', logoTile('gmail', 34), h('div', h('div.ap-k', 'AUTOPILOT · GMAIL'), h('h2', ready.length ? `${ready.length} proposal${ready.length === 1 ? '' : 's'} ready while you were away` : 'Watching your inbox'),
          h('div.small.ink2', `${r.mailbox || 'Connected mailbox'}${r.since ? ` · since ${fmt.dateTime(r.since)}` : ''}`))),
        h('div.ap-stats', stat(s.received ?? items.length, 'emails'), stat(s.rfq ?? items.filter((i) => i.class === 'rfq').length, 'RFQs', 'acc'),
          stat(s.proposals_ready ?? ready.length, 'proposals', 'ok'), stat(s.ignored ?? ignored.length, 'ignored'))),
      ready.length || running.length ? h('div.ap-list', [...ready, ...running].map(item)) : null,
      left.length ? h('div.ap-list', left.map(item)) : null,
      ignored.length ? h('div.ap-foot', toggle) : null, ign);
    if (running.length) timer = setTimeout(load, 4000);
  }
  load();
  el.dispose = () => clearTimeout(timer);
  return el;
}
