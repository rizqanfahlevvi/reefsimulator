/**
 * Ikan badut sederhana: badan LatheGeometry (profil ikan, penampang elips),
 * sirip dari ShapeGeometry, ekor dan sirip dada beranimasi. Hanya visual.
 */
import * as THREE from 'three';

function bodyGeometry() {
  // profil (radius, posisi sepanjang badan); ekor di −1,75, moncong di +1,75
  const prof = [
    [0.18, -1.75],
    [0.24, -1.55],
    [0.38, -1.2],
    [0.62, -0.75],
    [0.84, -0.25],
    [0.95, 0.25],
    [0.9, 0.7],
    [0.72, 1.12],
    [0.48, 1.45],
    [0.22, 1.68],
    [0.001, 1.76],
  ];
  const curve = new THREE.SplineCurve(prof.map(([r, y]) => new THREE.Vector2(r, y)));
  const g = new THREE.LatheGeometry(curve.getPoints(28), 24);
  g.rotateZ(-Math.PI / 2); // sumbu badan → +x (kepala)
  g.scale(1, 1, 0.55); // pipih ke samping
  return g;
}

function finShape(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 2) {
    const c = points[i];
    const e = points[i + 1] || points[0];
    s.quadraticCurveTo(c[0], c[1], e[0], e[1]);
  }
  return new THREE.ShapeGeometry(s, 8);
}

export function buildFish(scene, M, tex) {
  const fishG = new THREE.Group();
  scene.add(fishG);
  const bodyGeo = bodyGeometry();
  const bodyMat = new THREE.MeshStandardMaterial({
    map: tex.fish,
    roughness: 0.45,
    emissive: 0xf57a1f,
    emissiveMap: tex.fish,
    emissiveIntensity: 0.35,
  });
  const finMat = new THREE.MeshStandardMaterial({
    color: 0xf57a1f,
    roughness: 0.6,
    emissive: 0xf57a1f,
    emissiveIntensity: 0.25,
    side: THREE.DoubleSide,
  });
  const tailGeo = finShape([
    [0, 0.2],
    [-0.6, 0.55],
    [-1.15, 0.72],
    [-0.95, 0],
    [-1.15, -0.72],
    [-0.6, -0.55],
    [0, -0.2],
  ]);
  const dorsalGeo = finShape([
    [-1.0, 0],
    [-0.75, 0.55],
    [-0.3, 0.42],
    [-0.05, 0.25],
    [0.25, 0.5],
    [0.75, 0.32],
    [0.85, 0],
  ]);
  const analGeo = finShape([
    [-1.1, 0],
    [-0.9, -0.42],
    [-0.45, -0.36],
    [-0.25, -0.15],
    [-0.2, 0],
  ]);
  const pectGeo = finShape([
    [0, 0.12],
    [-0.35, 0.25],
    [-0.55, 0.05],
    [-0.35, -0.18],
    [0, -0.1],
  ]);
  const eyeGeo = new THREE.SphereGeometry(0.15, 12, 8);
  const pupilGeo = new THREE.SphereGeometry(0.09, 10, 6);

  const fishes = [];
  function mkFish(sc, cx, cz, a, b, y, sp, ph) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(bodyGeo, bodyMat));
    const tp = new THREE.Group();
    tp.position.x = -1.62;
    g.add(tp);
    tp.add(new THREE.Mesh(tailGeo, finMat));
    const dorsal = new THREE.Mesh(dorsalGeo, finMat);
    dorsal.position.set(0, 0.78, 0);
    g.add(dorsal);
    const anal = new THREE.Mesh(analGeo, finMat);
    anal.position.set(0, -0.62, 0);
    g.add(anal);
    const pect = [];
    for (const s of [1, -1]) {
      const p = new THREE.Mesh(pectGeo, finMat);
      p.position.set(0.75, -0.18, 0.4 * s);
      p.rotation.y = s * 0.5;
      g.add(p);
      pect.push(p);
      const eye = new THREE.Mesh(eyeGeo, M.white);
      eye.position.set(1.2, 0.22, 0.34 * s);
      g.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, M.dark);
      pupil.position.set(1.27, 0.23, 0.42 * s);
      g.add(pupil);
    }
    g.scale.setScalar(sc);
    fishG.add(g);
    fishes.push({ g, tp, pect, cx, cz, a, b, y, sp, th: ph });
  }
  mkFish(1.25, 26, 13, 14.5, 5.2, 19.5, 0.33, 0.4);
  mkFish(1.0, 27, 12, 11, 4.2, 21.5, -0.27, 2.6);
  return { fishG, fishes, fishMats: [bodyMat, finMat] };
}

/** Animasi renang mengelilingi elips, ekor dan sirip dada mengepak. */
export function updateFish(fish, S, real, tt) {
  const { fishes } = fish;
  for (let i = 0; i < fishes.length; i++) {
    const F = fishes[i];
    F.th += real * F.sp;
    const cx = Math.cos(F.th);
    const sx = Math.sin(F.th);
    const sgn = F.sp > 0 ? 1 : -1;
    F.g.position.set(F.cx + F.a * cx, Math.max(3, Math.min(S.HT - 2, F.y + Math.sin(F.th * 2.3 + i) * 1.4)), F.cz + F.b * sx);
    F.g.rotation.y = Math.atan2(-F.b * cx * sgn, -F.a * sx * sgn);
    F.tp.rotation.y = Math.sin(tt * 9 + i * 2) * 0.5;
    const flap = Math.sin(tt * 6 + i) * 0.35;
    F.pect[0].rotation.y = 0.5 + flap;
    F.pect[1].rotation.y = -0.5 - flap;
  }
}
