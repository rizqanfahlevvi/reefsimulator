/** Ruangan, lemari kayu, lampu LED gantung, dan genangan saat air tumpah. */
import * as THREE from 'three';
import { StaticBatch, boxGeo, cylGeo } from '../geom.js';

export function buildRoom(scene, M) {
  const roomG = new THREE.Group();
  const lampG = new THREE.Group();
  scene.add(roomG, lampG);

  const b = new StaticBatch();
  const floor = new THREE.PlaneGeometry(460, 340);
  floor.rotateX(-Math.PI / 2);
  floor.translate(25, -62, 60);
  b.add(floor, M.floor, { recv: true });
  const wall = new THREE.PlaneGeometry(460, 240);
  wall.translate(25, 58, -24);
  b.add(wall, M.wall, { recv: true });
  // meja dan lemari
  b.add(boxGeo(-6, 72, -2.5, -0.5, -18, 29), M.wood, { cast: true, recv: true });
  b.add(boxGeo(-4, 70, -62, -2.5, -16, 27), M.woodD, { cast: true, recv: true });
  b.add(boxGeo(32.8, 33.2, -60, -5, 27, 27.12), M.dark);
  b.add(boxGeo(-2.5, 68.5, -60.2, -59.8, 27, 27.12), M.dark);
  b.add(boxGeo(-2.5, 68.5, -5.2, -4.8, 27, 27.12), M.dark);
  b.add(cylGeo([30.5, -28, 27.4], [30.5, -36, 27.4], 0.5), M.metal);
  b.add(cylGeo([35.5, -28, 27.4], [35.5, -36, 27.4], 0.5), M.metal);
  b.build(roomG);

  // lampu LED dengan kaki penjepit di kedua sisi
  const lb = new StaticBatch();
  lb.add(boxGeo(5, 45, 43, 44.5, 9.5, 15.5), M.dark, { cast: true });
  const strip = new THREE.PlaneGeometry(38, 4.4);
  strip.rotateX(Math.PI / 2);
  strip.translate(25, 42.97, 12.5);
  lb.add(strip, M.led);
  for (const x of [0.25, 49.75]) {
    const inner = x < 25 ? 5.2 : 44.8;
    lb.add(boxGeo(x - 0.15, x + 0.15, 28.5, 43.9, 12, 13), M.metal);
    lb.add(boxGeo(Math.min(x, inner), Math.max(x, inner), 43.6, 43.9, 12, 13), M.metal);
    lb.add(boxGeo(x - 0.5, x + 0.5, 28.2, 30.3, 11.6, 13.4), M.dark);
  }
  lb.build(lampG);

  const wetTop = new THREE.Mesh(new THREE.PlaneGeometry(56, 3.9), M.puddle);
  wetTop.rotation.x = -Math.PI / 2;
  wetTop.position.set(25, -0.44, 27);
  wetTop.visible = false;
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 48), M.puddle);
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(25, -61.9, 44);
  puddle.visible = false;
  scene.add(wetTop, puddle);

  return { roomG, lampG, wetTop, puddle };
}
