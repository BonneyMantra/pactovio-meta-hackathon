import { endpoints, HttpError, type Workspace } from '@pactovio/contracts';
import { one } from '../lib/db';
import { sessionInfo } from '../lib/customer-session';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { findCompanyLogo, websiteUrl } from '../lib/company-logo';
import { takeLimit } from '../lib/customer-security';
import { customerAuth } from '../lib/customer-session';
import { errorResponse, type Register } from '../lib/router';
import type { AppEnv } from '../lib/types';

const DAY = 86400, REFRESH_MS = 7 * DAY * 1000;
const LogoQuery = z.object({ refresh: z.enum(['1', 'true']).optional() });
const logoKey = (ws: string) => `ws/${ws}/brand/logo`, missKey = (ws: string) => `logo-miss:${ws}`;

/** The company website: onboarding `website`, then the analysed site's URL, then profile_json.website. https only. */
async function companyWebsite(db: D1Database, ws: string): Promise<URL | null> {
  const ob = await db.prepare('SELECT data_json FROM company_onboarding WHERE workspace_id = ?').bind(ws).first<{ data_json: string }>();
  let data: { website?: unknown; website_analysis?: { url?: unknown } } = {};
  try { data = JSON.parse(ob?.data_json ?? '{}'); } catch { /* unreadable row */ }
  const wsRow = await db.prepare('SELECT profile_json FROM workspaces WHERE id = ?').bind(ws).first<{ profile_json: string | null }>();
  let profile: { website?: unknown } = {};
  try { profile = JSON.parse(wsRow?.profile_json ?? '{}'); } catch { /* unreadable row */ }
  for (const raw of [data.website, data.website_analysis?.url, profile.website]) { const u = websiteUrl(raw); if (u) return u; }
  return null;
}

function logoResponse(bytes: BodyInit, type: string, source: string): Response {
  const h = new Headers({ 'content-type': type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline', 'x-logo-source': source });
  h.set('content-security-policy', type === 'image/svg+xml' ? "default-src 'none'; style-src 'unsafe-inline'" : "default-src 'none'; sandbox");
  return new Response(bytes, { headers: h });
}
const noLogo = () => new HttpError(404, 'No company logo found', 'no_logo');

/** GET /api/workspaces/logo: the signed-in customer's logo from their own website, cached in R2 for 7 days. Mounted before the session router. */
export const workspaceLogoRoutes = new Hono<AppEnv>();
workspaceLogoRoutes.get('/logo', async (c: Context<AppEnv>) => {
  try {
    const auth = await customerAuth(c), ws = auth.workspaceId;
    const query = LogoQuery.parse(c.req.query());
    const stored = await c.env.FILES.get(logoKey(ws));
    const meta = stored?.customMetadata ?? {};
    const fresh = !!stored && Date.now() - Number(meta.fetched_at ?? 0) < REFRESH_MS;
    if (stored && fresh && !query.refresh) return logoResponse(await stored.arrayBuffer(), stored.httpMetadata?.contentType ?? 'application/octet-stream', meta.source_url ?? '');
    const site = await companyWebsite(c.env.DB, ws);
    const miss = (ttl: number) => c.env.CACHE.put(missKey(ws), site?.href ?? '', { expirationTtl: ttl });
    if (!site) { throw noLogo(); }
    if (!query.refresh && !stored && (await c.env.CACHE.get(missKey(ws))) === site.href) throw noLogo();
    if (query.refresh) await takeLimit(c.env.DB, `workspace-logo-refresh:${ws}`, 6, 3600);
    const found = await findCompanyLogo(site);
    if (!found) {
      if (stored) return logoResponse(await stored.arrayBuffer(), stored.httpMetadata?.contentType ?? 'application/octet-stream', meta.source_url ?? ''); // keep the last good copy
      await miss(DAY);
      throw noLogo();
    }
    await c.env.FILES.put(logoKey(ws), found.bytes, { httpMetadata: { contentType: found.type },
      customMetadata: { workspace_id: ws, source_url: found.source, website: site.href, fetched_at: String(Date.now()) } });
    await c.env.CACHE.delete(missKey(ws));
    return logoResponse(found.bytes, found.type, found.source);
  } catch (e) { c.header('cache-control', 'no-store'); return errorResponse(c, e); }
});

export const register: Register = (r) => {
  const getWs = async (db: D1Database, id: string): Promise<Workspace> => {
    const w = await one<Workspace>(db, 'SELECT * FROM workspaces WHERE id = ? AND sample = 0', id);
    if (!w) throw new HttpError(404, 'Workspace not found', 'not_found');
    return w;
  };
  r.on(endpoints.getSession, async ({ db, auth }) => {
    if (!auth.userId) throw new HttpError(400, 'Use a customer session', 'no_session');
    return sessionInfo(db, auth);
  });
  r.on(endpoints.listWorkspaces, async ({ db, auth }) => ({ items: [await getWs(db, auth.workspaceId)] }));
  r.on(endpoints.getWorkspace, async ({ db, params, auth }) => {
    if (params.id !== auth.workspaceId) throw new HttpError(404, 'Workspace not found', 'not_found');
    return getWs(db, params.id);
  });
  r.on(endpoints.switchWorkspace, async ({ db, body, auth }) => {
    if (!auth.userId) throw new HttpError(400, 'Use a customer session', 'no_session');
    if (body.workspace_id !== auth.workspaceId) throw new HttpError(403, 'Workspace is not available to this session', 'forbidden');
    return sessionInfo(db, auth);
  });
};
