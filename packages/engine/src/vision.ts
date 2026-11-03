import type { ModelEnv } from '@pactovio/contracts/env';
import { formatLane, isModelUnavailable, resolveLane } from '@pactovio/models';

export { isModelUnavailable };

/** Tried in order when the configured vision lane's model is not served (it can be withdrawn): the previous Muse Spark version. */
export const VISION_FALLBACKS = ['meta:muse-spark-1.2@medium'] as const;

/** Lane strings ("<provider>:<model>@<effort>") for the vision role, configured lane first. */
export function visionModels(env: ModelEnv): string[] {
  return [...new Set([formatLane(resolveLane(env, 'vision')), ...VISION_FALLBACKS])];
}

/** Run `call(lane)` against each vision lane until one is served. Rethrows the last error. */
export async function withVisionModel<T>(env: ModelEnv, call: (lane: string) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const m of visionModels(env)) {
    try {
      return await call(m);
    } catch (e) {
      last = e;
      if (!isModelUnavailable(e)) throw e;
    }
  }
  throw last;
}
