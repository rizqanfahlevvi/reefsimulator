/** Kaca tank dan back filter, sekat, tepi potong kaca, silikon hitam, dan panel latar. */
import * as THREE from 'three';
import { StaticBatch, boxGeo } from '../geom.js';

const GLASS_ORDER = 8;

export function buildTank(scene, M) {
  const b = new StaticBatch();
  const glass = (x0, x1, y0, y1, z0, z1, mat = M.glass) => {
    const g = boxGeo(x0, x1, y0, y1, z0, z1);
    b.addEdges(g, M.edge);
    b.add(g, mat, { order: GLASS_ORDER });
  };
  // tank 50×25×30
  glass(0, 50, -0.5, 0, 0, 25);
  glass(0, 50, 0, 30, 24.5, 25);
  glass(0, 50, 0, 30, 0, 0.5);
  glass(0, 0.5, 0, 30, 0.5, 24.5);
  glass(49.5, 50, 0, 30, 0.5, 24.5);
  // back filter 50×11×30
  glass(0, 50, -0.5, 0, -13, -2);
  glass(0, 50, 0, 30, -13, -12.5);
  glass(0, 50, 0, 30, -2.5, -2);
  glass(0, 0.5, 0, 30, -12.5, -2.5);
  glass(49.5, 50, 0, 30, -12.5, -2.5);
  // sekat 1–4
  glass(10.5, 11, 3, 30, -12.5, -2.5, M.baffle);
  glass(21, 21.5, 0, 22.5, -12.5, -2.5, M.baffle);
  glass(36.5, 37, 3, 30, -12.5, -2.5, M.baffle);
  glass(39, 39.5, 0, 20, -12.5, -2.5, M.baffle);

  /* tepi potong kaca (kehijauan) dan silikon hitam di sambungan */
  const cap = (x0, x1, z0, z1, y) => b.add(boxGeo(x0, x1, y, y + 0.16, z0, z1), M.gEdge);
  cap(0, 50, 24.5, 25, 30);
  cap(0, 50, 0, 0.5, 30);
  cap(0, 0.5, 0.5, 24.5, 30);
  cap(49.5, 50, 0.5, 24.5, 30);
  cap(0, 50, -13, -12.5, 30);
  cap(0, 50, -2.5, -2, 30);
  cap(0, 0.5, -12.5, -2.5, 30);
  cap(49.5, 50, -12.5, -2.5, 30);
  for (const [x, top, bottom] of [
    [10.5, 30, 3],
    [21, 22.5, 0],
    [36.5, 30, 3],
    [39, 20, 0],
  ]) {
    cap(x, x + 0.5, -12.5, -2.5, top < 30 ? top : 30);
    if (bottom > 0) b.add(boxGeo(x, x + 0.5, bottom - 0.16, bottom, -12.5, -2.5), M.gEdge);
    for (const z of [-12.5, -2.75]) b.add(boxGeo(x - 0.12, x + 0.62, bottom, top, z, z + 0.25), M.sil);
  }
  for (const [x, z] of [
    [0.5, 0.5],
    [49.25, 0.5],
    [0.5, 24.25],
    [49.25, 24.25],
    [0.5, -12.5],
    [49.25, -12.5],
    [0.5, -2.75],
    [49.25, -2.75],
  ])
    b.add(boxGeo(x, x + 0.25, 0, 30, z, z + 0.25), M.sil);
  b.add(boxGeo(0.5, 49.5, 0, 0.2, 0.5, 0.72), M.sil);
  b.add(boxGeo(0.5, 49.5, 0, 0.2, 24.28, 24.5), M.sil);
  b.add(boxGeo(0.5, 0.72, 0, 0.2, 0.5, 24.5), M.sil);
  b.add(boxGeo(49.28, 49.5, 0, 0.2, 0.5, 24.5), M.sil);
  b.add(boxGeo(0.5, 49.5, 0, 0.2, -12.5, -12.28), M.sil);
  b.add(boxGeo(0.5, 49.5, 0, 0.2, -2.72, -2.5), M.sil);
  b.build(scene);

  // panel latar belakang tank (warna bisa diganti)
  const bgMat = new THREE.MeshStandardMaterial({ color: 0x0d0f12, roughness: 0.95, metalness: 0 });
  const bgPanel = new THREE.Mesh(new THREE.PlaneGeometry(49.6, 29.8), bgMat);
  bgPanel.position.set(25, 15, -0.04);
  bgPanel.receiveShadow = true;
  scene.add(bgPanel);
  return { bgPanel, bgMat };
}

const BG = {
  black: [0x0d0f12, 0.95],
  white: [0xe9ecec, 0.95],
  gwhite: [0xf6f8f8, 0.12],
  marine: [0x0b3d73, 0.6],
};

export function applyBackground(tank, look) {
  const { bgPanel, bgMat } = tank;
  const b = look.bg;
  bgPanel.visible = b !== 'none';
  if (b === 'custom') {
    bgMat.color.set(look.bgc);
    bgMat.roughness = 0.6;
  } else if (BG[b]) {
    bgMat.color.set(BG[b][0]);
    bgMat.roughness = BG[b][1];
  }
  bgMat.envMapIntensity = b === 'gwhite' ? 1.4 : 0.6;
}
