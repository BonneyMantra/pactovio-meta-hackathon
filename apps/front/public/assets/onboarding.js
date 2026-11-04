// First-run onboarding: 01 website → profile, 02 HubSpot catalogue, 03 Drive proposals → learning, 04 ready → chat.
// The step is derived from server state on every load, so provider sign-ins (OAuth) resume in the right place.
import { api, h, icon } from './ui.js';
import { getCompany } from './customer-api.js';
import { gateError } from './access.js';
import { companyReady } from './company-form.js';
import { connectionState, hubspotProducts, learnProgress } from './brain/learn-api.js';
import { websiteStep } from './onb/website.js';
import { catalogueStep } from './onb/catalogue.js';
import { readyStep } from './onb/ready.js';
import { learningView } from './brain/learning.js';

const STEPS = ['Company', 'Catalogue', 'Proposals', 'Ready'];
const SKIP = 'pv:onb-skip:';
const skipped = (ws, k) => { try { return sessionStorage.getItem(SKIP + ws + k) === '1'; } catch { return false; } };
const skip = (ws, k) => { try { sessionStorage.setItem(SKIP + ws + k, '1'); } catch { /* optional */ } };

export async function renderOnboarding(root, session, onComplete, onLogout) {
  let disposed = false, inner = null;
  const ws = session.workspace_id;
  // A provider that redirects back into this same document only changes the hash; re-derive the step.
  const onHash = () => { if (!disposed && /^#\/onboarding/.test(location.hash)) resolve(); };
  window.addEventListener('hashchange', onHash);
  const dispose = () => { disposed = true; inner?.(); window.removeEventListener('hashchange', onHash); };

  function layout(step, wide) {
    const body = h('div.ob-body');
    root.replaceChildren(
      h('header.access-header', h('a.brand', { href: '/' }, h('img', { src: '/assets/brand/lockup.svg', alt: 'Pactovio', width: 134, height: 32 })),
        h('div.ob-steps', STEPS.map((s, i) => h(`span${i === step ? '.on' : i < step ? '.done' : ''}`, h('b', i < step ? '✓' : String(i + 1).padStart(2, '0')), h('em', s)))),
        h('div.ob-who.small.ink2', h('span', session.user.email), h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: onLogout }, 'Sign out'))),
      h(`main.ob-main${wide ? '.wide' : ''}`, body));
    window.scrollTo(0, 0);
    return body;
  }

  async function resolve() {
    inner?.(); inner = null;
    const wait = layout(0);
    wait.append(h('div.lr-wait', h('span.pd-spin'), 'Loading your setup…'));
    try {
      const [c, conns, products, learn] = await Promise.all([getCompany(), connectionState(), hubspotProducts().catch(() => []), learnProgress().catch(() => null)]);
      if (disposed) return;
      const company = c.company || {};
      if (!companyReady(company)) return show(0, (b) => websiteStep(b, { company, workspace: ws, onNext: resolve }));
      if (!skipped(ws, 'crm') && (conns.hubspot !== 'connected' || !products.length)) {
        const next = () => { skip(ws, 'crm'); resolve(); };
        return show(1, (b) => catalogueStep(b, { connection: conns.hubspot, onNext: next, onSkip: next }), conns.hubspot === 'connected');
      }
      if (!skipped(ws, 'files') && learn?.status !== 'done') {
        return show(2, (b) => {
          const wrap = h('div'), foot = h('div.ob-actions.ob-skip', h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { skip(ws, 'files'); resolve(); } }, 'Skip for now'));
          b.append(wrap, learn?.status === 'running' ? null : foot);
          return learningView(wrap, { returnTo: '/app#/onboarding', onStart: () => foot.remove(), onDone: () => { foot.remove(); skip(ws, 'files'); resolve(); } });
        }, conns.googledrive === 'connected');
      }
      show(3, (b) => { let d = null; readyStep(b, { onComplete, companyName: company.name }).then((x) => { d = x; }); return () => d?.(); });
    } catch (e) { if (!disposed) gateError(root, e, resolve); }
  }

  function show(step, mount, wide) {
    const body = layout(step, wide);
    inner = mount(body) || null;
  }

  await resolve();
  return dispose;
}

// Public build fallback for #/setup. The private overlay replaces this module with the full onboarding v2 island.
export function renderSetup(root) {
  root.replaceChildren(h('section.card.workspace-start', h('span.access-step', 'COMPANY SETUP'), h('h2.h3', 'Finish your company profile'),
    h('p.small.ink2', 'Review the details Pactovio matches tenders and requests against.'),
    h('div.workspace-start-actions', h('a.btn.btn-primary', { href: '#/company' }, icon('settings'), 'Company settings'))));
  return () => root.replaceChildren();
}
