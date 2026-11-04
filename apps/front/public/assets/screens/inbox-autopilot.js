// Gmail autopilot panel at the top of the Inbox (GET /api/autopilot/status + /api/autopilot/inbox): what arrived,
// what was ignored and why, and which RFQs already have a proposal written by the bid engine.
import { api, h, icon, fmt, toast } from '../ui.js';
import { inrShort } from '../doc/kit.js';
import { modelChip } from '../doc/rail.js';
import { senderName } from './work-kit.js';
import { logoTile } from './ops-kit.js';

const KIND = {
  rfq: ['RFQ', 'accent'], rfp: ['RFP', 'accent'], design_request: ['Design request', 'accent'],
  tender_notice: ['Tender notice', 'info'], marketing: ['Marketing', ''], other: ['Other', ''],
};
const MODEL = { 'muse-wonder': 'Muse Wonder', 'muse-spark': 'Muse Spark' };
const modelName = (m) => (!m || m === 'code' || m === 'none' ? null : MODEL[m] || (/wonder/i.test(m) ? 'Muse Wonder' : /spark/i.test(m) ? 'Muse Spark' : null));

/** One state per row: ready | running | failed | ignored | left. */
function stateOf(it) {
  if (it.action === 'ignored') return 'ignored';
  if (it.action !== 'proposal') return 'left';
  const s = it.proposal?.status;
  return s === 'ready' ? 'proposal_ready' : s === 'queued' || s === 'running' ? 'running' : s === 'failed' ? 'failed' : 'left';
}

function item(it) {
  const st = stateOf(it), p = it.proposal || {};
  const [label, tone] = KIND[it.kind] || [it.kind || 'Email', ''];
  const right = st === 'proposal_ready' && p.proposal_id
    ? h('a.btn.btn-primary.btn-sm', { href: `#/proposals/${encodeURIComponent(p.proposal_id)}` }, 'Open proposal', icon('arrow', 14))
    : st === 'running' ? h('a.ap-run', { href: p.proposal_id ? `#/proposals/${encodeURIComponent(p.proposal_id)}` : '#/inbox' }, h('span.pd-spin'), 'Writing proposal', modelChip(modelName(p.model)))
      : st === 'failed' ? h('span.xs', { style: { color: 'var(--bad)' } }, 'Proposal run failed')
        : st === 'ignored' ? h('span.xs.muted', 'Ignored') : h('a.xs', { href: `#/inbox/${encodeURIComponent(it.intake_id)}` }, it.action === 'autopilot_off' ? 'Autopilot was off' : 'Left for you');
  return h(`div.ap-item.${st}`,
    h('div.ap-main',
      h('div.ap-top', h('span.ap-from', senderName(it.sender) || 'Unknown sender'), h(`span.chip${tone ? '.' + tone : ''}`, h('span.dot'), label),
        it.confidence != null ? h('span.xs.muted.num', `${Math.round(it.confidence * 100)}%`) : null, h('span.xs.muted.num.ap-time', fmt.ago(it.received_at))),
      h('div.ap-subj', it.title || '(no subject)'),
      st === 'ignored' || st === 'left' ? h('div.xs.muted', { style: { whiteSpace: 'normal' } }, it.reason) : null,
      it.attachments?.length ? h('div.ap-att', it.attachments.map((a) => h('span', icon('clip', 12), a))) : null),
    h('div.ap-side', st === 'proposal_ready' && p.total_inr ? h('div.ap-val.num', inrShort(p.total_inr)) : null, right));
}

async function connectGmail(btn) {
  btn.disabled = true;
  try {
    const r = await api('/connectors/gmail/connect', { method: 'POST', body: { redirect_to: '/app#/inbox' } });
    if (typeof r?.redirect_url !== 'string' || !(/^https:\/\//i.test(r.redirect_url) || /^\/app(?:#|$)/.test(r.redirect_url))) throw new Error('Gmail connection is unavailable right now.');
    location.assign(r.redirect_url);
  } catch (e) { toast(e.message || 'Gmail connection is unavailable right now.'); btn.disabled = false; }
}

export function autopilotPanel() {
  const el = h('section.ap', h('div.skeleton', { style: { height: '120px', borderRadius: '14px' } }));
  let timer = null, open = false, gone = false;
  async function load() {
    clearTimeout(timer);
    let s, items;
    try { [s, items] = await Promise.all([api('/autopilot/status'), api('/autopilot/inbox').then((r) => r.items || [])]); } catch { if (!s) el.remove(); return; }
    if (gone) return;
    const c = s.counts || {}, mb = s.mailbox || {};
    const ready = items.filter((i) => stateOf(i) === 'proposal_ready'), running = items.filter((i) => stateOf(i) === 'running');
    const ignored = items.filter((i) => stateOf(i) === 'ignored'), left = items.filter((i) => ['left', 'failed'].includes(stateOf(i)));
    const ign = h('div.ap-list.ap-ign', { hidden: !open }, ignored.map(item));
    const toggle = h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { open = !open; ign.hidden = !open; toggle.lastChild.textContent = open ? 'Hide ignored' : `Show ${ignored.length} ignored`; } }, icon('down', 14), h('span', open ? 'Hide ignored' : `Show ${ignored.length} ignored`));
    const stat = (n, label, cls) => h(`div.ap-stat${cls ? '.' + cls : ''}`, h('b.num', String(n ?? 0)), h('span', label));
    const sw = h('button', { type: 'button', class: s.enabled ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-primary', 'aria-pressed': String(!!s.enabled),
      onclick: async () => { sw.disabled = true; try { await api('/autopilot', { method: 'PATCH', body: { enabled: !s.enabled } }); toast(s.enabled ? 'Autopilot paused' : 'Autopilot on: new RFQs become proposals'); load(); } catch (e) { toast(e.message); sw.disabled = false; } } },
      icon(s.enabled ? 'stop' : 'bolt', 14), s.enabled ? 'Pause autopilot' : 'Turn on autopilot');
    const action = !mb.connected ? h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: (e) => connectGmail(e.currentTarget) }, icon('plug', 14), 'Connect Gmail') : sw;
    const title = !mb.connected ? 'Connect Gmail and RFQs answer themselves'
      : ready.length ? `${ready.length} proposal${ready.length === 1 ? '' : 's'} ready while you were away`
        : running.length ? `Writing ${running.length === 1 ? 'a proposal' : `${running.length} proposals`} from your inbox` : s.enabled ? 'Watching your inbox' : 'Autopilot is paused';
    const sub = !mb.connected ? 'Every new email is classified on Muse Spark. RFQs and RFPs start a proposal run; marketing is ignored, never deleted.'
      : `Gmail connected${mb.connected_at ? ` ${fmt.ago(mb.connected_at)}` : ''}${s.last_checked_at ? ` · checked ${fmt.ago(s.last_checked_at)}` : ''} · RFQs above ${Math.round((s.threshold ?? 0.7) * 100)}% confidence start a proposal`;
    el.replaceChildren(
      h('div.ap-head',
        h('div.ap-title', logoTile('gmail', 34), h('div', h('div.ap-k', `AUTOPILOT · GMAIL${mb.connected ? (s.enabled ? ' · ON' : ' · PAUSED') : ''}`), h('h2', title), h('div.small.ink2', sub))),
        mb.connected && (c.received || items.length)
          ? h('div.ap-stats', stat(c.received ?? items.length, 'emails'), stat(c.proposals_started, 'RFQs', 'acc'), stat(c.proposals_ready, 'proposals', 'ok'), stat(c.ignored, 'ignored'))
          : null),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, action),
      ready.length || running.length ? h('div.ap-list', [...running, ...ready].map(item)) : null,
      left.length ? h('div.ap-list', left.map(item)) : null,
      ignored.length ? h('div.ap-foot', toggle) : null, ign);
    timer = setTimeout(load, running.length ? 5000 : s.enabled ? 20000 : 60000);
  }
  load();
  el.dispose = () => { gone = true; clearTimeout(timer); };
  return el;
}
