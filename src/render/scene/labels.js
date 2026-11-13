/** Label nama melayang (sprite, selalu di depan). */
import * as THREE from 'three';
import { canvasTexture } from '../textures.js';

export function buildLabels(scene) {
  const labels = [];
  const add = (txt, x, y, z) => {
    const t = canvasTexture(512, 128, (k) => {
      k.fillStyle = 'rgba(18,28,38,0.74)';
      k.beginPath();
      k.roundRect(4, 14, 504, 100, 18);
      k.fill();
      k.fillStyle = '#fff';
      k.font = '600 56px system-ui, sans-serif';
      k.textAlign = 'center';
      k.textBaseline = 'middle';
      k.fillText(txt, 256, 66);
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, toneMapped: false }));
    s.scale.set(10.4, 2.6, 1);
    s.position.set(x, y, z);
    s.renderOrder = 9;
    scene.add(s);
    labels.push(s);
  };
  add('Kapas', 5.5, 31.8, -13.8);
  add('Skimmer', 16, 40.6, -7.5);
  add('Bio', 29, 31.8, -13.8);
  add('Pompa', 44.5, 36.6, -11);
  add('ATO', 62, 17.5, -6); // indeks 4: hanya tampil bila ATO aktif
  return labels;
}
