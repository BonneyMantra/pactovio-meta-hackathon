// Team: who works with the agent. Invite a colleague by email (sent from Pactovio's own sender, shown as a pending
// member until they sign in), and connect the inbox where requests arrive so the agent starts on them by itself.
import { api, h, icon, fmt, toast } from '../ui.js';
import { friendlyError, connectorDestination } from '../customer-api.js';
import { logoTile, confirmRow } from './ops-kit.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const person = (email = '') => {
  const local = String(email).split('@')[0].split('+')[0];
  const words = local.split(/[._-]+/).filter(Boolean);
  return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : email;
};
const initials = (email) => person(email).split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·';

export async function render(root, _p, ctx) {
  ctx.setCrumbs('Team');
  const company = ctx.session?.workspace?.name && ctx.session.workspace.name !== 'Your company' ? ctx.session.workspace.name : 'your company';
  const list = h('ul.tm-list', { 'aria-label': 'Team members' }, h('li.tm-row.tm-skel', h('span.skeleton')));
  const status = h('p.tm-status', { role: 'status' });
  const input = h('input.input.tm-input', { id: 'tm-email', type: 'email', name: 'email', autocomplete: 'off', inputmode: 'email', maxlength: 254, placeholder: 'colleague@company.com', 'aria-describedby': 'tm-status' });
  status.id = 'tm-status';
  const send = h('button.btn.btn-primary', { type: 'submit' }, 'Send invite', icon('arrow', 15));
  const form = h('form.tm-invite', { novalidate: true, onsubmit: (e) => { e.preventDefault(); invite(); } },
    h('label.tm-label', { for: 'tm-email' }, 'Invite by email'), h('div.tm-field', input, send), status);
  const inbox = h('section.card.tm-card.tm-inbox', h('div.skeleton', { style: { height: '120px' } }));
  root.append(
    h('div.page-head', h('div', h('h1.title', 'Team'), h('div.sub', `The people at ${company} who work with your agent.`))),
    h('div.tm-grid',
      h('section.card.tm-card', h('div.tm-head', h('h2', 'Members'), h('span.xs.muted.tm-count')), form, list),
      inbox));

  let busy = false, gone = false, fresh = '';
  const say = (text, tone = '') => { status.textContent = text; status.dataset.tone = tone; };

  async function draw() {
    let t;
    try { t = await api('/team'); } catch (e) { if (!gone) list.replaceChildren(h('li.tm-row', h('div.error-box', friendlyError(e)))); return; }
    if (gone) return;
    const members = t.members || [], invites = t.invites || [];
    root.querySelector('.tm-count').textContent = `${members.length} member${members.length === 1 ? '' : 's'}${invites.length ? ` · ${invites.length} invited` : ''}`;
    list.replaceChildren(...members.map(memberRow), ...invites.map(inviteRow));
  }

  function memberRow(m) {
    return h('li.tm-row', h('span.tm-av', initials(m.email)),
      h('div.tm-who', h('strong', person(m.email)), h('span.xs.muted', m.email)),
      h('span.tm-role', m.role === 'owner' ? 'Owner' : 'Member', m.you ? h('span.muted', ' · you') : null));
  }

  function inviteRow(inv) {
    const foot = h('div.tm-actions');
    const resend = h('button.btn.btn-ghost.btn-xs', { type: 'button', onclick: () => invite(inv.email, resend) }, 'Resend');
    const cancel = h('button.btn.btn-ghost.btn-xs', { type: 'button', onclick: async () => {
      if (!await confirmRow(row, `Cancel the invite to ${inv.email}? The link in their email stops working.`, 'Cancel invite')) return;
      cancel.disabled = true;
      try { await api(`/team/invites/${encodeURIComponent(inv.id)}`, { method: 'DELETE' }); say(`Invite to ${inv.email} cancelled.`); draw(); }
      catch (e) { toast(friendlyError(e)); cancel.disabled = false; }
    } }, 'Cancel');
    foot.append(resend, cancel);
    const sent = inv.sent_at || inv.invited_at;
    const row = h(`li.tm-row.tm-pending${inv.email === fresh ? '.tm-new' : ''}`, h('span.tm-av.tm-av-pending', initials(inv.email)),
      h('div.tm-who', h('strong', person(inv.email)), h('span.xs.muted', inv.email)),
      h('span.tm-sent', h('span.chip.warn', h('span.dot'), 'Invite sent'), h('span.xs.muted', sent ? fmt.ago(sent) : '')), foot);
    return row;
  }

  async function invite(again, btn) {
    if (busy) return;
    const email = (again || input.value).trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) { say('Enter a valid email address.', 'bad'); input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    busy = true; input.removeAttribute('aria-invalid');
    const b = btn || send; b.disabled = true;
    if (!btn) send.replaceChildren(h('span.pd-spin', { 'aria-hidden': 'true' }), 'Sending…');
    say('');
    try {
      await api('/team/invites', { method: 'POST', body: { email } });
      fresh = email; if (!again) input.value = '';
      say(`Invite sent to ${email}. They join when they sign in with that address.`, 'ok');
      await draw();
    } catch (e) {
      say(e.code === 'already_member' ? 'That person is already on your team.' : e.status === 429 ? 'An invite just went to that address. Try again in a minute.'
        : e.code === 'delivery_unavailable' ? 'We could not send the invite right now. Try again in a little while.' : friendlyError(e), 'bad');
    } finally {
      busy = false; b.disabled = false;
      if (!btn) send.replaceChildren('Send invite', icon('arrow', 15));
    }
  }

  async function drawInbox() {
    let gmail = null, auto = null;
    try {
      const [c, a] = await Promise.all([api('/connectors').catch(() => ({ items: [] })), api('/autopilot/status').catch(() => null)]);
      gmail = (c.items || []).find((x) => x.provider === 'gmail') || null; auto = a;
    } catch { /* drawn as not connected */ }
    if (gone) return;
    const on = gmail?.status === 'connected' || auto?.mailbox?.connected;
    const head = h('div.tm-ihead', logoTile('gmail', 40, 'Gmail'), h('div', h('h2', on ? 'Inbox connected' : 'Connect the team inbox'),
      h('div.xs.muted', on ? (gmail?.account_label || 'Gmail') + (gmail?.connected_at ? ` · since ${fmt.date(gmail.connected_at)}` : '') : 'Gmail')));
    const say2 = h('p.tm-status', { role: 'status' });
    if (!on) {
      const btn = h('button.btn.btn-primary', { type: 'button', onclick: async () => {
        btn.disabled = true; say2.textContent = 'Opening Google…';
        try {
          const r = await api('/connectors/gmail/connect', { method: 'POST', signal: AbortSignal.timeout(30000), body: { redirect_to: '/app#/team' } });
          location.assign(connectorDestination(r?.redirect_url));
        } catch (e) { say2.textContent = friendlyError(e); btn.disabled = false; }
      } }, 'Connect Gmail', icon('out', 15));
      inbox.replaceChildren(head, h('p.small.ink2', 'Connect the mailbox where requests arrive. Every new email is classified on Muse Spark: an RFQ starts a proposal by itself, marketing is ignored and never deleted.'),
        h('div.tm-iact', btn), say2);
      return;
    }
    const enabled = !!auto?.enabled;
    const sw = h('button', { type: 'button', class: enabled ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm', onclick: async () => {
      sw.disabled = true;
      try { await api('/autopilot', { method: 'PATCH', body: { enabled: !enabled } }); drawInbox(); }
      catch (e) { say2.textContent = friendlyError(e); sw.disabled = false; }
    } }, icon(enabled ? 'stop' : 'bolt', 14), enabled ? 'Pause autopilot' : 'Turn on autopilot');
    inbox.replaceChildren(head,
      h('div.tm-auto', h('span', { class: enabled ? 'chip ok' : 'chip' }, h('span.dot'), enabled ? 'Autopilot on' : 'Autopilot paused'),
        h('span.small.ink2', enabled ? 'Any RFQ that lands starts a proposal on its own.' : 'Turn it on and any RFQ that lands starts a proposal on its own.')),
      h('div.tm-iact', sw, h('a.btn.btn-ghost.btn-sm', { href: '#/inbox' }, 'Open inbox', icon('chev', 14))), say2);
  }

  draw(); drawInbox();
  return () => { gone = true; };
}
