/**
 * Templat rakitan siap pakai (fase 2), dirakit dari bagian katalog biasa sehingga bisa diubah,
 * dihitung daftar bahannya, dan (untuk return) dipakai sebagai pipa return di simulasi.
 *
 *  - U-pipe siphon: sesuai siphon di simulasi — kaki tank di x = 5 cm, z = 3,5 cm, intake di
 *    ketinggian zin; puncak garis tengah 34 cm; kaki filter di z = −7,5 cm sampai ujung buang zd;
 *    ball valve di kaki tank dekat puncak.
 *  - Return pompa: dari keluaran pompa (44,5 · 6,2 · −7,5 cm) naik, menyeberang di atas kaca
 *    pada 33,6 cm, turun ke sendi duckbill (26,4 cm) — rute yang sama dengan selang return di
 *    simulasi — dengan union di atas pompa (mudah dilepas) dan ball valve di atas muka air filter.
 */
import { addRoot, addPart, updatePart, insertInline, frames, partPorts } from './model.js';
import { dims, Z, SIZES } from './catalog.js';

const dot = (a, b) => a.x * b[0] + a.y * b[1] + a.z * b[2];

/**
 * Putar bagian (kelipatan 45°) supaya ujung keluarnya (port selain sambungan ke induk)
 * menghadap arah want.
 */
export function rollToward(design, id, want, port) {
  const part = design.parts.find((p) => p.id === id);
  const n = partPorts(part).length;
  const out = port ?? [...Array(n).keys()].find((i) => i !== (part.cport ?? 0));
  let best = 0;
  let bestDot = -2;
  for (let r = 0; r < 360; r += 45) {
    updatePart(design, id, { roll: r });
    const d = frames(design).get(id).ports[out].d;
    const k = dot(d, want);
    if (k > bestDot + 1e-6) {
      bestDot = k;
      best = r;
    }
  }
  updatePart(design, id, { roll: best });
  return bestDot;
}

/** Fraksi letak sisipan supaya potongan sisa di ujung jauh tepat `tail` mm. */
function atForTail(len, span, tail) {
  return Math.max(0.05, Math.min(0.95, (len - span - tail) / (len - span)));
}

/**
 * U-pipe siphon.
 * @returns {number} id akar
 */
export function addSiphon(design, { size = 'i12', cls = 'AW', color = 'bening', x = 50, zTank = 35, zFilter = -75, yTop = 340, zin = 80, zd = 220, valve = true } = {}) {
  const A = dims(size, cls);
  const z90 = Z.z90(A);
  const root = addRoot(design, { type: 'pipe', size, cls, color, len: yTop - z90 - zin, anchor: { p: [x, zin, zTank], dir: 'up' } });
  const e1 = addPart(design, root, 1, { type: 'elbow90', slot: 'a', color });
  rollToward(design, e1, [0, 0, -1]);
  const p1 = addPart(design, e1, 1, { type: 'pipe', slot: 'a', len: zTank - zFilter - 2 * z90, color });
  const e2 = addPart(design, p1, 1, { type: 'elbow90', slot: 'a', color });
  rollToward(design, e2, [0, -1, 0]);
  addPart(design, e2, 1, { type: 'pipe', slot: 'a', len: yTop - z90 - zd, color });
  if (valve) {
    // ball valve di kaki tank, sedekat mungkin ke knee atas (sisa pipa 20 mm)
    const span = 2 * Z.v(A);
    const pipe = design.parts.find((p) => p.id === root);
    insertInline(design, root, 'ballvalve', atForTail(pipe.len, span, 20));
  }
  return root;
}

/**
 * Return dari pompa ke duckbill dengan union + ball valve.
 * @returns {number} id akar
 */
export function addReturn(design, { size = 'i12', cls = 'AW', color = 'abu', from = [445, 62, -75], yTop = 336, zTank = 35, yOut = 264 } = {}) {
  const A = dims(size, cls);
  const z90 = Z.z90(A);
  const root = addRoot(design, { type: 'pipe', size, cls, color, len: yTop - z90 - from[1], anchor: { p: from, dir: 'up' } });
  const e1 = addPart(design, root, 1, { type: 'elbow90', slot: 'a', color });
  rollToward(design, e1, [0, 0, 1]);
  const p1 = addPart(design, e1, 1, { type: 'pipe', slot: 'a', len: zTank - from[2] - 2 * z90, color });
  const e2 = addPart(design, p1, 1, { type: 'elbow90', slot: 'a', color });
  rollToward(design, e2, [0, -1, 0]);
  addPart(design, e2, 1, { type: 'pipe', slot: 'a', len: yTop - z90 - yOut, color });
  // union tepat di atas pompa (sisa pipa bawah ±22 mm), lalu ball valve di atas muka air filter
  const { pipe: upper } = insertInline(design, root, 'union', 0.1);
  const q = design.parts.find((p) => p.id === upper);
  const span = 2 * Z.v(A);
  const yUnionTop = from[1] + design.parts.find((p) => p.id === root).len + 2 * Z.u(A);
  // pusat valve di ±23 cm (muka air chamber pompa ±18 cm)
  const at = (230 - Z.v(A) - yUnionTop) / (q.len - span);
  insertInline(design, upper, 'ballvalve', Math.max(0.1, Math.min(0.9, at)));
  return root;
}

/** Templat: ukuran kecil/besar per seri (Indonesia ½"/¾", metrik 20/25 mm). */
export const TEMPLATES = [
  { id: 'siphon-s', kind: 'siphon', size: { in: 'i12', m: 'm20' } },
  { id: 'siphon-l', kind: 'siphon', size: { in: 'i34', m: 'm25' } },
  { id: 'return-s', kind: 'return', size: { in: 'i12', m: 'm20' } },
  { id: 'return-l', kind: 'return', size: { in: 'i34', m: 'm25' } },
];

export const templateLabel = (t, series) => (t.kind === 'siphon' ? 'U-pipe siphon ' : 'Return pompa ') + SIZES[t.size[series] || t.size.in].label + (t.kind === 'return' ? ' + union + ball valve' : '');

/** Rakit templat ke desain; mengembalikan id akar. */
export function buildTemplate(design, t, { series = 'in', cls = 'AW' } = {}) {
  const size = t.size[series] || t.size.in;
  return t.kind === 'siphon' ? addSiphon(design, { size, cls }) : addReturn(design, { size, cls });
}
