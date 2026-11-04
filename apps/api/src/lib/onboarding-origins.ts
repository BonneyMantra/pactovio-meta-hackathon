import type { Context } from 'hono';
import type { AppEnv } from './types';

type OriginEnv = { PUBLIC_ORIGIN?: string; EXTRA_ORIGINS?: string };

/** The named QA host: the first EXTRA_ORIGINS entry (the qa Pages alias on the same Worker). */
const qaOrigin = (env: OriginEnv): string | undefined => String(env.EXTRA_ORIGINS ?? '').split(',').map((s) => s.trim()).find(Boolean);

/** The site origins this Worker serves: the public alias and, when configured, the named QA host on the same Pages project. */
export function siteOrigins(env: OriginEnv): string[] {
  const ok = (o: unknown): o is string => typeof o === 'string' && /^https?:\/\/[^/]+$/.test(o);
  // The QA host is an addition to a configured public alias, never a replacement for the request's own origin.
  const qa = qaOrigin(env);
  return ok(env.PUBLIC_ORIGIN) ? [env.PUBLIC_ORIGIN, ...(ok(qa) ? [qa] : [])] : [];
}

export const isSiteOrigin = (env: OriginEnv, origin: string | undefined | null): boolean => !!origin && siteOrigins(env).includes(origin);

/** The origin a flow started from (for OAuth callbacks and returns): the request's own host when it is a site origin, else the public one. */
export function flowOrigin(c: Context<AppEnv>): string {
  const own = new URL(c.req.url).origin;
  const env = c.env as OriginEnv;
  return isSiteOrigin(env, own) || !siteOrigins(env).length ? own : env.PUBLIC_ORIGIN!;
}

/**
 * Composio allows one verifier URL per project (the public alias). A sign-in started on the QA host arrives there without
 * that host's cookies; hand the same single-use callback to the QA host, which holds the session and the OAuth state cookie.
 * Nothing is trusted from the query: the QA host still derives the user from its own session before Composio activates anything.
 */
export function qaHandoff(c: Context<AppEnv>, hasFlowCookie: boolean): string | null {
  const env = c.env as OriginEnv, qa = qaOrigin(env);
  const url = new URL(c.req.url);
  if (hasFlowCookie || !qa || !isSiteOrigin(env, qa) || url.origin === qa) return null;
  return `${qa}${url.pathname}${url.search}`;
}
