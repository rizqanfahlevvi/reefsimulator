/**
 * Model rakitan pipa (murni, tanpa DOM): bagian-bagian tersusun sebagai pohon. Tiap bagian
 * menempel pada satu port induknya lewat salah satu port miliknya, dengan putaran (roll) di
 * sumbu sambungan. Akar menempel pada titik awal (anchor) dengan arah tumbuh.
 *
 * Satuan mm. Bagian: { id, type, size, sizeB?, cls, len?, color, parent, pport, cport, roll, anchor? }
 */
import * as THREE from 'three';
import { TYPES, SIZES, COLORS, dims, portsOf, mates, sizesMatch, smallerSizes, SIZE_ORDER, classFor } from './catalog.js';

export const DIRS = { up: [0, 1, 0], down: [0, -1, 0], '+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
export const DIR_LABEL = { up: 'ke atas', down: 'ke bawah', '+x': 'ke kanan', '-x': 'ke kiri', '+z': 'ke depan', '-z': 'ke belakang' };
/** Panjang potong pipa yang diizinkan (mm). */
export const LEN = { min: 20, max: 4000 };
/** Fitting lurus yang bisa disisipkan di tengah pipa. */
export const INLINE = ['socket', 'union', 'ballvalve', 'gatevalve', 'bulkhead'];

export function newDesign(name = 'Desain pipa') {
  return { v: 1, name, parts: [], seq: 1 };
}

const byId = (design, id) => design.parts.find((p) => p.id === id);

/** Port lokal sebuah bagian, lengkap dengan ukuran tiap port. */
export function partPorts(part) {
  const A = dims(part.size, part.cls);
  const B = part.sizeB ? dims(part.sizeB, part.cls) : A;
  return portsOf(part.type, A, B, part.len || 0).map((pt) => ({ ...pt, size: pt.slot === 'b' ? part.sizeB : part.size }));
}

/** Urutan induk-sebelum-anak (DFS dari akar). */
export function order(design) {
  const kids = new Map();
  for (const p of design.parts) {
    const k = p.parent ?? 'root';
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(p);
  }
  const out = [];
  const walk = (k) => {
    for (const p of kids.get(k) || []) {
      out.push(p);
      walk(p.id);
    }
  };
  walk('root');
  return out;
}

const UP = new THREE.Vector3(0, 1, 0);
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** Arah "atas" acuan untuk titik awal: tegak lurus arah tumbuh. */
function anchorUp(d) {
  return Math.abs(d.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : UP.clone();
}

/**
 * Transform dunia tiap bagian + port dunianya.
 * @returns {Map<number, {m: THREE.Matrix4, ports: Array<{p: THREE.Vector3, d: THREE.Vector3, u: THREE.Vector3, end: string, size: string}>}>}
 */
export function frames(design) {
  const out = new Map();
  for (const part of order(design)) {
    let Pw;
    let Dw;
    let Uw;
    if (part.parent == null) {
      const a = part.anchor || { p: [0, 0, 0], dir: 'up' };
      Pw = v3(a.p);
      Dw = v3(DIRS[a.dir] || DIRS.up);
      Uw = anchorUp(Dw);
    } else {
      const pf = out.get(part.parent);
      const pp = pf?.ports[part.pport];
      if (!pp) continue; // induk tidak valid (seharusnya sudah divalidasi)
      Pw = pp.p.clone();
      Dw = pp.d.clone();
      Uw = pp.u.clone();
    }
    const local = partPorts(part);
    const c = local[part.cport ?? 0];
    const dc = v3(c.d);
    const uc = UP.clone();
    const wc = new THREE.Vector3().crossVectors(dc, uc);
    const Dt = Dw.clone().negate();
    const Ut = Uw.clone().applyAxisAngle(Dw, ((part.roll || 0) * Math.PI) / 180);
    const Wt = new THREE.Vector3().crossVectors(Dt, Ut);
    const Mc = new THREE.Matrix4().makeBasis(dc, uc, wc);
    const Mt = new THREE.Matrix4().makeBasis(Dt, Ut, Wt);
    const R = Mt.multiply(Mc.transpose());
    const pc = v3(c.p).applyMatrix4(R);
    const m = R.clone().setPosition(Pw.clone().sub(pc));
    const rot = new THREE.Matrix3().setFromMatrix4(m);
    const ports = local.map((pt) => ({
      p: v3(pt.p).applyMatrix4(m),
      d: v3(pt.d).applyMatrix3(rot).normalize(),
      u: UP.clone().applyMatrix3(rot).normalize(),
      end: pt.end,
      size: pt.size,
    }));
    out.set(part.id, { m, ports });
  }
  return out;
}

/** Port yang belum tersambung. */
export function freePorts(design, fr = frames(design)) {
  const used = new Set();
  for (const p of design.parts) {
    // ujung akar di titik awal tetap terbuka (secara fisik ujung pipa bebas, bisa diteruskan mundur)
    if (p.parent == null) continue;
    used.add(p.id + ':' + (p.cport ?? 0));
    used.add(p.parent + ':' + p.pport);
  }
  const out = [];
  for (const p of design.parts) {
    const f = fr.get(p.id);
    if (!f) continue;
    f.ports.forEach((pt, i) => {
      if (!used.has(p.id + ':' + i)) out.push({ pid: p.id, port: i, ...pt, cls: p.cls });
    });
  }
  return out;
}

/** Sumbu terdekat untuk arah dunia → label. */
export function dirLabel(d) {
  let best = 'up';
  let bd = -2;
  for (const [k, a] of Object.entries(DIRS)) {
    const dot = d.x * a[0] + d.y * a[1] + d.z * a[2];
    if (dot > bd) {
      bd = dot;
      best = k;
    }
  }
  return bd > 0.98 ? DIR_LABEL[best] : DIR_LABEL[best] + ' (miring)';
}

const larger = (size) => {
  const order = SIZE_ORDER[SIZES[size].series];
  return order.slice(order.indexOf(size) + 1);
};

/**
 * Bagian yang bisa disambung ke port induk (end, size). Satu entri per (jenis, slot port).
 * @returns {Array<{type: string, slot: 'a'|'b', cports: number[], other: string[]|null, label: string}>}
 */
export function candidates(end, size, cls = 'AW') {
  const out = [];
  const A = dims(size, cls);
  for (const [type, t] of Object.entries(TYPES)) {
    const ports = portsOf(type, A, A, 100);
    for (const slot of ['a', 'b']) {
      if (slot === 'b' && !t.two) continue;
      const cports = ports.map((p, i) => ({ p, i })).filter(({ p }) => p.slot === slot && mates(end, p.end)).map(({ i }) => i);
      if (!cports.length) continue;
      let other = null;
      if (t.two) {
        other = slot === 'a' ? smallerSizes(size) : larger(size);
        if (!other.length) continue;
      }
      const label = t.two ? `${t.name} (${slot === 'a' ? 'perkecil' : 'perbesar'})` : t.name;
      out.push({ type, slot, cports, other, label });
    }
  }
  return out;
}

function check(cond, msg) {
  if (!cond) throw new Error(msg);
}

function makePart(design, o) {
  const t = TYPES[o.type];
  check(t, 'Jenis tidak dikenal: ' + o.type);
  check(SIZES[o.size], 'Ukuran tidak dikenal: ' + o.size);
  if (t.two) check(o.sizeB && SIZES[o.sizeB], 'Ukuran kedua dibutuhkan untuk ' + t.name);
  const part = {
    id: design.seq++,
    type: o.type,
    size: o.size,
    cls: classFor(o.size, o.cls),
    color: COLORS[o.color] ? o.color : 'abu',
    parent: o.parent ?? null,
    pport: o.pport ?? null,
    cport: o.cport ?? 0,
    roll: ((Math.round(o.roll || 0) % 360) + 360) % 360,
  };
  if (t.two) part.sizeB = o.sizeB;
  if (o.type === 'pipe') part.len = clampLen(o.len ?? 200);
  if (part.parent == null) part.anchor = { p: (o.anchor?.p || [0, 0, 0]).map(Number), dir: DIRS[o.anchor?.dir] ? o.anchor.dir : 'up' };
  return part;
}

/** Batasi panjang potong (mm); dibulatkan ke 0,1 mm kecuali exact (sisa pembagian pipa). */
export const clampLen = (v, exact = false) => {
  const x = Math.min(LEN.max, Math.max(LEN.min, +v || 0));
  return exact ? x : Math.round(x * 10) / 10;
};

/** Rangkaian baru dari titik awal. */
export function addRoot(design, o) {
  const part = makePart(design, { ...o, parent: null });
  design.parts.push(part);
  return part.id;
}

/**
 * Tempel bagian baru ke port induk.
 * @param {object} o { type, slot, cport?, other?, cls, len?, color, roll }
 */
export function addPart(design, parentId, pport, o) {
  const parent = byId(design, parentId);
  check(parent, 'Induk tidak ditemukan');
  const pp = partPorts(parent)[pport];
  check(pp, 'Port induk tidak valid');
  check(freePorts(design).some((f) => f.pid === parentId && f.port === pport), 'Port induk sudah terpakai');
  const t = TYPES[o.type];
  const slot = o.slot || 'a';
  const opts = { type: o.type, cls: o.cls || parent.cls, color: o.color || parent.color, len: o.len, roll: o.roll, parent: parentId, pport };
  if (slot === 'a') {
    opts.size = pp.size;
    if (t.two) opts.sizeB = o.other;
  } else {
    opts.sizeB = pp.size;
    opts.size = o.other;
  }
  const tmp = makePart({ seq: 0 }, opts);
  const ports = partPorts(tmp);
  const cport = o.cport ?? ports.findIndex((p) => p.slot === slot && mates(pp.end, p.end));
  const cp = ports[cport];
  check(cp && mates(pp.end, cp.end), `${t.name} tidak bisa disambung ke ${pp.end === 'P' ? 'ujung pipa' : 'ujung ini'}`);
  check(sizesMatch(pp.end, pp.size, cp.end, cp.size), 'Ukuran tidak cocok');
  const part = makePart(design, { ...opts, cport });
  design.parts.push(part);
  return part.id;
}

/** Hapus bagian beserta semua bagian yang menempel padanya. */
export function removePart(design, id) {
  const gone = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of design.parts)
      if (p.parent != null && gone.has(p.parent) && !gone.has(p.id)) {
        gone.add(p.id);
        grew = true;
      }
  }
  design.parts = design.parts.filter((p) => !gone.has(p.id));
  return gone.size;
}

/** Port lain dari bagian yang sama yang juga bisa dipakai menyambung ke induk. */
export function altCports(design, id) {
  const part = byId(design, id);
  if (!part) return [];
  const ports = partPorts(part);
  const me = ports[part.cport ?? 0];
  if (part.parent == null) return ports.map((_, i) => i).filter((i) => ports[i].end === me.end && ports[i].size === me.size);
  const pp = partPorts(byId(design, part.parent))[part.pport];
  return ports.map((p, i) => ({ p, i })).filter(({ p }) => mates(pp.end, p.end) && sizesMatch(pp.end, pp.size, p.end, p.size)).map(({ i }) => i);
}

/**
 * Ubah bagian: len (pipa), roll, color, cport (ganti ujung yang menyambung ke induk), anchor (akar).
 */
export function updatePart(design, id, patch) {
  const part = byId(design, id);
  check(part, 'Bagian tidak ditemukan');
  if (patch.len !== undefined && part.type === 'pipe') part.len = clampLen(patch.len);
  if (patch.roll !== undefined) part.roll = ((Math.round(patch.roll) % 360) + 360) % 360;
  if (patch.color !== undefined && COLORS[patch.color]) part.color = patch.color;
  if (patch.anchor && part.parent == null) {
    part.anchor = { p: (patch.anchor.p || part.anchor.p).map(Number), dir: DIRS[patch.anchor.dir] ? patch.anchor.dir : part.anchor.dir };
  }
  if (patch.cport !== undefined && patch.cport !== part.cport) {
    check(altCports(design, id).includes(patch.cport), 'Ujung ini tidak bisa menyambung ke induk');
    const old = part.cport;
    // bagian yang menempel di ujung yang sekarang dipakai menyambung → pindah ke ujung lama
    for (const k of design.parts) if (k.parent === id && k.pport === patch.cport) k.pport = old;
    part.cport = patch.cport;
  }
  return part;
}

/**
 * Sisipkan fitting lurus (sok, union, valve, bulkhead) di tengah pipa: pipa dibelah dua dan
 * panjang total (antar ujung pipa) tetap. Bagian di ujung jauh pindah ke pipa kedua.
 * @returns {{fitting: number, pipe: number}}
 */
export function insertInline(design, pipeId, type, at = 0.5) {
  const pipe = byId(design, pipeId);
  check(pipe && pipe.type === 'pipe', 'Hanya bisa disisipkan di pipa');
  check(INLINE.includes(type), TYPES[type]?.name + ' tidak bisa disisipkan di tengah pipa');
  const A = dims(pipe.size, pipe.cls);
  const fp = portsOf(type, A, A, 0);
  const span = Math.abs(fp[1].p[2] - fp[0].p[2]);
  const L = pipe.len;
  const L1 = Math.round((L - span) * Math.min(0.95, Math.max(0.05, at)) * 10) / 10;
  const L2 = L - span - L1; // tidak dibulatkan: panjang total tepat sama
  check(L1 >= LEN.min && L2 >= LEN.min, `Pipa terlalu pendek untuk disisipi ${TYPES[type].name}`);
  const far = 1 - (pipe.cport ?? 0);
  const movers = design.parts.filter((k) => k.parent === pipeId && k.pport === far);
  for (const k of movers) k.pport = -1; // lepas sementara supaya ujung jauh bebas untuk fitting baru
  pipe.len = L1;
  const fid = addPart(design, pipeId, far, { type, slot: 'a', cport: 0, cls: pipe.cls, color: pipe.color });
  const qid = addPart(design, fid, 1, { type: 'pipe', slot: 'a', cport: 0, len: L2, cls: pipe.cls, color: pipe.color });
  byId(design, qid).len = clampLen(L2, true);
  for (const k of movers) {
    k.parent = qid;
    k.pport = 1;
  }
  return { fitting: fid, pipe: qid };
}

/** Salinan dalam (untuk undo/redo). */
export const cloneDesign = (d) => JSON.parse(JSON.stringify(d));

/**
 * Validasi desain dari penyimpanan/berkas: bagian tidak valid (dan semua yang menempel padanya)
 * dibuang, bukan membuat aplikasi error.
 * @returns {{design: object, dropped: number}}
 */
export function validateDesign(raw) {
  const d = newDesign(typeof raw?.name === 'string' ? raw.name.slice(0, 60) : 'Desain pipa');
  if (!raw || !Array.isArray(raw.parts)) return { design: d, dropped: 0 };
  const ok = new Map();
  let dropped = 0;
  // urutkan agar induk diproses dulu
  const pending = raw.parts.filter((p) => p && typeof p === 'object');
  let progress = true;
  while (pending.length && progress) {
    progress = false;
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      const isRoot = p.parent == null;
      if (!isRoot && !ok.has(p.parent)) continue;
      pending.splice(i--, 1);
      progress = true;
      try {
        if (!Number.isInteger(p.id) || ok.has(p.id)) throw new Error('id');
        const part = makePart({ seq: p.id }, { ...p, parent: isRoot ? null : p.parent, pport: isRoot ? null : p.pport });
        const ports = partPorts(part);
        if (!ports[part.cport]) throw new Error('cport');
        if (!isRoot) {
          const pp = partPorts(ok.get(p.parent))[p.pport];
          const cp = ports[part.cport];
          if (!pp || !mates(pp.end, cp.end) || !sizesMatch(pp.end, pp.size, cp.end, cp.size)) throw new Error('sambungan');
          // satu port induk hanya untuk satu anak
          if ([...ok.values()].some((q) => q.parent === p.parent && q.pport === p.pport)) throw new Error('ganda');
        }
        ok.set(part.id, part);
      } catch {
        dropped++;
      }
    }
  }
  dropped += pending.length; // induknya hilang
  d.parts = [...ok.values()];
  d.seq = Math.max(1, ...d.parts.map((p) => p.id + 1));
  return { design: d, dropped };
}
