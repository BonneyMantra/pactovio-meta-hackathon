/** Lane used when the agent lane's model is withdrawn or returns 404 'does not exist': the previous Muse Spark version. */
export const TEXT_FALLBACK_MODEL = 'meta:muse-spark-1.2@low';

/** The model endpoint rejected the model id itself (withdrawn or renamed), as opposed to a bad request. */
export function isModelUnavailable(e: unknown): boolean {
  const err = e as { status?: number; message?: string };
  return err?.status === 404 || /does not exist|model.*not found|unknown model/i.test(err?.message ?? '');
}
