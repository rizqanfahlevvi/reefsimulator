/**
 * Kabut kecepatan 3D: volume rendering medan laju arus (ray marching) untuk tank DAN back filter.
 *
 * - Medan laju per sel CFD dikirim ke GPU sebagai Data3DTexture (RG half-float):
 *   r = laju (sesaat atau rata-rata 8 dtk), g = jenis sel:
 *     1   fluida (berkabut),
 *     0,5 kosong & tembus pandang (sekat kaca, udara di atas air filter) — sinar lewat tanpa kabut,
 *     0   penghalang buram (batu, pasir, badan skimmer, badan pompa) — sinar berhenti.
 * - Untuk tiap piksel, sinar dari kamera menembus kotak volume; warna & kepekatan ditumpuk
 *   front-to-back sesuai fungsi transfer ("sorot"): arus kuat, zona mati (< 1 cm/s), atau semua laju.
 */
import * as THREE from 'three';
import { colormapGLSL, COLORMAPS } from './colormaps.js';
import { T3, F3 } from '../cfd/grid.js';
import { filterOpaque, FILTER } from '../layout.js';

const MAX_STEPS = 160;
const STEP_BY_QUALITY = [0.45, 0.6, 0.8, 1.2]; // cm per langkah sinar
const MODES = ['fast', 'dead', 'all'];

/** Warna kabut zona mati: laju 0 → DEAD_LO, laju DEAD_MAX cm/s → DEAD_HI (sRGB). */
export const DEAD_LO = [0.92, 0.08, 0.32];
export const DEAD_HI = [1.0, 0.6, 0.1];
export const DEAD_MAX = 1.4;

const glv3 = (a) => `vec3(${a.map((x) => x.toFixed(3)).join(', ')})`;

const FRAG = /* glsl */ `
uniform sampler3D uVol;
uniform vec3 uBoxMin; uniform vec3 uBoxMax; uniform vec3 uTexMin; uniform vec3 uTexSize;
uniform float uMax; uniform float uDensity; uniform float uStep; uniform int uCmap; uniform int uMode;
varying vec3 vWorld;
${colormapGLSL()}
vec3 deadColor(float sp) {
  return mix(${glv3(DEAD_LO)}, ${glv3(DEAD_HI)}, clamp(sp / ${DEAD_MAX.toFixed(2)}, 0.0, 1.0));
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
  // tanpa jitter acak (butiran); langkah ≤ 1/2 sel CFD sehingga pita tidak tampak
  float tc = t.x + 0.5 * uStep;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (tc > t.y) break;
    vec3 p = ro + rd * tc;
    vec2 s = texture(uVol, (p - uTexMin) / uTexSize).rg;
    if (s.g < 0.25) break;                        // penghalang buram
    float fl = smoothstep(0.6, 0.9, s.g);         // 0,5 = kosong & tembus
    tc += uStep;
    if (fl <= 0.0) continue;
    float sp = s.r;
    float tt = sp / uMax;
    float w = uMode == 0 ? pow(clamp(tt, 0.0, 1.0), 1.4)          // arus kuat menonjol
            : uMode == 1 ? 0.3 * smoothstep(1.4, 0.5, sp)         // zona mati (< 1 cm/s) menonjol
            : 0.4 * (0.2 + 0.8 * clamp(tt, 0.0, 1.0));            // semua laju
    float a = 1.0 - exp(-uDensity * w * fl * uStep);
    // zona mati memakai warna peringatan sendiri (merah tua = diam, oranye = ±1 cm/s)
    vec3 c = uMode == 1 ? deadColor(sp) : cmap(tt, uCmap);
    acc.rgb += (1.0 - acc.a) * a * c;
    acc.a += (1.0 - acc.a) * a;
    if (acc.a > 0.97) break;
  }
  if (acc.a < 0.002) discard;
  gl_FragColor = acc;                               // premultiplied alpha
}`;

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/**
 * Satu volume kabut di atas kisi CFD G.
 * @param {object} spec
 * @param {object} spec.G kisi (T3/F3)
 * @param {() => {u, v, w, avg, sol}} spec.fields medan pusat-sel terbaru
 * @param {(S) => number} spec.lidJ baris teratas fluida (tank); sel di atasnya = salinan (bukan penghalang). Infinity bila tidak dipakai.
 * @param {(x, y, z) => number} spec.solidValue nilai g untuk sel padat (0 buram / 0,5 tembus)
 * @param {(S, min: THREE.Vector3, max: THREE.Vector3) => void} spec.box batas kotak air
 * @param {(S) => string} spec.key kunci level air (refresh bila berubah)
 */
function createFogVolume(scene, app, flow, camera, spec) {
  const G = spec.G;
  const { nx, ny, nz, h, SY, SZ } = G;
  const data = new Uint16Array(nx * ny * nz * 2);
  const tex = new THREE.Data3DTexture(data, nx, ny, nz);
  tex.format = THREE.RGFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  const speeds = new Float32Array(nx * ny * nz);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uVol: { value: tex },
      uBoxMin: { value: new THREE.Vector3() },
      uBoxMax: { value: new THREE.Vector3() },
      // pusat sel i (1..nx) di x = x0 + (i − 0,5)·h → koordinat tekstur (i − 0,5)/nx
      uTexMin: { value: new THREE.Vector3(G.x0, G.y0, G.z0) },
      uTexSize: { value: new THREE.Vector3(nx * h, ny * h, nz * h) },
      uMax: { value: 6 },
      uDensity: { value: 0.6 },
      uStep: { value: STEP_BY_QUALITY[0] },
      uCmap: { value: 0 },
      uMode: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
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
  const toHalf = THREE.DataUtils.toHalfFloat;
  let lastVersion = -1;
  let lastKey = '';
  let lastRefresh = 0;
  let p95 = 3;
  const xc = (i) => G.x0 + (i - 0.5) * h;
  const yc = (j) => G.y0 + (j - 0.5) * h;
  const zc = (k) => G.z0 + (k - 0.5) * h;

  function refresh() {
    const { S, FV } = app;
    const useAvg = FV.value === 'avg';
    const lidJ = spec.lidJ(S);
    const { u, v, w, avg, sol } = spec.fields();
    let nf = 0;
    for (let k = 1; k <= nz; k++)
      for (let i = 1; i <= nx; i++) {
        let top = 0; // laju sel fluida teratas kolom (diteruskan ke sel di atas permukaan tank)
        for (let j = 1; j <= ny; j++) {
          const c = i + SY * j + SZ * k;
          const t = (i - 1 + nx * (j - 1 + ny * (k - 1))) * 2;
          let sp = 0;
          let g = 1;
          if (j > lidJ) sp = top;
          else if (sol[c]) g = spec.solidValue(xc(i), yc(j), zc(k));
          else {
            sp = useAvg ? avg[c] : Math.hypot(u[c], v[c], w[c]);
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

  function update(vmax) {
    const { V, FV, S } = app;
    const on = V.cfd && V.fog;
    mesh.visible = on;
    if (!on) return;
    spec.box(S, boxMin, boxMax);
    mesh.position.copy(boxMin);
    mesh.scale.subVectors(boxMax, boxMin);
    const un = mat.uniforms;
    un.uBoxMin.value.copy(boxMin);
    un.uBoxMax.value.copy(boxMax);
    un.uMax.value = vmax;
    un.uDensity.value = FV.fogDensity;
    un.uCmap.value = Math.max(0, COLORMAPS.indexOf(FV.cmap));
    un.uMode.value = Math.max(0, MODES.indexOf(FV.fogMode));
    // kamera di dalam kotak (zoom dekat): gambar sisi belakang supaya kabut tetap tampak
    const c = camera.position;
    const inside = c.x > boxMin.x && c.x < boxMax.x && c.y > boxMin.y && c.y < boxMax.y && c.z > boxMin.z && c.z < boxMax.z;
    mat.side = inside ? THREE.BackSide : THREE.FrontSide;
    const key = `${FV.value}|${spec.key(S)}`;
    const now = performance.now();
    if (key !== lastKey || (flow.version !== lastVersion && now - lastRefresh > 90)) {
      refresh();
      lastKey = key;
      lastVersion = flow.version;
      lastRefresh = now;
    }
  }

  return {
    mesh,
    update,
    setQuality(level) {
      mat.uniforms.uStep.value = STEP_BY_QUALITY[Math.max(0, Math.min(3, level))];
    },
    get p95() {
      return p95;
    },
  };
}

/** Kabut kecepatan untuk tank + filter. */
export function createFlowFog(scene, app, flow, camera) {
  const tank = createFogVolume(scene, app, flow, camera, {
    G: T3,
    fields: () => ({ u: flow.fu, v: flow.fv, w: flow.fw, avg: flow.favg, sol: flow.fsol }),
    lidJ: (S) => Math.max(1, Math.min(T3.ny, Math.ceil(S.HT / T3.h + 0.5) - 1)),
    solidValue: () => 0, // batu, pasir, overflow box
    box: (S, mn, mx) => {
      mn.set(0.5, 0.2, 0.5);
      mx.set(49.5, Math.max(1, S.HT - 0.05), 24.5);
    },
    key: (S) => String(Math.round(S.HT * 4)),
  });
  const filter = createFogVolume(scene, app, flow, camera, {
    G: F3,
    fields: () => ({ u: flow.ffu, v: flow.ffv, w: flow.ffw, avg: flow.ffavg, sol: flow.ffsol }),
    lidJ: () => Infinity, // level tiap chamber berbeda: di atas air = kosong tembus
    solidValue: (x, y, z) => (filterOpaque(x, y, z) ? 0 : 0.5),
    box: (S, mn, mx) => {
      mn.set(0.5, 0.2, FILTER.z0);
      mx.set(49.5, Math.max(1, Math.max(S.H1, S.H2, S.H3, S.HP) - 0.05), FILTER.z1);
    },
    key: (S) => [S.H1, S.H2, S.H3, S.HP].map((x) => Math.round(x * 2)).join(','),
  });
  const vols = [tank, filter];
  return {
    update(vmax) {
      for (const v of vols) v.update(vmax);
    },
    setQuality(level) {
      for (const v of vols) v.setQuality(level);
    },
    /** persentil 95 laju gabungan (untuk skala warna otomatis) */
    get p95() {
      return Math.max(tank.p95, filter.p95);
    },
  };
}
