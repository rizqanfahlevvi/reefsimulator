/** Pasir, batu hidup, dan karang (geometri prosedural, digabung per material). */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { StaticBatch, boxGeo, cylGeo } from '../geom.js';
import { fbm, ridged, createRng } from '../../util/random.js';
import { ROCKS } from '../../layout.js';

export function buildSand(scene, M) {
  const sandG = new THREE.Group();
  scene.add(sandG);
  const b = new StaticBatch();
  b.add(boxGeo(0.5, 49.5, 0, 1.0, 0.5, 24.5), M.sand, { cast: true });
  // permukaan pasir bergelombang, landai ke kaca
  const g = new THREE.PlaneGeometry(49, 24, 64, 32);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const X = p.getX(i);
    const Z = p.getZ(i);
    const e = Math.min(1, Math.min(24.5 - Math.abs(X), 12 - Math.abs(Z)) / 2);
    const ripple = 0.06 * Math.sin(X * 1.7 + Math.sin(Z * 0.6) * 2) * e;
    p.setY(i, 1.15 + 0.9 * e * fbm(X * 0.11 + 3, 0.5, Z * 0.11 + 7) + ripple);
  }
  g.computeVertexNormals();
  g.translate(25, 0, 12.5);
  b.add(g, M.sand, { recv: true });
  b.build(sandG);
  return sandG;
}

/**
 * Batu hidup: icosphere (tanpa jahitan kutub) yang di-displace fBm + ridged noise
 * untuk pori-pori, diwarnai per-vertex (batu kapur, coralline ungu/merah muda, alga hijau).
 * Ketujuh batu digabung jadi satu mesh.
 */
export function buildRocks(scene, M) {
  const rockG = new THREE.Group();
  scene.add(rockG);
  const c1 = new THREE.Color(0x8f867a);
  const c2 = new THREE.Color(0x8656a6);
  const c3 = new THREE.Color(0xb9668c);
  const c4 = new THREE.Color(0x5c7c4a);
  const t = new THREE.Color();
  const b = new StaticBatch();
  for (const [cx, cy, cz, rx, ry, rz, sd] of ROCKS) {
    let g = new THREE.IcosahedronGeometry(1, 14); // 4.500 segitiga
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g, 1e-5);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const X = p.getX(i);
      const Y = p.getY(i);
      const Z = p.getZ(i);
      const n = fbm(X * 1.5 + sd, Y * 1.5 + sd * 2, Z * 1.5 - sd);
      const n2 = fbm(X * 4.2 + sd * 3, Y * 4.2, Z * 4.2 + sd);
      const pore = ridged(X * 7 + sd, Y * 7 - sd, Z * 7 + sd * 0.5);
      const k = 0.66 + 0.62 * n + 0.16 * n2 - 0.1 * Math.max(0, Math.sin(n2 * 21)) - 0.06 * pore;
      p.setXYZ(i, X * k * rx, Y * k * ry, Z * k * rz);
      const m = fbm(X * 2.4 - sd, Y * 2.4 + sd, Z * 2.4 + sd * 2);
      t.copy(c1);
      if (m > 0.5) t.lerp(c2, Math.min(1, (m - 0.5) * 5));
      if (n2 > 0.56) t.lerp(c3, Math.min(1, (n2 - 0.56) * 5));
      if (Y > 0.45 && m < 0.43) t.lerp(c4, 0.55);
      t.multiplyScalar((0.7 + 0.6 * n2) * (1 - 0.35 * pore)); // pori lebih gelap
      col[i * 3] = t.r;
      col[i * 3 + 1] = t.g;
      col[i * 3 + 2] = t.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.translate(cx, cy, cz);
    b.add(g, M.rock, { cast: true, recv: true });
  }
  b.build(rockG);
  return rockG;
}

/** Karang: bercabang (SPS), mushroom, dan toadstool. Material berbagi per warna. */
export function buildCorals(scene) {
  const coralG = new THREE.Group();
  scene.add(coralG);
  const rnd = createRng(1234);
  const mats = new Map();
  const coralMat = (hex) => {
    if (!mats.has(hex)) {
      mats.set(hex, new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.22, roughness: 0.55 }));
    }
    return mats.get(hex);
  };
  const b = new StaticBatch();

  // karang bercabang: hierarki sementara lalu dipanggang ke satu geometri
  const tmpRoot = new THREE.Group();
  function branch(parent, len, r, depth) {
    const g = new THREE.CylinderGeometry(r * 0.6, r, len, 8, 3);
    g.translate(0, len / 2, 0);
    const node = new THREE.Mesh(g);
    parent.add(node);
    // sendi halus di pangkal cabang
    const joint = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6));
    node.add(joint);
    if (depth > 0) {
      const n = 2 + (rnd() > 0.45 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const c = branch(node, len * 0.72, r * 0.62, depth - 1);
        c.position.y = len * (0.5 + rnd() * 0.45);
        c.rotation.set(0, rnd() * 6.28, (0.45 + rnd() * 0.5) * (rnd() > 0.5 ? 1 : -1));
      }
    } else {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.75, 10, 8));
      tip.position.y = len;
      node.add(tip);
    }
    return node;
  }
  const bake = (root, mat) => {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (o.isMesh) b.add(o.geometry.clone().applyMatrix4(o.matrixWorld), mat);
    });
    root.traverse((o) => o.geometry && o.geometry.dispose());
  };
  for (const [len, r, depth, hex, pos, rz] of [
    [2.6, 0.42, 3, 0x9a6fe0, [26.5, 15.2, 12.5], 0],
    [2.2, 0.38, 3, 0x58d8a8, [16.5, 9.4, 13.5], 0.25],
    [1.8, 0.32, 2, 0xff7fa8, [35.5, 8.2, 14.5], -0.3],
  ]) {
    const root = new THREE.Group();
    tmpRoot.add(root);
    const a = branch(root, len, r, depth);
    a.position.set(...pos);
    a.rotation.z = rz;
    bake(root, coralMat(hex));
  }

  // mushroom: tangkai + kubah lathe dengan bibir sedikit menggulung
  const domeProfile = (r) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = r * Math.sin(t * Math.PI * 0.5);
      const y = 0.32 * Math.cos(t * Math.PI * 0.5) - (t > 0.85 ? (t - 0.85) * 0.8 : 0);
      pts.push(new THREE.Vector2(Math.max(0.001, x), y));
    }
    return pts;
  };
  const mush = (x, y, z, r, hex, tilt) => {
    const m = coralMat(hex);
    b.add(cylGeo([x, y - 0.8, z], [x, y, z], r * 0.3, 12), m);
    const d = new THREE.LatheGeometry(domeProfile(r), 24);
    d.rotateZ(tilt || 0);
    d.translate(x, y + 0.05, z);
    b.add(d, m);
  };
  mush(21, 6.4, 19.5, 1.3, 0x3fd0c0, 0.2);
  mush(23.4, 5.8, 20.4, 1.0, 0x3fd0c0, -0.3);
  mush(30.5, 5.8, 19.5, 1.2, 0xff8a3c, 0.15);
  mush(39.8, 5.8, 10.8, 1.1, 0xd060e8, -0.2);
  mush(32, 11.4, 13.5, 1.2, 0xa8e05a, 0.5);
  mush(21.5, 10.2, 11.2, 1.0, 0xff5a78, -0.5);

  // toadstool leather
  {
    const m = coralMat(0xe8c8a0);
    b.add(cylGeo([13.5, 6.2, 16.5], [13.2, 9, 16.8], 0.8, 14, 1.1), m);
    const cap = new THREE.SphereGeometry(2.2, 24, 12);
    cap.scale(1, 0.32, 1);
    cap.translate(13.2, 9.2, 16.8);
    b.add(cap, m);
  }
  b.build(coralG);
  return { coralG, coralMats: [...mats.values()] };
}
