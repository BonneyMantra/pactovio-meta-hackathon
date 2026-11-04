// Per-site zone and wiring schematic: field devices → panel inputs Z1..Zn → PCMU power → 4G → control room.
import { esc, list } from './kit.js';

const ROW = 40, TOP = 64, W = 900;

function glyph(z) {
  const s = `${z.device_sku} ${z.zone}`.toUpperCase();
  if (/SOS|PANIC/.test(s)) return 'SOS';
  if (/PIR|MOTION/.test(s)) return 'PIR';
  if (/VIB|SHOCK/.test(s)) return 'VIB';
  if (/KPD|KEYPAD|OTP/.test(s)) return 'KP';
  if (/TAMPER/.test(s)) return 'TMP';
  if (/SMOKE|FIRE/.test(s)) return 'SMK';
  if (/CAM|CCTV/.test(s)) return 'CAM';
  if (/CONTACT|SHUTTER|DOOR|MC/.test(s)) return 'MC';
  return 'DEV';
}

const pick = (items, re) => list(items).find((i) => re.test(String(i.sku || '').toUpperCase()));

/** zones: zone_map rows for one site; items: per-site kit rows for the same site; nameOf(sku) → product name. */
export function wiringSvg(zones, items, nameOf, opts = {}) {
  zones = list(zones);
  if (!zones.length) return '';
  const panel = pick(items, /(^|-)A?AP-|PANEL/) || { sku: 'Alarm panel' };
  const pcmu = pick(items, /PCMU/);
  const comm = pick(items, /2W4G|R1M2S|ADG|4G|ROUTER/);
  const n = zones.length, py = TOP - 26, ph = n * ROW + 40;
  const H = Math.max(py + ph + (pcmu ? 120 : 30), 300);
  const px = 392, pw = 128, cx = 596, cw = 150;
  const out = [];
  // Field devices and their wires into the panel terminal block.
  zones.forEach((z, i) => {
    const y = TOP + i * ROW + 6, g = glyph(z), term = String(z.input || `Z${i + 1}`);
    out.push(`<g class="dev"><rect x="8" y="${y - 13}" width="34" height="26" rx="5"/><text class="g" x="25" y="${y + 3.5}">${g}</text></g>`,
      `<text class="zl" x="52" y="${y - 1}">${esc(String(z.zone || '').slice(0, 30))}</text>`,
      `<text class="zs" x="52" y="${y + 12}">${esc(String(z.device_sku || '').slice(0, 30))}</text>`,
      `<path class="w" d="M236 ${y}H${px - 8}"/><circle class="j" cx="236" cy="${y}" r="2.4"/>`,
      `<text class="ws" x="${(236 + px) / 2}" y="${y - 5}">${esc(String(z.wiring || '').slice(0, 34))}</text>`,
      `<rect class="t" x="${px - 8}" y="${y - 6}" width="12" height="12" rx="2"/><text class="tn" x="${px + 12}" y="${y + 4}">${esc(term)}</text>`);
  });
  // Panel body.
  out.push(`<g class="blk rax"><rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="8"/>`,
    `<text class="bt" x="${px + 26}" y="${py + 18}">ALARM PANEL</text><text class="bs" x="${px + 26}" y="${py + 32}">${esc(panel.sku)}</text>`,
    `<text class="zs" x="${px + 26}" y="${py + ph - 10}">${n} zone input${n === 1 ? '' : 's'}</text></g>`);
  const outY = py + 28;
  if (comm) {
    out.push(`<path class="w" d="M${px + pw} ${outY}H${cx}"/><text class="ws" x="${(px + pw + cx) / 2}" y="${outY - 5}">alarm O/P</text>`,
      `<g class="blk rax"><rect x="${cx}" y="${outY - 24}" width="${cw}" height="48" rx="8"/><text class="bt" x="${cx + 12}" y="${outY - 6}">4G COMMS</text><text class="bs" x="${cx + 12}" y="${outY + 9}">${esc(comm.sku)}</text></g>`,
      `<path class="ant" d="M${cx + cw - 22} ${outY - 24}v-18m-7 0 7 7 7-7"/>`,
      `<path class="w dash" d="M${cx + cw} ${outY}H${W - 100}"/><text class="ws" x="${(cx + cw + W - 100) / 2}" y="${outY - 5}">4G LTE</text>`,
      `<g class="blk cli"><rect x="${W - 100}" y="${outY - 24}" width="94" height="48" rx="8"/><text class="bt" x="${W - 90}" y="${outY - 4}">CONTROL</text><text class="bt" x="${W - 90}" y="${outY + 10}">ROOM</text></g>`);
  }
  const sy = py + ph - 26;
  out.push(`<path class="w" d="M${px + pw} ${sy}H${cx}"/><text class="ws" x="${(px + pw + cx) / 2}" y="${sy - 5}">12 V O/P</text>`,
    `<g class="blk ext"><rect x="${cx}" y="${sy - 20}" width="${cw}" height="40" rx="8"/><text class="bt" x="${cx + 12}" y="${sy + 4}">SIREN · STROBE</text></g>`);
  if (pcmu) {
    const qy = py + ph + 62;
    out.push(`<path class="w pw" d="M${px + pw / 2} ${qy - 22}V${py + ph}"/><text class="ws" x="${px + pw / 2 + 8}" y="${py + ph + 22}" text-anchor="start">12 V DC · mains, battery status</text>`,
      `<g class="blk rax"><rect x="${px}" y="${qy - 22}" width="${pw}" height="44" rx="8"/><text class="bt" x="${px + 12}" y="${qy - 3}">POWER · PCMU</text><text class="bs" x="${px + 12}" y="${qy + 12}">${esc(pcmu.sku)}</text></g>`,
      `<path class="w pw" d="M236 ${qy}H${px}"/><text class="ws" x="${(236 + px) / 2}" y="${qy - 5}">230 VAC mains</text>`,
      `<g class="bat"><rect x="196" y="${qy - 12}" width="36" height="24" rx="3"/><path d="M204 ${qy}h8m4 0h8m-4-4v8"/></g><text class="zs" x="186" y="${qy + 4}" text-anchor="end">12 V 7 Ah SMF</text>`);
  }
  return `<svg class="pd-wire" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || 'Zone wiring schematic')}">${out.join('')}`
    + '</svg>';
}

export function siteGroups(siteKit) {
  const zones = list(siteKit?.zone_map), items = list(siteKit?.per_site_items);
  const keys = [...new Set(zones.map((z) => z.site || 'site'))];
  return keys.map((k) => {
    const own = items.filter((i) => i.site === k);
    return { key: k, zones: zones.filter((z) => (z.site || 'site') === k), items: own.length ? own : items.filter((i) => !i.site) };
  });
}
