/**
 * Volume air tiap chamber, permukaan tank beriak, dan lembar terjunan di sekat.
 *
 * Riak permukaan dihitung di vertex shader (posisi + normal analitik), bukan di CPU
 * dengan computeVertexNormals tiap frame seperti versi 1.
 */
import * as THREE from 'three';
import { uniforms } from '../materials.js';

function waterBox(scene, M, x0, x1, z0, z1, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 1, z1 - z0), mat);
  m.userData = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
  m.renderOrder = 2;
  scene.add(m);
  const pts = [new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z0), new THREE.Vector3(x1, 0, z1), new THREE.Vector3(x0, 0, z1)];
  const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), M.wl);
  l.renderOrder = 7;
  scene.add(l);
  m.userData.l = l;
  return m;
}

/** Atur tinggi kolom air dari y0 sampai h. */
export function setWaterHeight(m, h, y0 = 0) {
  const hh = Math.max(0.01, h - y0);
  m.scale.y = hh;
  m.position.set(m.userData.x, y0 + hh / 2, m.userData.z);
  m.userData.l.position.y = y0 + hh;
}

const WAVE_GLSL = /* glsl */ `
uniform float uT;
uniform float uAmp;
uniform float uJet;
float waveH(vec2 p, out vec2 grad) {
  float a = p.x * 0.55 + uT * 2.3;
  float b = p.y * 0.8 - uT * 1.8 + p.x * 0.21;
  vec2 d = p - vec2(16.0, -9.0);
  float r = max(length(d), 1e-3);
  float c = r * 1.3 - uT * 7.0;
  float e = exp(-r / 9.0);
  float h = uAmp * 0.5 * (sin(a) + sin(b)) + uJet * sin(c) * e;
  float dr = uJet * e * (1.3 * cos(c) - sin(c) / 9.0);
  grad = vec2(uAmp * 0.5 * (0.55 * cos(a) + 0.21 * cos(b)), uAmp * 0.5 * 0.8 * cos(b)) + dr * d / r;
  return h;
}`;

function surfaceMaterial(M) {
  const mat = M.surf.clone();
  mat.userData.uAmp = { value: 0.03 };
  mat.userData.uJet = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = uniforms.uT;
    sh.uniforms.uAmp = mat.userData.uAmp;
    sh.uniforms.uJet = mat.userData.uJet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + WAVE_GLSL)
      .replace(
        '#include <beginnormal_vertex>',
        // geometri bidang sudah diputar ke XZ: posisi lokal (x, z)
        'vec2 wGrad; float wH = waveH(position.xz, wGrad);\nvec3 objectNormal = normalize(vec3(-wGrad.x, 1.0, -wGrad.y));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += wH;');
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      'diffuseColor.a = clamp( diffuseColor.a + dot( reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0, 1.0 );\n#include <opaque_fragment>',
    );
  };
  mat.customProgramCacheKey = () => 'surface-wave';
  return mat;
}

export function buildWater(scene, M) {
  const w = {
    T: waterBox(scene, M, 0.5, 49.5, 0.5, 24.5, M.water),
    c1: waterBox(scene, M, 0.5, 10.5, -12.5, -2.5, M.waterF),
    c2: waterBox(scene, M, 11, 21, -12.5, -2.5, M.waterF),
    c3: waterBox(scene, M, 21.5, 36.5, -12.5, -2.5, M.waterF),
    cR: waterBox(scene, M, 37, 39, -12.5, -2.5, M.waterF),
    cP: waterBox(scene, M, 39.5, 49.5, -12.5, -2.5, M.waterP),
    B: waterBox(scene, M, 1.3, 8.7, 0.6, 6.2, M.waterF),
  };
  const sg = new THREE.PlaneGeometry(49, 24, 96, 48);
  sg.rotateX(-Math.PI / 2);
  const surfMat = surfaceMaterial(M);
  const surf = new THREE.Mesh(sg, surfMat);
  surf.position.set(25, 27, 12.5);
  surf.renderOrder = 3;
  scene.add(surf);

  const sheet = (ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), M.sheet);
    m.renderOrder = 4;
    m.visible = false;
    if (ry) m.rotation.y = ry;
    scene.add(m);
    return m;
  };
  const sheets = { s2: sheet(Math.PI / 2), s4: sheet(Math.PI / 2), box: sheet(), spill: sheet(), spill2: sheet() };
  return { boxes: w, surf, surfMat, sheets };
}
