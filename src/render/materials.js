/**
 * Material scene. Warna hex diinterpretasikan sebagai sRGB dan otomatis dikonversi ke
 * ruang kerja linear oleh ColorManagement (three r152+).
 *
 * Kaca/pipa bening TIDAK memakai `transmission` karena pass transmisi three.js hanya
 * melihat objek opaque: kaca depan akan menyembunyikan pipa bening, sekat, dan kaca
 * belakang. Sebagai gantinya dipakai alpha blending + "glassy": alpha dinaikkan sebesar
 * luminans pantulan specular, sehingga pantulan tetap terlihat di kaca yang hampir bening.
 *
 * Kaca tank memakai varian "pane": warna kaca mengikuti panjang lintasan cahaya di dalam kaca
 * (Beer–Lambert) — bening bila dilihat tegak lurus, makin hijau bila dilihat miring — dan
 * pantulan ditambahkan utuh (bukan ikut diredam alpha). Ini yang membuat kaca terlihat hidup
 * tanpa perlu garis rangka di tiap tepi.
 */
import * as THREE from 'three';

/** Uniform bersama untuk animasi shader. */
export const uniforms = {
  uT: { value: 0 }, // waktu (dtk)
  uLv: { value: 27 }, // level air tank (cm)
  uOn: { value: 1 }, // kekuatan kaustik (lampu)
};

/** Flag kualitas yang memengaruhi kompilasi shader. */
export const shaderQuality = { caustics: true };

const std = (o) => new THREE.MeshStandardMaterial(o);

const GLASSY_GLSL =
  'diffuseColor.a = clamp( diffuseColor.a + dot( reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0, 1.0 );\n';

/**
 * Lembar kaca: opacity = serapan saat dilihat tegak lurus; lintasan miring lebih panjang
 * (1/cos θ, dibatasi) sehingga serapannya naik. Keluaran = (warna kaca × serapan + pantulan),
 * dengan alpha = serapan + luminans pantulan → pantulan tidak ikut diredam.
 */
const PANE_GLSL = /* glsl */ `
{
  float gNdV = abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
  float gAbs = 1.0 - pow( 1.0 - diffuseColor.a, 1.0 / max( gNdV, 0.17 ) );
  float gSpec = dot( totalSpecular, vec3( 0.2126, 0.7152, 0.0722 ) );
  float gOut = clamp( gAbs + gSpec, 0.0, 1.0 );
  outgoingLight = ( ( totalDiffuse + totalEmissiveRadiance ) * gAbs + totalSpecular ) / max( gOut, 1e-4 );
  diffuseColor.a = gOut;
}
`;

function glassy(mat, pane = false) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', (pane ? PANE_GLSL : GLASSY_GLSL) + '#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => (pane ? 'glassPane' : 'glassy');
  return mat;
}

const CAUSTIC_GLSL = /* glsl */ `
varying vec3 vWp;
uniform float uT;
uniform float uLv;
uniform float uOn;
float cau(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}`;

/** Kaustik cahaya (pola riak permukaan) di bawah level air, sebagai emisi tambahan. */
function addCaustics(mat, strength) {
  mat.customProgramCacheKey = () => (shaderQuality.caustics ? 'caus' : 'nocaus');
  mat.onBeforeCompile = (sh) => {
    if (!shaderQuality.caustics) return;
    sh.uniforms.uT = uniforms.uT;
    sh.uniforms.uLv = uniforms.uLv;
    sh.uniforms.uOn = uniforms.uOn;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CAUSTIC_GLSL)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(0.55, 0.8, 1.0) * cau(vWp.xz * 0.065, uT * 0.55) * ${strength.toFixed(2)} * uOn * smoothstep(uLv + 0.3, uLv - 2.0, vWp.y);`,
      );
  };
}

export function createMaterials(tex) {
  const M = {
    glass: glassy(std({ color: 0x8cc7b8, roughness: 0.03, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: 1.6 }), true),
    baffle: glassy(std({ color: 0x5f9aa6, roughness: 0.05, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: 0.8 }), true),
    // garis tepi tipis: hanya untuk overflow box akrilik
    edge: new THREE.LineBasicMaterial({ color: 0x1c5a4e, transparent: true, opacity: 0.35 }),
    // tepi potong kaca: hijau zamrud yang sedikit berpendar (cahaya merambat di dalam kaca) + kilau
    gEdge: glassy(
      std({ color: 0x1f8a70, emissive: 0x0a4034, emissiveIntensity: 0.5, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.62, depthWrite: false, envMapIntensity: 0.9 }),
      true,
    ),
    sil: std({ color: 0x15181a, roughness: 0.6 }),
    water: std({ color: 0x2a9be0, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.38, depthWrite: false, envMapIntensity: 0.15 }),
    waterF: std({ color: 0x46b6c6, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.33, depthWrite: false, envMapIntensity: 0.15 }),
    waterP: std({ color: 0x5a80d2, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.33, depthWrite: false, envMapIntensity: 0.15 }),
    surf: glassy(
      std({ color: 0xa6dcfa, roughness: 0.04, metalness: 0, opacity: 0.28, transparent: true, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 0.9 }),
    ),
    wl: new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
    pvc: std({ color: 0xf2f2ec, roughness: 0.4, metalness: 0 }),
    pvc2: std({ color: 0xf2f2ec, roughness: 0.4, metalness: 0, side: THREE.DoubleSide }),
    pvcG: std({ color: 0x8e979c, roughness: 0.45, metalness: 0 }),
    clear: glassy(std({ color: 0xffffff, roughness: 0.05, metalness: 0, opacity: 0.12, transparent: true, depthWrite: false, envMapIntensity: 1.2 })),
    core: new THREE.MeshBasicMaterial({ color: 0x3f9fd8, transparent: true, opacity: 0.8, depthWrite: false }),
    airM: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 }),
    stream: new THREE.MeshBasicMaterial({ color: 0xdff3ff, transparent: true, opacity: 0.7, depthWrite: false }),
    red: std({ color: 0xd23a35, roughness: 0.5 }),
    green: std({ color: 0x3f9a4c, roughness: 0.6 }),
    dark: std({ color: 0x1c1e21, roughness: 0.5, metalness: 0.1 }),
    white: std({ color: 0xf4f4f0, roughness: 0.6 }),
    metal: std({ color: 0xb9bdc2, roughness: 0.3, metalness: 0.9 }),
    hose: glassy(std({ color: 0x8fbf9c, roughness: 0.2, metalness: 0, opacity: 0.45, transparent: true, depthWrite: false })),
    air: glassy(std({ color: 0xffffff, roughness: 0.2, metalness: 0, opacity: 0.5, transparent: true, depthWrite: false })),
    wood: std({ map: tex.wood, roughness: 0.62 }),
    woodD: std({ map: tex.wood, color: 0xa89684, roughness: 0.7 }),
    wall: std({ color: 0xebe6dc, roughness: 0.95 }),
    floor: std({ color: 0xa98f72, roughness: 0.75 }),
    sand: std({ map: tex.sand, roughness: 1 }),
    rock: std({ vertexColors: true, roughness: 0.95 }),
    floss: std({ color: 0xffffff, roughness: 1 }),
    ring: std({ color: 0xe6d9bf, roughness: 0.9, side: THREE.DoubleSide }),
    foam: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
    puddle: glassy(std({ color: 0x5aa9d6, roughness: 0.05, metalness: 0, opacity: 0.7, transparent: true, depthWrite: false, envMapIntensity: 1.5 })),
    skBody: std({ color: 0xdfe8ee, roughness: 0.25, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    skCap: std({ color: 0x24282c, roughness: 0.5 }),
    skCup: std({ color: 0xeef4f7, roughness: 0.2, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }),
    skLid: std({ color: 0x4a3418, roughness: 0.4 }),
    airstone: std({ color: 0xb08a52, roughness: 0.9 }),
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.6, 2.1) }),
    hole: new THREE.MeshBasicMaterial({ color: 0xffcc00 }),
    sheet: new THREE.ShaderMaterial({
      uniforms: { uT: uniforms.uT },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform float uT; varying vec2 vUv; void main(){ float s = sin(vUv.x*70.0 + sin(vUv.x*17.0)*4.0)*0.5 + 0.5; float w = sin((vUv.y*2.0 + uT*3.0)*6.2831 + s*5.0)*0.5 + 0.5; gl_FragColor = vec4(0.87, 0.95, 1.0, 0.26 + 0.44*s*w); }',
    }),
  };
  addCaustics(M.sand, 0.55);
  addCaustics(M.rock, 0.5);
  return M;
}

/**
 * Kepekatan warna kaca. opacity = serapan saat dilihat tegak lurus; dilihat miring serapannya
 * naik sendiri (lihat PANE_GLSL), jadi nilainya jauh lebih kecil daripada versi lama yang rata.
 */
export function applyGlassTint(M, tint) {
  M.glass.opacity = 0.012 + 0.15 * tint;
  M.baffle.opacity = 0.03 + 0.26 * tint;
  M.gEdge.opacity = 0.42 + 0.4 * tint;
}
