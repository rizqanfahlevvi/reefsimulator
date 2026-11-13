/**
 * Jejak partikel 3D berwarna dari medan arus CFD (titik + ekor).
 * Tank: 340 jejak, filter: 230 jejak — keduanya mengikuti medan arus 3D.
 */
import * as THREE from 'three';
import { speedColor } from '../../cfd/palette.js';

const NT = 340;
const NF = 230;
const NA = NT + NF;

export function buildTracers(scene) {
  const trG = new THREE.Group();
  scene.add(trG);
  const P = new Float32Array(NA * 3);
  const C = new Float32Array(NA * 3);
  const A = new Float32Array(NA);
  const SZ = new Float32Array(NA);
  const L = new Float32Array(NA * 6);
  const LC = new Float32Array(NA * 6);
  const LA = new Float32Array(NA * 2);
  const life = new Float32Array(NA);
  const age = new Float32Array(NA);
  for (let i = 0; i < NA; i++) {
    SZ[i] = i < NT ? 1.5 : 1.8;
    P[i * 3 + 1] = -999;
    life[i] = Math.random() * 3;
  }
  const pointMat = new THREE.ShaderMaterial({
    uniforms: { uS: { value: 300 } },
    transparent: true,
    depthWrite: false,
    vertexShader:
      'attribute vec3 aCol; attribute float aAl; attribute float aSz; uniform float uS; varying vec4 vC; void main(){ vC = vec4(aCol, aAl); vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = max(2.0, aSz * uS / -mv.z); gl_Position = projectionMatrix * mv; }',
    fragmentShader:
      'varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard; gl_FragColor = vec4(vC.rgb, vC.a * smoothstep(0.25, 0.09, r)); }',
  });
  const lineMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader:
      'attribute vec3 aCol; attribute float aAl; varying vec4 vC; void main(){ vC = vec4(aCol, aAl); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec4 vC; void main(){ gl_FragColor = vC; }',
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aCol', new THREE.BufferAttribute(C, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aAl', new THREE.BufferAttribute(A, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSz', new THREE.BufferAttribute(SZ, 1));
  const pts = new THREE.Points(g, pointMat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  trG.add(pts);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(L, 3).setUsage(THREE.DynamicDrawUsage));
  lg.setAttribute('aCol', new THREE.BufferAttribute(LC, 3).setUsage(THREE.DynamicDrawUsage));
  lg.setAttribute('aAl', new THREE.BufferAttribute(LA, 1).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(lg, lineMat);
  lines.frustumCulled = false;
  lines.renderOrder = 6;
  trG.add(lines);

  const V = [0, 0, 0];
  const K = [0, 0, 0];

  function spawn(i, flow, HT) {
    age[i] = 0;
    if (i < NT) {
      for (let t = 0; t < 10; t++) {
        const x = 0.8 + Math.random() * 48.4;
        const y = 0.4 + Math.random() * (HT - 0.6);
        const z = 0.8 + Math.random() * 23.4;
        if (flow.cellOf(x, y, z) >= 0) {
          P[i * 3] = x;
          P[i * 3 + 1] = y;
          P[i * 3 + 2] = z;
          life[i] = 5 + Math.random() * 11;
          return;
        }
      }
    } else {
      for (let t = 0; t < 10; t++) {
        const x = 0.7 + Math.random() * 48.6;
        const y = 0.2 + Math.random() * 24;
        const z = -12.3 + Math.random() * 9.6;
        if (flow.cellF(x, y, z) >= 0) {
          P[i * 3] = x;
          P[i * 3 + 1] = y;
          P[i * 3 + 2] = z;
          life[i] = 6 + Math.random() * 12;
          return;
        }
      }
    }
    P[i * 3 + 1] = -999;
    life[i] = 0.5 + Math.random();
  }

  function update(dt, flow, HT) {
    for (let i = 0; i < NA; i++) {
      const q = i * 3;
      const tank = i < NT;
      life[i] -= dt;
      age[i] += dt;
      if (life[i] <= 0 || P[q + 1] < -900 || (tank ? flow.cellOf(P[q], P[q + 1], P[q + 2]) : flow.cellF(P[q], P[q + 1], P[q + 2])) < 0) spawn(i, flow, HT);
      let s;
      if (tank) {
        flow.sample3(P[q], P[q + 1], P[q + 2], V);
        s = Math.hypot(V[0], V[1], V[2]);
        P[q] += V[0] * dt;
        P[q + 1] += V[1] * dt;
        P[q + 2] += V[2] * dt;
        speedColor(s, K);
      } else {
        flow.sampleF(P[q], P[q + 1], P[q + 2], V);
        s = Math.hypot(V[0], V[1], V[2]);
        P[q] += V[0] * dt;
        P[q + 1] += V[1] * dt;
        P[q + 2] += V[2] * dt;
        const t = Math.min(1, s / 9);
        K[0] = 0.05 + 0.95 * t;
        K[1] = 0.95;
        K[2] = 0.85 + 0.15 * t;
      }
      const al = P[q + 1] < -900 ? 0 : Math.max(0, Math.min(1, age[i] * 2, life[i] * 2)) * 0.95;
      C[q] = K[0];
      C[q + 1] = K[1];
      C[q + 2] = K[2];
      A[i] = al;
      const tl = s > 0.01 ? Math.min(3.2, 0.3 + s * 0.16) / s : 0;
      const l = i * 6;
      L[l] = P[q];
      L[l + 1] = P[q + 1];
      L[l + 2] = P[q + 2];
      L[l + 3] = P[q] - V[0] * tl;
      L[l + 4] = P[q + 1] - V[1] * tl;
      L[l + 5] = P[q + 2] - V[2] * tl;
      LC[l] = LC[l + 3] = K[0];
      LC[l + 1] = LC[l + 4] = K[1];
      LC[l + 2] = LC[l + 5] = K[2];
      LA[i * 2] = al * 0.9;
      LA[i * 2 + 1] = 0;
    }
    const a = g.attributes;
    const b = lg.attributes;
    a.position.needsUpdate = a.aCol.needsUpdate = a.aAl.needsUpdate = true;
    b.position.needsUpdate = b.aCol.needsUpdate = b.aAl.needsUpdate = true;
  }

  const api = { trG, update, setPointScale };

  function setPointScale(drawingBufferHeight) {
    pointMat.uniforms.uS.value = drawingBufferHeight * 0.5;
  }

  return api;
}
