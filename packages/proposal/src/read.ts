import { docxBytesToPages } from '@pactovio/engine';
import type { ChatMessage } from '@pactovio/models';
import { bytesToB64 } from '@pactovio/models';
import { ask, runStep, type RfqFile, type RunCtx } from './ctx';
import { RfqRead } from './schema';

const isImage = (f: RfqFile) => f.mime.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.filename);
const isPdf = (f: RfqFile) => /pdf/i.test(f.mime) || /\.pdf$/i.test(f.filename);
const isDocx = (f: RfqFile) => /\.docx$/i.test(f.filename);
const imageMime = (f: RfqFile) => (f.mime.startsWith('image/') ? f.mime : /\.jpe?g$/i.test(f.filename) ? 'image/jpeg' : /\.webp$/i.test(f.filename) ? 'image/webp' : 'image/png');

/** User-message content parts for the whole RFQ: PDFs go in natively (file part), images as image_url, DOCX/email as text. */
export function rfqParts(files: RfqFile[]): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = [];
  for (const f of files) {
    if (isPdf(f)) parts.push({ type: 'text', text: `Document: ${f.filename}` }, { type: 'file', file: { filename: f.filename, file_data: `data:application/pdf;base64,${bytesToB64(f.bytes)}` } });
    else if (isImage(f)) parts.push({ type: 'text', text: `Image attachment: ${f.filename}` }, { type: 'image_url', image_url: { url: `data:${imageMime(f)};base64,${bytesToB64(f.bytes)}` } });
    else if (isDocx(f)) parts.push({ type: 'text', text: `Document: ${f.filename}\n${docxBytesToPages(f.bytes).map((p, i) => `[page ${i + 1}]\n${p}`).join('\n')}` });
    else parts.push({ type: 'text', text: `Document: ${f.filename}\n${new TextDecoder().decode(f.bytes).slice(0, 60_000)}` });
  }
  return parts;
}

const SYSTEM = `You read a buyer's RFQ/RFP pack for a technical B2B supplier and extract what a bid team needs. Rules:
- Every requirement is one atomic, testable statement in the buyer's own terms, with the document filename and the page number where it appears (null page for emails or text without pages).
- Capture eligibility conditions, functional requirements, integrations, SLAs, timeline, commercial terms. At most 40 requirements, most important first; merge duplicates and keep each under 30 words.
- "sites" = the number of ATM sites and branch sites the buyer lists (0 when not stated).
- "due_date" = the bid submission deadline as ISO "YYYY-MM-DD" (null when not stated).
- "floorplan_file" = the filename of an attached image that is a floor plan or site drawing, else null.
- Never invent numbers or page numbers. Ids are R1, R2, ...`;

export const readRfq = (ctx: RunCtx): Promise<string> => runStep(ctx, 'read_rfq', () => !!ctx.state.rfq, async () => {
  if (!ctx.files.length) throw new Error('No RFQ documents to read');
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: [...rfqParts(ctx.files), { type: 'text', text: 'Extract the RFQ now as JSON.' }] }] as unknown as ChatMessage[];
  const rfq = await ask(ctx, RfqRead, { purpose: 'Read RFQ (native PDF)', role: 'reason', messages, maxTokens: 9000, name: 'rfq_read', timeoutMs: 170_000 });
  const names = new Set(ctx.files.map((f) => f.filename));
  if (!rfq.floorplan_file || !names.has(rfq.floorplan_file)) rfq.floorplan_file = ctx.files.find(isImage)?.filename ?? null;
  rfq.requirements = rfq.requirements.slice(0, 60);
  ctx.state.rfq = rfq;
  return `${rfq.requirements.length} requirements from ${ctx.files.length} file(s)`;
});
