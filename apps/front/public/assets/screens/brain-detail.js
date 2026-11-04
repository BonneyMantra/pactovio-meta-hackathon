// #/brain/learning — teach the agent from a Drive folder of past proposals, with the live learning view.
import { h } from '../ui.js';
import { learningView } from '../brain/learning.js';

export async function render(root, { id }, ctx) {
  ctx.setCrumbs(h('a', { href: '#/brain' }, 'Company Brain'), 'Learning');
  if (id !== 'learning') { location.hash = '#/brain'; return null; }
  root.classList.add('lr-route');
  const host = h('div');
  root.append(host);
  return learningView(host, { restart: true, returnTo: '/app#/brain/learning' });
}
