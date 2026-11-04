// Cloudflare Pages advanced-mode worker for https://pactovio-meta.pages.dev
// /api/*, /v1/*, /mcp*, /webhooks/*, /ics/*, /dev/* -> service binding API (pactovio-api)
// everything else -> service binding WEB (pactovio-web, the UI) when bound, otherwise the static
// placeholder pages in this folder (landing, privacy, terms) via ASSETS, otherwise API.
const API_PATH = /^\/(api|v1|dev|webhooks|ics)(\/|$)|^\/mcp/;

export function isApiPath(pathname) {
  return API_PATH.test(pathname);
}

// /app/proposals/prp_1 -> /app#/proposals/prp_1: path-style app links open the in-app route (hash router).
const APP_PATH = /^\/app\/([a-z][a-z-]{1,30}(?:\/[\w.~%-]{1,120}){0,3})\/?$/;
export function appRedirect(url) {
  const m = APP_PATH.exec(url.pathname);
  return m ? `${url.origin}/app#/${m[1]}` : null;
}

export function pickTarget(pathname, env) {
  if (isApiPath(pathname)) return env.API;
  return env.WEB ?? env.ASSETS ?? env.API;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const to = ['GET', 'HEAD'].includes(request.method) ? appRedirect(url) : null;
    if (to) return Response.redirect(to, 302);
    const target = pickTarget(url.pathname, env);
    if (!target) return new Response(JSON.stringify({ error: 'API service binding missing', code: 'misconfigured' }), { status: 502, headers: { 'content-type': 'application/json' } });
    return target.fetch(request);
  },
};
