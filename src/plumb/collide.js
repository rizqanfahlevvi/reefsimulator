/**
 * Cek tabrakan rakit pipa (fase 2): bagian vs kaca tank/filter/sekat/meja, dan antar bagian.
 *
 * Tiap bagian didekati sebagai beberapa kapsul (ruas garis + jari-jari) di ruang dunia (mm):
 * pipa = satu kapsul selebar diameter luar; fitting = kapsul dari titik pusat ke tiap port
 * selebar badan sok. Benda di sekitar tank = kotak (dari geometri tank & ruangan di scene).
 * Bulkhead memang dipasang menembus kaca, jadi tidak dicek terhadap kaca/sekat. Bagian yang
 * bersebelahan di rakitan (sampai 2 sambungan) tidak dicek satu sama lain karena memang
 * bersinggungan di sok. Toleransi 1 mm supaya bersentuhan pas tidak dianggap menabrak.
 */
import { dims } from './catalog.js';
import { frames, partPorts } from './model.js';
import * as THREE from 'three';

/** Kotak penghalang (cm): [x0, x1, y0, y1, z0, z1]; glass = boleh ditembus bulkhead. */
export const OBSTACLES = [
  { name: 'kaca dasar tank', b: [0, 50, -0.5, 0, 0, 25], glass: true },
  { name: 'kaca depan tank', b: [0, 50, 0, 30, 24.5, 25], glass: true },
  { name: 'kaca belakang tank', b: [0, 50, 0, 30, 0, 0.5], glass: true },
  { name: 'kaca kiri tank', b: [0, 0.5, 0, 30, 0.5, 24.5], glass: true },
  { name: 'kaca kanan tank', b: [49.5, 50, 0, 30, 0.5, 24.5], glass: true },
  { name: 'kaca dasar filter', b: [0, 50, -0.5, 0, -13, -2], glass: true },
  { name: 'kaca belakang filter', b: [0, 50, 0, 30, -13, -12.5], glass: true },
  { name: 'kaca depan filter', b: [0, 50, 0, 30, -2.5, -2], glass: true },
  { name: 'kaca kiri filter', b: [0, 0.5, 0, 30, -12.5, -2.5], glass: true },
  { name: 'kaca kanan filter', b: [49.5, 50, 0, 30, -12.5, -2.5], glass: true },
  { name: 'sekat 1 filter', b: [10.5, 11, 3, 30, -12.5, -2.5], glass: true },
  { name: 'sekat 2 filter', b: [21, 21.5, 0, 22.5, -12.5, -2.5], glass: true },
  { name: 'sekat 3 filter', b: [36.5, 37, 3, 30, -12.5, -2.5], glass: true },
  { name: 'sekat 4 filter', b: [39, 39.5, 0, 20, -12.5, -2.5], glass: true },
  { name: 'badan pompa return', b: [42, 47, 0.3, 4.6, -10, -5.2] },
  { name: 'protein skimmer', b: [11.7, 20.3, 0, 24, -11.8, -3.2] },
  { name: 'meja', b: [-6, 72, -2.5, -0.5, -18, 29] },
  { name: 'lemari', b: [-4, 70, -62, -2.5, -16, 27] },
];

const TOL = 1; // mm

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** Kapsul lokal sebuah bagian: [{a, b, r}] (mm, ruang lokal). */
export function localCapsules(part) {
  const A = dims(part.size, part.cls);
  const B = part.sizeB ? dims(part.sizeB, part.cls) : A;
  const ports = partPorts(part);
  const P = ports.map((p) => p.p);
  const O = [0, 0, 0];
  const hub = Math.max(A.hubR, B.hubR);
  const caps = [];
  const add = (a, b, r) => caps.push({ a, b, r });
  switch (part.type) {
    case 'pipe':
      add(P[0], P[1], A.od / 2);
      break;
    case 'elbow90':
    case 'elbow45':
    case 'elbow90r':
    case 'elbowF':
    case 'elbowMF':
    case 'tee':
    case 'teeR':
    case 'teeF':
    case 'cross':
      for (const p of P) add(O, p, hub);
      break;
    case 'bend180': {
      // garis tengah U (kurva Bezier di geometry.js): puncak di z ≈ R
      const R = Math.abs(P[0][0]);
      const pts = [P[0], [-0.69 * R, 0, 0.75 * R], [0, 0, R], [0.69 * R, 0, 0.75 * R], P[1]];
      for (let i = 0; i < 4; i++) add(pts[i], pts[i + 1], hub);
      break;
    }
    case 'cap':
    case 'capF':
    case 'plug':
    case 'blindflange':
      add(P[0], [0, 0, 0.2 * A.od + 4], part.type === 'blindflange' ? 0.5 * (2.2 * A.od + 45) : A.fhubR);
      break;
    case 'flange':
      add(P[0], P[1], 0.5 * (2.2 * A.od + 45));
      break;
    case 'union':
      add(P[0], P[1], A.hubR * 1.38);
      break;
    case 'ballvalve':
    case 'gatevalve':
      add(P[0], P[1], A.hubR * 1.05);
      add(O, O, A.hubR * (part.type === 'ballvalve' ? 1.6 : 1.45));
      break;
    default:
      add(P[0], P[1] || P[0], hub);
  }
  return caps;
}

/** Kapsul dunia semua bagian: Map id → [{a: Vector3, b: Vector3, r}]. */
export function worldCapsules(design, fr = frames(design)) {
  const out = new Map();
  for (const p of design.parts) {
    const f = fr.get(p.id);
    if (!f) continue;
    out.set(
      p.id,
      localCapsules(p).map((c) => ({ a: v3(c.a).applyMatrix4(f.m), b: v3(c.b).applyMatrix4(f.m), r: c.r })),
    );
  }
  return out;
}

/** Jarak titik ke kotak (mm). */
function pointBox(p, b) {
  const dx = Math.max(b[0] - p.x, 0, p.x - b[1]);
  const dy = Math.max(b[2] - p.y, 0, p.y - b[3]);
  const dz = Math.max(b[4] - p.z, 0, p.z - b[5]);
  return Math.hypot(dx, dy, dz);
}

const _p = new THREE.Vector3();
/** Kedalaman tembus kapsul ke kotak (mm, ≤ 0 = tidak menyentuh). */
export function capsuleBoxDepth(c, b) {
  // saring cepat: kotak pembungkus kapsul
  if (
    Math.min(c.a.x, c.b.x) - c.r > b[1] ||
    Math.max(c.a.x, c.b.x) + c.r < b[0] ||
    Math.min(c.a.y, c.b.y) - c.r > b[3] ||
    Math.max(c.a.y, c.b.y) + c.r < b[2] ||
    Math.min(c.a.z, c.b.z) - c.r > b[5] ||
    Math.max(c.a.z, c.b.z) + c.r < b[4]
  )
    return 0;
  const n = Math.max(1, Math.ceil(c.a.distanceTo(c.b) / 2));
  let best = Infinity;
  for (let i = 0; i <= n; i++) {
    _p.lerpVectors(c.a, c.b, i / n);
    best = Math.min(best, pointBox(_p, b));
    if (best === 0) break;
  }
  // titik di dalam kotak: kedalaman = jari-jari + jarak ke muka terdekat (kotak tipis → cukup r)
  return c.r - best;
}

/** Jarak terdekat dua ruas garis (Ericson, Real-Time Collision Detection §5.1.9). */
export function segmentDistance(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s;
  let t;
  if (a <= 1e-9 && e <= 1e-9) return p1.distanceTo(p2);
  if (a <= 1e-9) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= 1e-9) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1.dot(d2);
      const den = a * e - b * b;
      s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s);
  const c2 = p2.clone().addScaledVector(d2, t);
  return c1.distanceTo(c2);
}

/** Pasangan bagian yang dekat di rakitan (≤ 2 sambungan) → tidak dicek. */
function nearPairs(design) {
  const adj = new Map(design.parts.map((p) => [p.id, new Set()]));
  for (const p of design.parts)
    if (p.parent != null && adj.has(p.parent)) {
      adj.get(p.id).add(p.parent);
      adj.get(p.parent).add(p.id);
    }
  const near = new Set();
  for (const [id, n1] of adj) {
    for (const j of n1) {
      near.add(id + ':' + j);
      for (const k of adj.get(j)) if (k !== id) near.add(id + ':' + k);
    }
  }
  return near;
}

/**
 * @returns {{hits: Array<{pid: number, other: number|null, what: string, depth: number}>, parts: Set<number>}}
 */
export function collisions(design, fr = frames(design)) {
  const caps = worldCapsules(design, fr);
  const hits = [];
  const parts = new Set();
  const boxes = OBSTACLES.map((o) => ({ ...o, mm: o.b.map((v) => v * 10) }));
  const types = new Map(design.parts.map((p) => [p.id, p.type]));
  for (const [id, list] of caps) {
    const bulk = types.get(id) === 'bulkhead';
    for (const o of boxes) {
      if (bulk && o.glass) continue; // bulkhead memang menembus kaca
      let depth = 0;
      for (const c of list) depth = Math.max(depth, capsuleBoxDepth(c, o.mm));
      if (depth > TOL) {
        hits.push({ pid: id, other: null, what: o.name, depth });
        parts.add(id);
      }
    }
  }
  const near = nearPairs(design);
  const ids = [...caps.keys()];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      if (near.has(a + ':' + b)) continue;
      let depth = 0;
      for (const ca of caps.get(a))
        for (const cb of caps.get(b)) {
          const lim = ca.r + cb.r;
          // saring cepat dengan jarak titik tengah
          const reach = lim + ca.a.distanceTo(ca.b) / 2 + cb.a.distanceTo(cb.b) / 2;
          if (_p.addVectors(ca.a, ca.b).multiplyScalar(0.5).distanceTo(cb.a.clone().add(cb.b).multiplyScalar(0.5)) > reach) continue;
          depth = Math.max(depth, lim - segmentDistance(ca.a, ca.b, cb.a, cb.b));
        }
      if (depth > TOL) {
        hits.push({ pid: a, other: b, what: 'bagian lain', depth });
        parts.add(a);
        parts.add(b);
      }
    }
  hits.sort((x, y) => y.depth - x.depth);
  return { hits, parts };
}

/** Titik tabrak sinar (cm) dengan penghalang: untuk alat ukur ke kaca/meja. */
export function rayObstacle(ray) {
  let best = null;
  const box = new THREE.Box3();
  const hit = new THREE.Vector3();
  for (const o of OBSTACLES) {
    box.min.set(o.b[0], o.b[2], o.b[4]);
    box.max.set(o.b[1], o.b[3], o.b[5]);
    if (ray.intersectBox(box, hit)) {
      const d = hit.distanceTo(ray.origin);
      if (!best || d < best.d) best = { d, p: hit.clone(), name: o.name };
    }
  }
  return best;
}
