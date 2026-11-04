// Home: the company's agent first (what it knows, drop an RFQ), then what it is working on —
// proposals (GET /api/proposals), the Gmail autopilot (GET /api/autopilot/status), tenders and the inbox (GET /api/today).
import { api, h, icon, fmt, chip, empty, errorBox, skeleton } from '../ui.js';
import { listProposals } from '../brain-api.js';
import { inrShort } from '../doc/kit.js';
import { dash, doorChip, sourceMark, senderName, fitRing, sectionTitle } from './work-kit.js';
import { setupPanel } from './setup-results.js';
import { agentHero } from './today-agent.js';
import { loadBrain } from '../agent-id.js';

const STATUS = { queued: ['queued', 'Queued'], running: ['running', 'Writing…'], completed: ['completed', 'Ready'], ready: ['completed', 'Ready'], failed: ['failed', 'Failed'] };
const FROM = { gmail: 'from Gmail', email: 'from email', upload: 'from an upload', chat: 'from chat' };

function proposalRow(p) {
  const [tone, label] = STATUS[p.status] || [p.status, undefined];
  return h('a.hm-prop', { href: `#/proposals/${encodeURIComponent(p.id)}` },
    h('span.hm-prop-ico', icon('file', 16)),
    h('div.hm-grow',
      h('div.hm-t', p.title || p.client || 'New proposal'),
      h('div.xs.muted.wk-ellipsis', [p.client && p.title ? p.client : null, p.total_inr ? inrShort(p.total_inr) : null, FROM[p.source] || null, fmt.ago(p.created_at)].filter(Boolean).join(' · '))),
    chip(tone, label));
}

function proposalsCard(items) {
  const live = items.filter((p) => ['queued', 'running'].includes(p.status));
  return h('section.card.hm-card',
    h('div.hm-card-head', h('div', h('div.bs-k', 'Proposals'), h('div.hm-big', live.length ? `${live.length} being written` : items.length ? `${items.length} written` : 'None yet')), h('a.small.muted', { href: '#/proposals' }, 'All', icon('chev', 12))),
    items.length ? h('div.hm-list', items.slice(0, 4).map(proposalRow))
      : h('p.small.ink2.hm-pad', 'Drop an RFQ above, or let the Gmail autopilot start one when a request arrives.'));
}

function autopilotCard(a) {
  const on = a?.mailbox?.connected;
  const c = a?.counts || {};
  return h('section.card.hm-card',
    h('div.hm-card-head', h('div', h('div.bs-k', 'Gmail autopilot'), h('div.hm-big', !on ? 'Not connected' : a.enabled ? 'Watching your inbox' : 'Paused')),
      h('span', { class: `hm-pulse${on && a.enabled ? ' on' : ''}`, 'aria-hidden': 'true' })),
    on ? h('div.hm-nums',
      h('a', { href: '#/inbox' }, h('b.num', String(c.received ?? 0)), h('span', 'emails read')),
      h('a', { href: '#/inbox' }, h('b.num', String(c.proposals_started ?? 0)), h('span', 'RFQs → proposals')),
      h('a', { href: '#/inbox' }, h('b.num', String(c.ignored ?? 0)), h('span', 'ignored as noise')))
      : h('p.small.ink2.hm-pad', 'Connect Gmail and I’ll read new mail, skip the marketing, and start a proposal the moment an RFQ lands.'),
    h('div.hm-card-foot', on ? h('span.xs.muted', a.last_checked_at ? `Checked ${fmt.ago(a.last_checked_at)}` : 'Waiting for the first check') : null,
      h('a.btn.btn-secondary.btn-sm', { href: on ? '#/inbox' : '#/connections' }, on ? 'Open inbox' : 'Connect Gmail')));
}

function reachCard(t, prospects) {
  const c = t?.counts || {};
  return h('section.card.hm-card',
    h('div.hm-card-head', h('div', h('div.bs-k', 'New business'), h('div.hm-big', `${c.new_matches ?? 0} tender matches`)), h('a.small.muted', { href: '#/tenders' }, 'Tenders', icon('chev', 12))),
    h('div.hm-nums',
      h('a', { href: '#/tenders' }, h('b.num', String(c.new_matches ?? 0)), h('span', 'new tenders that fit')),
      h('a', { href: '#/prospects' }, h('b.num', prospects == null ? dash : String(prospects)), h('span', 'buyers with signals')),
      h('a', { href: '#/tenders' }, h('b.num', String((t?.closing_soon || []).length)), h('span', 'closing soon'))),
    h('div.hm-card-foot', h('span.xs.muted', 'Ranked against what you sell and win'), h('a.btn.btn-secondary.btn-sm', { href: '#/prospects' }, 'Find buyers')));
}

function matchRow({ tender, match }) {
  if (!tender) return null;
  return h('a.wk-match', { href: `#/tenders/${encodeURIComponent(tender.id)}` },
    fitRing(match?.fit_score),
    h('div.wk-match-main',
      h('div.wk-match-title', tender.title || 'Untitled tender'),
      h('div.xs.muted.wk-ellipsis', [tender.buyer || dash, tender.country, tender.value_eur ? fmt.moneyMajor(tender.value_eur, 'EUR') : null].filter(Boolean).join(' · ')),
      match?.fit_reason ? h('div.small.ink2.wk-clamp2', match.fit_reason) : null),
    h('div.wk-match-side', tender.deadline ? h('div.small.num', fmt.until(tender.deadline)) : h('div.small.muted', dash), chip(match?.status || 'new')));
}

function intakeRow(it) {
  return h('a.wk-intake', { href: `#/inbox/${encodeURIComponent(it.id)}` },
    sourceMark(it.source, 28),
    h('div.wk-intake-main',
      h('div.wk-intake-top', h('span.wk-sender', senderName(it.sender) || it.source), h('span.xs.muted', fmt.ago(it.received_at))),
      h('div.small.wk-ellipsis', it.title || '(no subject)'),
      it.classification?.reason ? h('div.xs.muted.wk-ellipsis', it.classification.reason) : null),
    doorChip(it));
}

function approvalRow(a) {
  return h('a.action-req.wk-appr', { href: `#/tenders/${encodeURIComponent(a.tender_id)}/answers` },
    h('span.label', icon('file'), h('span.wk-ellipsis', `Answer ${a.question_ref || ''} · ${a.tender_title || 'Tender'}`)),
    h('span.btn.btn-secondary.btn-xs', 'Review'));
}

export async function render(root, _params, ctx) {
  ctx.setCrumbs('Home');
  root.classList.add('hm-page');
  const panel = setupPanel(ctx);
  const setup = panel?.childElementCount ? panel : null;
  const hero = h('div', h('div.card.ag-hero-skel', skeleton(5)));
  const work = h('div.grid.hm-work', [0, 1, 2].map(() => h('div.card.hm-card', skeleton(3))));
  const lists = h('div');
  root.append(...[setup, hero, sectionTitle('Working for you'), work, lists].filter(Boolean));

  const [, t, props, auto, pros] = await Promise.all([
    loadBrain(ctx, { fresh: true }),
    api('/today').catch((e) => ({ error: e })),
    listProposals().catch(() => []),
    api('/autopilot/status').catch(() => null),
    api('/prospects').then((r) => (Array.isArray(r.items) ? r.items.length : null)).catch(() => null),
  ]);
  hero.replaceChildren(agentHero(ctx));
  work.replaceChildren(proposalsCard(props), autopilotCard(auto), reachCard(t.error ? null : t, pros));
  if (t.error) { lists.replaceChildren(errorBox(t.error)); return; }

  const matches = (t.top_matches || []).filter((m) => m && m.tender);
  const intakes = t.intakes || [];
  const approvals = t.approvals || [];
  lists.replaceChildren(h('div.wk-two',
    h('div',
      sectionTitle('Best tender matches', h('a.small.muted', { href: '#/tenders' }, 'All tenders')),
      h('div.card.wk-list', matches.length ? matches.slice(0, 5).map(matchRow) : empty('No matches yet', 'The nightly scan reads new public tenders worldwide and scores each one against what you sell and win.'))),
    h('div',
      approvals.length ? [sectionTitle('Needs your approval', h('span.chip.warn', String(approvals.length))), h('div.wk-appr-list', approvals.slice(0, 4).map(approvalRow))] : null,
      sectionTitle('Latest in the inbox', h('a.small.muted', { href: '#/inbox' }, 'Open inbox')),
      h('div.card.wk-list', intakes.length ? intakes.slice(0, 5).map(intakeRow) : empty('Inbox is quiet', 'Requests from your mailbox and uploads land here, sorted into RFQs and noise.')))));
}
