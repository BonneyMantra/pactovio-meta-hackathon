// One frame from first visit to "agent ready": sign-in, code, every onboarding step. The left column asks; the right
// panel is the Aura loop while Pactovio waits for the person, and the agent's live work once it starts doing something.
// The frame persists across steps (and across sign-in → onboarding), so the panel never reloads or jumps.
import { h } from '../ui.js';

const MEDIA = '/assets/auth/aura-bcc8fe55.mp4';
const POSTER = '/assets/auth/aura-87874a73.jpg';
const desktop = matchMedia('(min-width: 1024px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

export function stage(root) {
  const live = root.__stage;
  if (live && root.contains(live.el)) return live;

  const ask = h('div.pv-ask');
  const id = h('div.pv-stage-id');
  const work = h('div.pv-work', { role: 'region', 'aria-label': 'What Pactovio is doing' });
  const aura = h('div.pv-aura', { 'aria-hidden': 'true' }, h('img', { src: POSTER, alt: '', width: 900, height: 1200, decoding: 'async' }));
  const art = h('aside.pv-art', aura, work);
  const el = h('div.pv-stage', { 'data-mode': 'auth', 'data-work': 'false' },
    h('header.pv-stage-top', h('a', { href: '/', 'aria-label': 'Pactovio home' }, h('img', { src: '/assets/brand/lockup.svg', width: 134, height: 32, alt: 'Pactovio' }))),
    h('main.pv-stage-center', ask),
    h('footer.pv-stage-foot', id, h('span.pv-legal', h('a', { href: '/privacy' }, 'Privacy'), h('span', { 'aria-hidden': 'true' }, '·'), h('a', { href: '/terms' }, 'Terms'))),
    art);
  root.replaceChildren(el);

  // Decorative loop: muted, inline, no controls. Paused when hidden, covered by work, on small screens or with reduced motion.
  let video = null, failed = false;
  function sync() {
    if (!el.isConnected) return teardown();
    const allowed = desktop.matches && !reduced.matches && !failed;
    if (allowed && !video) {
      video = h('video', { src: MEDIA, poster: POSTER, muted: true, loop: true, playsinline: true, preload: 'metadata', disablepictureinpicture: true, tabindex: '-1' });
      video.muted = true;
      video.addEventListener('error', () => { failed = true; video?.remove(); video = null; });
      video.addEventListener('loadeddata', sync);
      aura.append(video);
    }
    if (!video) return;
    if (!allowed) { video.remove(); video = null; return; }
    if (!document.hidden && el.dataset.work !== 'true') video.play().catch(() => { /* autoplay refused: the poster stays */ });
    else video.pause();
  }
  const teardown = () => { desktop.removeEventListener('change', sync); reduced.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync); };
  desktop.addEventListener('change', sync); reduced.addEventListener('change', sync); document.addEventListener('visibilitychange', sync);
  sync();

  let swap = 0;
  const api = {
    el,
    /** auth: half and half · onb: questions left, working area right · wide: a slim rail and a full working area. */
    mode(m) { if (el.dataset.mode !== m) el.dataset.mode = m; return api; },
    /** Replace the left column. The new content rises in; focus moves to its first heading unless the caller focuses something. */
    ask(...nodes) {
      const n = ++swap;
      const box = h('div.pv-ask-in', ...nodes);
      ask.replaceChildren(box);
      requestAnimationFrame(() => { if (n === swap) box.classList.add('in'); });
      return box;
    },
    /** Show the agent's work in the right panel, or null to return to the Aura. */
    work(node) {
      const on = !!node;
      el.dataset.work = String(on);
      if (on) { work.replaceChildren(node); work.scrollTop = 0; } else work.replaceChildren();
      sync();
      return api;
    },
    /** Whose workspace this is (company or person name, never the raw address), under the left column; null on sign-in. */
    who(name, onLogout) {
      id.replaceChildren(...(name ? [h('span', name), h('button.pv-link.pv-link-mute', { type: 'button', onclick: onLogout }, 'Sign out')] : []));
      return api;
    },
  };
  root.__stage = api;
  return api;
}

/** reena+film2@larinova.com → "Reena": a readable name from an address, for labels only. */
export function personName(email = '') {
  const words = String(email).split('@')[0].split('+')[0].split(/[._-]+/).filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'You';
}

/** The four onboarding steps as a compact progress row, shown at the top of the left column. */
export function stepNav(steps, current) {
  return h('ol.pv-steps', { 'aria-label': 'Setup progress' }, steps.map((s, i) => h('li', {
    'aria-current': i === current ? 'step' : null, 'data-done': i < current ? 'true' : null,
  }, h('span.pv-step-dot', i < current ? '✓' : String(i + 1)), h('span.pv-step-label', s), i < current ? h('span.sr-only', ' (done)') : null)));
}
