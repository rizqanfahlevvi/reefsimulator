/**
 * Kabut kecepatan 3D: volume rendering medan laju arus tank (ray marching).
 *
 * - Medan laju per sel CFD (32×20×16) dikirim ke GPU sebagai Data3DTexture (RG half-float):
 *   r = laju (sesaat atau rata-rata 8 dtk), g = 1 fluida / 0 batu-pasir.
 * - Untuk tiap piksel, sinar dari kamera menembus kotak air; di sepanjang sinar warna dan
 *   kepekatan ditumpuk (front-to-back) sesuai fungsi transfer. Sinar berhenti saat mengenai
 *   batu/pasir (g < 0,5), sehingga batu tampak tertutup kabut dengan benar tanpa depth pass.
 * - Fungsi transfer ("sorot"): arus kuat (jet), zona mati (< 1 cm/s), atau semua laju.
 */
import * as THREE from 'three';
import { colormapGLSL, COLORMAPS } from './colormaps.js';
import { T3 } from '../cfd/grid.js';

const MAX_STEPS = 160;
const STEP_BY_QUALITY = [0.45, 0.6, 0.8, 1.2]; // cm per langkah sinar
const MODES = ['fast', 'dead', 'all'];

/** Warna kabut zona mati: laju 0 → DEAD_LO, laju DEAD_MAX cm/s → DEAD_HI (sRGB). */
export const DEAD_LO = [0.92, 0.08, 0.32];
export const DEAD_HI = [1.0, 0.6, 0.1];
export const DEAD_MAX = 1.4;

export function createFlowFog(scene, app, flow, camera) {
  const { nx, ny, nz, h, SY, SZ } = T3;
  const data = new Uint16Array(nx * ny * nz * 2);
  const tex = new THREE.Data3DTexture(data, nx, ny, nz);
  tex.format = THREE.RGFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  const speeds = new Float32Array(nx * ny * nz);

  // pusat sel i (1..nx) berada di x = 0,5 + (i − 0,5)·h → koordinat tekstur (i − 0,5)/nx
  const texMin = new THREE.Vector3(0.5, 0, 0.5);
  const texSize = new THREE.Vector3(nx * h, ny * h, nz * h);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uVol: { value: tex },
      uBoxMin: { value: new THREE.Vector3() },
      uBoxMax: { value: new THREE.Vector3() },
      uTexMin: { value: texMin },
      uTexSize: { value: texSize },
      uMax: { value: 6 },
      uDensity: { value: 0.6 },
      uStep: { value: STEP_BY_QUALITY[0] },
      uCmap: { value: 0 },
      uMode: { value: 0 },
    },
    vertexShader: /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform sampler3D uVol;
uniform vec3 uBoxMin; uniform vec3 uBoxMax; uniform vec3 uTexMin; uniform vec3 uTexSize;
uniform float uMax; uniform float uDensity; uniform float uStep; uniform int uCmap; uniform int uMode;
varying vec3 vWorld;
${colormapGLSL()}
vec3 deadColor(float sp) {
  return mix(vec3(${DEAD_LO.join(', ')}), vec3(${DEAD_HI.join(', ')}), clamp(sp / ${DEAD_MAX.toFixed(1)}, 0.0, 1.0));
}
vec2 hitBox(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uBoxMin - ro) * inv;
  vec3 t1 = (uBoxMax - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  vec2 t = hitBox(ro, rd);
  t.x = max(t.x, 0.0);
  if (t.x >= t.y) discard;
  // tanpa jitter acak (butiran); langkah ≤ 1/3 sel CFD sehingga pita tidak tampak
  float tc = t.x + 0.5 * uStep;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (tc > t.y) break;
    vec3 p = ro + rd * tc;
    vec2 s = texture(uVol, (p - uTexMin) / uTexSize).rg;
    if (s.g < 0.5) break;                         // batu / pasir menghalangi pandangan
    float sp = s.r;
    float tt = sp / uMax;
    float w = uMode == 0 ? pow(clamp(tt, 0.0, 1.0), 1.4)          // arus kuat menonjol
            : uMode == 1 ? 0.3 * smoothstep(1.4, 0.5, sp)         // zona mati (< 1 cm/s) menonjol
            : 0.4 * (0.2 + 0.8 * clamp(tt, 0.0, 1.0));            // semua laju
    float a = 1.0 - exp(-uDensity * w * uStep);
    // zona mati memakai warna peringatan sendiri (merah tua = diam, oranye = ±1 cm/s)
    vec3 c = uMode == 1 ? deadColor(sp) : cmap(tt, uCmap);
    acc.rgb += (1.0 - acc.a) * a * c;
    acc.a += (1.0 - acc.a) * a;
    if (acc.a > 0.97) break;
    tc += uStep;
  }
  if (acc.a < 0.002) discard;
  gl_FragColor = acc;                               // premultiplied alpha
}`,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0.5, 0.5, 0.5);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 10; // setelah kaca dan bidang potong
  mesh.visible = false;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const boxMin = new THREE.Vector3();
  const boxMax = new THREE.Vector3();
  let lastVersion = -1;
  let lastKey = '';
  let lastRefresh = 0;
  const toHalf = THREE.DataUtils.toHalfFloat;
  let p95 = 3;

  function refresh() {
    const { S, FV } = app;
    const useAvg = FV.value === 'avg';
    const jT = Math.max(1, Math.min(ny, Math.ceil(S.HT / h + 0.5) - 1));
    const { fu, fv, fw, favg, fsol } = flow;
    let nf = 0;
    for (let k = 1; k <= nz; k++)
      for (let i = 1; i <= nx; i++) {
        let top = 0; // laju sel fluida teratas di kolom ini (diteruskan ke sel di atas permukaan)
        for (let j = 1; j <= ny; j++) {
          const c = i + SY * j + SZ * k;
          const t = (i - 1 + nx * (j - 1 + ny * (k - 1))) * 2;
          let sp = 0;
          let g = 1;
          if (j > jT) sp = top; // di atas air: bukan penghalang, hanya untuk interpolasi
          else if (fsol[c]) g = 0; // batu, pasir, overflow box
          else {
            sp = useAvg ? favg[c] : Math.hypot(fu[c], fv[c], fw[c]);
            top = sp;
            speeds[nf++] = sp;
          }
          data[t] = toHalf(sp);
          data[t + 1] = toHalf(g);
        }
      }
    tex.needsUpdate = true;
    if (nf > 10) {
      const arr = speeds.subarray(0, nf).slice().sort();
      p95 = arr[Math.floor(nf * 0.95)];
    }
  }

  /**
   * @param {number} vmax batas atas skala warna (dibagi dengan bidang potong & legenda)
   */
  function update(vmax) {
    const { V, FV, S } = app;
    const on = V.cfd && V.fog;
    mesh.visible = on;
    if (!on) return;
    // kotak air: di atas pasir sampai permukaan
    boxMin.set(0.5, 0.2, 0.5);
    boxMax.set(49.5, Math.max(1, S.HT - 0.05), 24.5);
    mesh.position.copy(boxMin);
    mesh.scale.subVectors(boxMax, boxMin);
    const u = mat.uniforms;
    u.uBoxMin.value.copy(boxMin);
    u.uBoxMax.value.copy(boxMax);
    u.uMax.value = vmax;
    u.uDensity.value = FV.fogDensity;
    u.uCmap.value = Math.max(0, COLORMAPS.indexOf(FV.cmap));
    u.uMode.value = Math.max(0, MODES.indexOf(FV.fogMode));
    // kamera di dalam kotak (zoom dekat): gambar sisi belakang supaya kabut tetap tampak
    const c = camera.position;
    const inside = c.x > boxMin.x && c.x < boxMax.x && c.y > boxMin.y && c.y < boxMax.y && c.z > boxMin.z && c.z < boxMax.z;
    mat.side = inside ? THREE.BackSide : THREE.FrontSide;

    const key = `${FV.value}|${Math.round(S.HT * 4)}`;
    const now = performance.now();
    if (key !== lastKey || (flow.version !== lastVersion && now - lastRefresh > 90)) {
      refresh();
      lastKey = key;
      lastVersion = flow.version;
      lastRefresh = now;
    }
  }

  function setQuality(level) {
    mat.uniforms.uStep.value = STEP_BY_QUALITY[Math.max(0, Math.min(3, level))];
  }

  return {
    mesh,
    update,
    setQuality,
    get p95() {
      return p95;
    },
    get visible() {
      return mesh.visible;
    },
  };
}
