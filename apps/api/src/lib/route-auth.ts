import type { Context } from 'hono';
import { HttpError } from '@pactovio/contracts';
import { customerAuth } from './customer-session';
import { errorResponse } from './router';
import type { AppEnv } from './types';

/** Customer-session wrapper for plain Hono routes: every handler gets the session's workspace id and nothing else. */
export const authed = (fn: (c: Context<AppEnv>, ws: string) => Promise<Response>) => async (c: Context<AppEnv>) => {
  try {
    const auth = await customerAuth(c);
    c.set('auth', auth);
    c.header('cache-control', 'no-store');
    return await fn(c, auth.workspaceId);
  } catch (e) { return errorResponse(c, e); }
};

export async function jsonBody<T>(c: Context<AppEnv>, parse: (v: unknown) => T, max = 8_000): Promise<T> {
  const text = await c.req.text();
  if (text.length > max) throw new HttpError(413, 'The request is too large.', 'body_too_large');
  try { return parse(text ? JSON.parse(text) : {}); } catch (e) { if (e instanceof SyntaxError) throw new HttpError(400, 'Send a JSON request body.', 'validation'); throw e; }
}
