// In-app 404: an unknown route or record says so plainly instead of silently showing Home.
import { h, icon } from '../ui.js';
import { agentAvatar } from '../agent-id.js';

export function render(root, _params, ctx) {
  ctx.setCrumbs('Not found');
  const path = location.hash.split('?')[0] || '#/';
  root.append(h('section.card.nf',
    agentAvatar(ctx.session?.workspace?.name, 44),
    h('div.access-step', '404 · NOT FOUND'),
    h('h1.title', 'I couldn’t find that page'),
    h('p.ink2', 'The link may be mistyped, or the record was removed. Nothing in your workspace changed.'),
    h('code.nf-path', path),
    h('div.nf-actions',
      h('a.btn.btn-primary', { href: '#/today' }, icon('home', 15), 'Go home'),
      h('a.btn.btn-secondary', { href: '#/proposals' }, icon('file', 15), 'Proposals'),
      h('a.btn.btn-ghost', { href: '#/agent' }, icon('agent', 15), 'Ask your agent'))));
}
