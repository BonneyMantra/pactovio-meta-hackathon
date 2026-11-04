// Live smoke for Meta media clients (cents). Usage: set -a; . ./.env.local; set +a; npx tsx packages/proposal/scripts/live-media.ts <outdir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateImage, segment } from '@pactovio/models';

const env = { META_API_KEY: process.env.META_API_KEY ?? process.env.PACTOVIO_META_MODEL_API_KEY };
const out = process.argv[2] ?? '.';
mkdirSync(out, { recursive: true });
const img = await generateImage(env, { prompt: 'Architectural 2D floor plan drawing of a small Indian bank branch, top-down black line drawing on white, labelled rooms: ATM lobby with one ATM, cash counter, strong room with safe, manager cabin, main entrance door, emergency exit door, windows on outer walls. Clean CAD style.', size: '1536x1024', format: 'jpeg', fast: true });
writeFileSync(`${out}/floorplan.jpg`, img.bytes);
process.stdout.write(`image ${img.bytes.length}B ${img.ms}ms $${img.costUsd}\n`);
for (const concept of ['door', 'ATM', 'window']) {
  const r = await segment(env, { concept, image: { bytes: img.bytes, mime: img.mime } });
  writeFileSync(`${out}/sam-${concept}.txt`, r.raw);
  process.stdout.write(`sam ${concept}: ${r.detections.length} boxes ${r.ms}ms $${r.costUsd} ${JSON.stringify(r.detections.slice(0, 2).map((d) => d.box))}\n`);
}
