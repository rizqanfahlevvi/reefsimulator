/**
 * Kaca tank dan back filter, sekat, tepi potong kaca, silikon hitam, dan panel latar.
 *
 * Tepi kaca tidak digambar sebagai garis rangka (kesan gambar teknik yang kaku). Bentuk kaca
 * terbaca dari: tepi atas yang dipoles membulat dan berpendar hijau, muka potong di sudut dan
 * alas, sambungan silikon, serta warna kaca yang menguat sendiri saat dilihat miring.
 */
import * as THREE from 'three';
import { StaticBatch, boxGeo, pencilEdgeGeo } from '../geom.js';

const GLASS_ORDER = 8;
const EDGE_ORDER = 9;
/** Tebal lapisan muka potong (cm): sedikit di luar permukaan kaca supaya tidak berkedip (z-fighting). */
const E = 0.014;
/** Tinggi lengkung tepi atas yang dipoles (cm). */
const DOME = 0.09;

export function buildTank(scene, M) {
  const b = new StaticBatch();
  const glass = (x0, x1, y0, y1, z0, z1, mat = M.glass) => b.add(boxGeo(x0, x1, y0, y1, z0, z1), mat, { order: GLASS_ORDER });
  const edge = (g) => b.add(g, M.gEdge, { order: EDGE_ORDER });
  /** Tepi atas dipoles di y. */
  const top = (x0, x1, z0, z1, y, h = DOME) => edge(pencilEdgeGeo(x0, x1, z0, z1, y, h));
  /** Muka potong tegak di ujung lembar depan/belakang (menghadap ±x). */
  const ends = (z0, z1, y0 = 0, y1 = 30) => {
    edge(boxGeo(-E, 0, y0, y1, z0, z1));
    edge(boxGeo(50, 50 + E, y0, y1, z0, z1));
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

  /* tepi atas dipoles + muka potong di sudut */
  for (const [z0, z1] of [
    [24.5, 25],
    [0, 0.5],
    [-13, -12.5],
    [-2.5, -2],
  ]) {
    top(0, 50, z0, z1, 30);
    ends(z0, z1);
  }
  for (const [z0, z1] of [
    [0.5, 24.5],
    [-12.5, -2.5],
  ]) {
    top(0, 0.5, z0, z1, 30);
    top(49.5, 50, z0, z1, 30);
  }
  /* muka potong alas kaca (garis dasar tank & filter) */
  edge(boxGeo(0, 50, -0.5, 0, 25, 25 + E));
  edge(boxGeo(0, 50, -0.5, 0, -13 - E, -13));
  for (const [z0, z1] of [
    [0, 25],
    [-13, -2],
  ])
    ends(z0, z1, -0.5, 0);

  /* sekat: tepi atas dipoles, tepi bawah (sekat bercelah), silikon tipis ke kaca depan/belakang filter */
  for (const [x, topY, bottom] of [
    [10.5, 30, 3],
    [21, 22.5, 0],
    [36.5, 30, 3],
    [39, 20, 0],
  ]) {
    top(x, x + 0.5, -12.5, -2.5, topY, 0.07);
    if (bottom > 0) edge(boxGeo(x, x + 0.5, bottom - E, bottom, -12.5, -2.5));
    for (const z of [-12.5, -2.68]) b.add(boxGeo(x - 0.08, x + 0.58, bottom, topY, z, z + 0.18), M.sil);
  }
  /* silikon hitam di sudut dalam dan sepanjang alas */
  const S = 0.2;
  for (const [x, z] of [
    [0.5, 0.5],
    [49.5 - S, 0.5],
    [0.5, 24.5 - S],
    [49.5 - S, 24.5 - S],
    [0.5, -12.5],
    [49.5 - S, -12.5],
    [0.5, -2.5 - S],
    [49.5 - S, -2.5 - S],
  ])
    b.add(boxGeo(x, x + S, 0, 30, z, z + S), M.sil);
  b.add(boxGeo(0.5, 49.5, 0, 0.16, 0.5, 0.5 + S), M.sil);
  b.add(boxGeo(0.5, 49.5, 0, 0.16, 24.5 - S, 24.5), M.sil);
  b.add(boxGeo(0.5, 0.5 + S, 0, 0.16, 0.5, 24.5), M.sil);
  b.add(boxGeo(49.5 - S, 49.5, 0, 0.16, 0.5, 24.5), M.sil);
  b.add(boxGeo(0.5, 49.5, 0, 0.16, -12.5, -12.5 + S), M.sil);
  b.add(boxGeo(0.5, 49.5, 0, 0.16, -2.5 - S, -2.5), M.sil);
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
