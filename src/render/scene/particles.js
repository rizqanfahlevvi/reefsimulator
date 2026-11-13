/** Partikel penanda aliran di sepanjang lintasan, gelembung skimmer, dan buih. */
import * as THREE from 'three';
import { createRng } from '../../util/random.js';

const rnd = createRng(4242);
let dotTex = null;
export const setDotTexture = (t) => {
  dotTex = t;
};

/** Sekumpulan titik (Points) dengan fase dan offset acak. */
export function makePoints(n, color, size, parent) {
  const g = new THREE.BufferGeometry();
  const a = new Float32Array(n * 3).fill(-999);
  g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  const p = new THREE.Points(
    g,
    new THREE.PointsMaterial({ color, size, map: dotTex, transparent: true, alphaTest: 0.25, depthWrite: false, sizeAttenuation: true }),
  );
  p.frustumCulled = false;
  p.renderOrder = 6;
  parent.add(p);
  return {
    p,
    a,
    g,
    n,
    ph: Float32Array.from({ length: n }, (_, i) => (i + rnd() * 0.6) / n),
    off: Array.from({ length: n }, () => [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]),
  };
}

export function makePath(pts) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  return { pts, L, len: L[L.length - 1] };
}

const tmp = [0, 0, 0];
function pathAt(pa, u) {
  const d = u * pa.len;
  let i = 1;
  while (i < pa.L.length - 1 && pa.L[i] < d) i++;
  const t = (d - pa.L[i - 1]) / (pa.L[i] - pa.L[i - 1] || 1);
  const a = pa.pts[i - 1];
  const b = pa.pts[i];
  tmp[0] = a[0] + (b[0] - a[0]) * t;
  tmp[1] = a[1] + (b[1] - a[1]) * t;
  tmp[2] = a[2] + (b[2] - a[2]) * t;
}

/** Gerakkan titik sepanjang lintasan dengan kecepatan (cm/s). */
export function movePoints(o, pa, speed, simdt, sx, sy, sz, hide) {
  const du = (speed * simdt) / pa.len;
  for (let i = 0; i < o.n; i++) {
    o.ph[i] = (((o.ph[i] + du) % 1) + 1) % 1;
    pathAt(pa, o.ph[i]);
    o.a[i * 3] = tmp[0] + o.off[i][0] * sx;
    o.a[i * 3 + 1] = hide ? -999 : tmp[1] + o.off[i][1] * sy;
    o.a[i * 3 + 2] = tmp[2] + o.off[i][2] * sz;
  }
  o.g.attributes.position.needsUpdate = true;
}

export function disposePoints(o) {
  o.p.parent?.remove(o.p);
  o.g.dispose();
  o.p.material.dispose();
}

/** Partikel tetap: return, filter, permukaan tank, gelembung skimmer, buih. */
export function buildFlowParticles(scene, returnPts, zout) {
  const fp = {};
  fp.ret = makePoints(14, 0xff8a00, 1.5, scene);
  fp.retPath = makePath(returnPts.concat([[41, zout + 0.2, 3.5]]));
  fp.fil = makePoints(46, 0x00e0bc, 1.4, scene);
  fp.filPath = makePath([
    [5, 22.6, -7.5],
    [5, 4, -7.5],
    [10.75, 1.6, -7.5],
    [16, 3, -7.5],
    [16, 22.4, -7.5],
    [21.25, 23.5, -7.5],
    [23.5, 20.2, -7.5],
    [29, 3.5, -7.5],
    [36.75, 1.6, -7.5],
    [38, 3.5, -7.5],
    [38, 20, -7.5],
    [39.25, 20.8, -7.5],
    [41.2, 17.2, -7.5],
    [44.5, 6, -7.5],
  ]);
  fp.tank = makePoints(34, 0xffffff, 1.2, scene);
  fp.tankPath = makePath([
    [41, 25.7, 3.5],
    [32, 26.4, 9],
    [18, 26.5, 10.5],
    [8, 26.2, 6.5],
    [5, 24.5, 3.5],
  ]);
  fp.bub = makePoints(60, 0xffffff, 0.8, scene);
  for (let i = 0; i < fp.bub.n; i++) fp.bub.ph[i] = rnd();
  fp.foam = makePoints(66, 0xffffff, 0.9, scene);
  fp.flowList = [fp.ret, fp.fil, fp.tank];
  return fp;
}

export function foamAt(foam, tt, i0, n, on, x0, x1, y, z0, z1) {
  for (let i = i0; i < i0 + n; i++) {
    const o = foam.off[i];
    const w = tt * (5 + o[1] * 4) + i;
    foam.a[i * 3] = x0 + (x1 - x0) * (0.5 + o[0]) + Math.sin(w) * 0.2;
    foam.a[i * 3 + 1] = on ? y + 0.15 + Math.abs(Math.sin(w * 1.7)) * 0.5 : -999;
    foam.a[i * 3 + 2] = z0 + (z1 - z0) * (0.5 + o[2]);
  }
}
