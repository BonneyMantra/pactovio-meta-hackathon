// Probe SAM 3.1 concepts on a floor-plan image (cents). Usage: set -a; . ./.env.local; set +a; npx tsx packages/proposal/scripts/sam-probe.ts <image> concept...
import { readFileSync } from 'node:fs';
import { segment } from '@pactovio/models';

const env = { META_API_KEY: process.env.META_API_KEY ?? process.env.PACTOVIO_META_MODEL_API_KEY };
const [img, ...concepts] = process.argv.slice(2);
const bytes = new Uint8Array(readFileSync(img!));
const res = await Promise.all(concepts.map((concept) => segment(env, { concept, image: { bytes, mime: 'image/png' } }).catch((e) => ({ concept, detections: [], err: String(e) }))));
for (const r of res) process.stdout.write(`${r.concept}: ${r.detections.length} ${'err' in r ? r.err : ''} ${JSON.stringify(r.detections.map((d) => d.box.map((v) => Math.round(v * 1000))))}\n`);
