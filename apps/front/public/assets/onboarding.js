// First-run onboarding: 01 website → profile, 02 HubSpot catalogue, 03 Drive proposals → learning, 04 ready → chat.
// Runs in the sign-in frame (assets/onb/stage.js): questions on the left, the agent's live work in the right panel.
// The step is derived from server state on every load, so provider sign-ins (OAuth) resume in the right place.
import { h, icon } from './ui.js';
import { getCompany } from './customer-api.js';
import { gateError } from './access.js';
import { companyReady } from './company-form.js';
import { connectionState, hubspotProducts, learnProgress } from './brain/learn-api.js';
import { stage, stepNav } from './onb/stage.js';
import { websiteStep } from './onb/website.js';
import { catalogueStep } from './onb/catalogue.js';
import { readyStep } from './onb/ready.js';
import { learningView } from './brain/learning.js';

const STEPS = ['Company', 'Catalogue', 'Proposals', 'Ready'];
const listed = (xs) => Array.isArray(xs) && xs.some((x) => String(x || '').trim());
// Same mandatory profile values the API checks before setup can complete (apps/api/src/lib/company-required.ts).
const profileReady = (p = {}) => String(p.description || '').trim().length >= 20 && listed(p.offerings) && listed(p.markets) && listed(p.customers);
const SKIP = 'pv:onb-skip:';
const skipped = (ws, k) => { try { return sessionStorage.getItem(SKIP + ws + k) === '1'; } catch { return false; } };
const skip = (ws, k) => { try { sessionStorage.setItem(SKIP + ws + k, '1'); } catch { /* optional */ } };

export async function renderOnboarding(root, session, onComplete, onLogout) {
  let disposed = false, inner = null;
  const ws = session.workspace_id;
  const s = stage(root).mode('onb').who(session.user.email, onLogout);
  // A provider that redirects back into this same document only changes the hash; re-derive the step.
  const onHash = () => { if (!disposed && /^#\/onboarding/.test(location.hash)) resolve(); };
  window.addEventListener('hashchange', onHash);
  const dispose = () => { disposed = true; inner?.(); inner = null; window.removeEventListener('hashchange', onHash); };

  async function resolve() {
    inner?.(); inner = null;
    s.ask(h('div.pv-form.pv-notice-wrap', h('div.access-card', h('p', { role: 'status' }, 'Loading your setup…'))));
    try {
      const [c, conns, products, learn] = await Promise.all([getCompany(), connectionState(), hubspotProducts().catch(() => []), learnProgress().catch(() => null)]);
      if (disposed) return;
      const company = c.company || {};
      const incomplete = Array.isArray(c.required_missing) ? c.required_missing.length > 0 : !profileReady(c.profile || {});
      if (!companyReady(company) || incomplete) return show(0, (nav) => websiteStep(s, { nav, company, workspace: ws, onNext: resolve }));
      if (!skipped(ws, 'crm') && (conns.hubspot !== 'connected' || !products.length)) {
        const next = () => { skip(ws, 'crm'); resolve(); };
        return show(1, (nav) => catalogueStep(s, { nav, connection: conns.hubspot, onNext: next, onSkip: next }));
      }
      if (!skipped(ws, 'files') && learn?.status !== 'done') return show(2, (nav) => proposals(nav));
      show(3, (nav) => { let d = null; readyStep(s, { nav, onComplete, companyName: company.name }).then((x) => { d = x; }); return () => d?.(); });
    } catch (e) { if (!disposed) gateError(root, e, resolve); }
  }

  // Step 3: connect Drive and pick the folder on the left; once reading starts the working area widens to the full
  // learning view, and the left column becomes a slim rail that says what is happening and how long it takes.
  function proposals(nav) {
    const view = h('div.pv-learn');
    const skipRow = h('div.pv-after.pv-skip', h('button.pv-btn.pv-btn-text', { type: 'button', onclick: () => { skip(ws, 'files'); resolve(); } }, 'Skip for now'));
    s.ask(nav, view, skipRow);
    return learningView(view, {
      returnTo: '/app#/onboarding',
      onStart: (run) => {
        skipRow.remove();
        const folder = run?.folder?.name;
        s.mode('wide').ask(stepNav(STEPS, 2), h('div.pv-heading', h('h1', { tabindex: '-1' }, 'Learning from your proposals'),
          h('p.pv-lede', `Muse Spark is reading every proposal${folder ? ` in ${folder}` : ''}: structure, prices, products and voice. Each one is then matched to its HubSpot deal to learn which bids you won.`)),
        h('p.pv-rail-note', icon('clock', 14), 'A full folder takes a few minutes. You can keep this page open.'));
        s.work(view);
      },
      onDone: () => { skip(ws, 'files'); resolve(); },
    });
  }

  function show(step, mount) {
    s.mode('onb').work(null);
    inner = mount(stepNav(STEPS, step)) || null;
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
