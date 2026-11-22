/**
 * Penyimpanan desain rakit pipa di browser (localStorage 'reefsim:pipa'):
 *   { cur: desain aktif, saved: {nama: desain}, sim: {on, inlet, outlet, exit} }
 * sim = pilihan "pakai desain sebagai pipa return di simulasi" (fase 3).
 * Dipakai panel rakit pipa, laporan Claude, dan saat aplikasi mulai (memulihkan pipa return).
 */
import { validateDesign } from './model.js';
import { bom, bomMarkdown } from './bom.js';
import { analyzeLine, operatingPoints, hydroMarkdown, EXITS } from './hydro.js';

export const STORE = 'reefsim:pipa';

const end = (e) => (e && Number.isInteger(e.pid) && Number.isInteger(e.port) ? { pid: e.pid, port: e.port } : null);

export function defaultSim() {
  return { on: false, inlet: null, outlet: null, exit: 'duckbill' };
}

function cleanSim(s) {
  const d = defaultSim();
  if (!s || typeof s !== 'object') return d;
  return { on: s.on === true, inlet: end(s.inlet), outlet: end(s.outlet), exit: EXITS[s.exit] ? s.exit : d.exit };
}

export function loadStore(storage = globalThis.localStorage) {
  try {
    const s = JSON.parse(storage?.getItem(STORE) || 'null');
    if (!s || typeof s !== 'object') return { cur: null, saved: {}, sim: defaultSim() };
    const saved = {};
    for (const [k, v] of Object.entries(s.saved || {})) saved[k.slice(0, 60)] = validateDesign(v).design;
    return { cur: s.cur ? validateDesign(s.cur).design : null, saved, sim: cleanSim(s.sim) };
  } catch {
    return { cur: null, saved: {}, sim: defaultSim() };
  }
}

export function saveStore(data, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORE, JSON.stringify(data));
    return true;
  } catch {
    return false; // penyimpanan penuh / tidak tersedia
  }
}

/** Jalur return tersimpan untuk simulasi (null bila tidak dipakai / tidak valid). */
export function storedRetLine(storage) {
  const { cur, sim } = loadStore(storage);
  if (!cur || !sim.on) return null;
  const res = analyzeLine(cur, sim);
  return res.ok ? res.line : null;
}

/** Ringkasan desain tersimpan untuk laporan Claude (tanpa membuka mode rakit). */
export function plumbingSummary(app) {
  const { cur, sim } = loadStore();
  if (!cur || !cur.parts.length) return null;
  let markdown = bomMarkdown(bom(cur), cur.name);
  const res = analyzeLine(cur, sim);
  if (app && (res.ok || sim.on)) {
    const op = res.ok ? operatingPoints(res, app.P, app.S) : null;
    markdown += '\n\n#### Hidrolik jalur return (desain)\n\n' + hydroMarkdown(res, op, !!app.P.retLine);
  }
  return { name: cur.name, parts: cur.parts.length, markdown, usedInSim: !!app?.P.retLine };
}
