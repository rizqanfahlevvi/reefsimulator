/**
 * Pembuat geometri + StaticBatch.
 *
 * Semua bagian statis (kaca, silikon, lemari, isi filter, dsb.) ditampung di StaticBatch
 * lalu digabung per material menjadi satu mesh → jumlah draw call turun drastis
 * (versi 1: ±350 draw call per frame).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** Kotak dari batas min/max (cm). */
export function boxGeo(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Silinder dari titik p0 ke p1 (radius r di p0, r2 di p1). */
export function cylGeo(p0, p1, r, seg = 16, r2 = r, open = false) {
  _a.set(p0[0], p0[1], p0[2]);
  _b.set(p1[0], p1[1], p1[2]);
  _d.subVectors(_b, _a);
  const len = _d.length() || 0.001;
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, open);
  _q.setFromUnitVectors(UP, _d.normalize());
  _m.compose(_a.clone().addScaledVector(_d, len * 0.5), _q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

export function sphereGeo(p, r, ws = 16, hs = 12) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  g.translate(p[0], p[1], p[2]);
  return g;
}

/** Pipa/selang melengkung melalui titik-titik (Catmull–Rom centripetal). */
export function tubeGeo(pts, r, radial = 12) {
  const c = new THREE.CatmullRomCurve3(
    pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    false,
    'centripetal',
  );
  return new THREE.TubeGeometry(c, Math.max(32, pts.length * 18), r, radial, false);
}

/** Siku 90° (seperempat torus). */
export function elbowGeo(x, cy, cz, R, r, front) {
  const g = new THREE.TorusGeometry(R, r, 12, 16, Math.PI / 2);
  g.rotateY(front ? -Math.PI / 2 : Math.PI / 2);
  g.translate(x, cy, cz);
  return g;
}

export function mesh(geo, mat, parent, opts = {}) {
  const m = new THREE.Mesh(geo, mat);
  if (opts.cast) m.castShadow = true;
  if (opts.recv) m.receiveShadow = true;
  if (opts.order !== undefined) m.renderOrder = opts.order;
  if (parent) parent.add(m);
  return m;
}

/** Menampung geometri statis lalu menggabungkannya per (material, bayangan, renderOrder). */
export class StaticBatch {
  constructor() {
    this.groups = new Map();
    this.lines = new Map();
  }

  add(geo, mat, opts = {}) {
    const key = `${mat.uuid}|${opts.cast ? 1 : 0}${opts.recv ? 1 : 0}|${opts.order ?? 0}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { mat, opts, geos: [] };
      this.groups.set(key, g);
    }
    g.geos.push(geo);
    return geo;
  }

  /** Tepi (garis) dari geometri kotak, digabung jadi satu LineSegments per material. */
  addEdges(geo, mat) {
    let arr = this.lines.get(mat.uuid);
    if (!arr) {
      arr = { mat, geos: [] };
      this.lines.set(mat.uuid, arr);
    }
    arr.geos.push(new THREE.EdgesGeometry(geo));
  }

  /** Bangun mesh gabungan ke parent. Mengembalikan daftar mesh. */
  build(parent) {
    const out = [];
    for (const { mat, opts, geos } of this.groups.values()) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(normalize(geos), false);
      if (!merged) throw new Error('StaticBatch: gagal menggabungkan geometri untuk ' + mat.type);
      merged.computeBoundingSphere();
      const m = mesh(merged, mat, parent, opts);
      out.push(m);
      if (geos.length > 1) for (const g of geos) g.dispose();
    }
    for (const { mat, geos } of this.lines.values()) {
      const merged = mergeGeometries(geos, false);
      const l = new THREE.LineSegments(merged, mat);
      parent.add(l);
      out.push(l);
      for (const g of geos) g.dispose();
    }
    this.groups.clear();
    this.lines.clear();
    return out;
  }
}

/** Pastikan semua geometri punya set atribut yang sama (index + position/normal/uv). */
function normalize(geos) {
  const needColor = geos.some((g) => g.attributes.color);
  return geos.map((g) => {
    if (!g.index) {
      const idx = new Uint32Array(g.attributes.position.count);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (needColor && !g.attributes.color) {
      const c = new Float32Array(g.attributes.position.count * 3).fill(1);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    }
    return g;
  });
}
