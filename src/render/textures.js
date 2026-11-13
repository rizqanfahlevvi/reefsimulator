/** Tekstur prosedural (canvas 2D → CanvasTexture sRGB). */
import * as THREE from 'three';
import { createRng } from '../util/random.js';

export function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const k = c.getContext('2d');
  if (k) draw(k, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 8;
  return t;
}

export function createTextures() {
  const rnd = createRng(11);
  const wood = canvasTexture(
    512,
    256,
    (k, w, h) => {
      k.fillStyle = '#7a573a';
      k.fillRect(0, 0, w, h);
      for (let i = 0; i < 360; i++) {
        const y = rnd() * h;
        k.strokeStyle = `rgba(${(40 + rnd() * 70) | 0},${(24 + rnd() * 36) | 0},${(12 + rnd() * 20) | 0},${0.08 + rnd() * 0.22})`;
        k.lineWidth = 0.5 + rnd() * 2.2;
        k.beginPath();
        k.moveTo(0, y);
        k.bezierCurveTo(w * 0.3, y + rnd() * 8 - 4, w * 0.6, y + rnd() * 8 - 4, w, y + rnd() * 6 - 3);
        k.stroke();
      }
    },
    [2, 1],
  );
  const sand = canvasTexture(
    256,
    256,
    (k, w, h) => {
      k.fillStyle = '#ebe1cc';
      k.fillRect(0, 0, w, h);
      for (let i = 0; i < 11000; i++) {
        k.fillStyle = rnd() < 0.5 ? `rgba(120,104,84,${0.12 + rnd() * 0.3})` : `rgba(255,255,250,${0.3 + rnd() * 0.5})`;
        k.fillRect(rnd() * w, rnd() * h, 1 + rnd(), 1 + rnd());
      }
    },
    [7, 3.5],
  );
  // ikan badut: oranye dengan tiga pita putih bertepi hitam.
  // Badan dibuat LatheGeometry → v = sepanjang badan (0 = ekor, 1 = kepala); canvas atas = v 1.
  const fish = canvasTexture(64, 256, (k, w, h) => {
    k.fillStyle = '#f57a1f';
    k.fillRect(0, 0, w, h);
    const band = (v, wd) => {
      const y = (1 - v) * h;
      k.fillStyle = '#141414';
      k.fillRect(0, y - (wd / 2 + 0.016) * h, w, (wd + 0.032) * h);
      k.fillStyle = '#ffffff';
      k.fillRect(0, y - (wd / 2) * h, w, wd * h);
    };
    band(0.74, 0.09); // kepala
    band(0.47, 0.1); // badan
    band(0.15, 0.06); // pangkal ekor
  });
  const dot = canvasTexture(32, 32, (k) => {
    const gr = k.createRadialGradient(16, 16, 2, 16, 16, 15);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.95)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    k.fillStyle = gr;
    k.fillRect(0, 0, 32, 32);
  });
  return { wood, sand, fish, dot, rnd };
}
