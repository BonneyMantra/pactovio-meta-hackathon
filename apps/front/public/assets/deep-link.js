// Deep links survive sign-in and onboarding: the app route asked for before the session existed is
// kept for this tab only (sessionStorage, a hash path only, never form values) and restored on entry.
const KEY = 'pv:deep-link';
const SKIP = /^#\/?(today|onboarding|setup|setup-connections)?(\?.*)?$/;
const APP_ROUTE = /^#\/[a-z][a-z-]{1,30}(\/[\w.~%-]{1,120}){0,3}$/;

export function rememberDeepLink() {
  const hash = location.hash.split('?')[0];
  if (!APP_ROUTE.test(hash) || SKIP.test(hash)) return;
  try { sessionStorage.setItem(KEY, hash); } catch { /* storage is optional */ }
}

/** Once inside the app: go back to the remembered route if onboarding or sign-in moved us off it. */
export function restoreDeepLink() {
  let hash = null;
  try { hash = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch { /* storage is optional */ }
  if (hash && APP_ROUTE.test(hash) && SKIP.test(location.hash.split('?')[0] || '#/')) history.replaceState(null, '', `/app${hash}`);
}

export function clearDeepLink() { try { sessionStorage.removeItem(KEY); } catch { /* storage is optional */ } }
