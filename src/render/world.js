/**
 * Perakit dunia 3D: membangun scene, menyediakan update per frame dan pengaturan kualitas.
 */
import { createContext, LIGHT } from './context.js';
import { createTextures } from './textures.js';
import { createMaterials, applyGlassTint, uniforms, shaderQuality } from './materials.js';
import { buildRoom } from './scene/room.js';
import { buildTank, applyBackground } from './scene/tank.js';
import { buildSand, buildRocks, buildCorals } from './scene/aquascape.js';
import { buildFish, updateFish } from './scene/fish.js';
import { buildEquipment, RETURN_PTS } from './scene/equipment.js';
import { buildWater, setWaterHeight } from './scene/water.js';
import { createSiphon } from './scene/siphon.js';
import { buildFlowParticles, movePoints, foamAt, setDotTexture } from './scene/particles.js';
import { buildTracers } from './scene/tracers.js';
import { buildLabels } from './scene/labels.js';
import { GEO } from '../physics/constants.js';

const LAMP = {
  off: [0, 0, 0],
  white: [1, 0.97, 0.92],
  cool: [0.82, 0.9, 1],
  blue: [0.25, 0.42, 1],
  mix: [0.6, 0.72, 1],
  purple: [0.62, 0.4, 1],
};

export function createWorld(container, app, flow) {
  const ctx = createContext(container);
  const { renderer, scene, camera, controls, hemi, sun, led, envTex } = ctx;
  const tex = createTextures();
  setDotTexture(tex.dot);
  const M = createMaterials(tex);

  const room = buildRoom(scene, M);
  const tank = buildTank(scene, M);
  const sandG = buildSand(scene, M);
  const rockG = buildRocks(scene, M);
  const corals = buildCorals(scene);
  const fish = buildFish(scene, M, tex);
  const eq = buildEquipment(scene, M);
  const water = buildWater(scene, M);
  const siphon = createSiphon(scene, M);
  const fp = buildFlowParticles(scene, RETURN_PTS, GEO.ZOUT);
  const tracers = buildTracers(scene);
  const labels = buildLabels(scene);

  /*
   * Env map dipasang langsung ke material (bukan scene.environment) karena three r163+
   * mengabaikan envMapIntensity per material bila memakai scene.environment.
   */
  const envMats = new Set();
  function attachEnv(root) {
    root.traverse((o) => {
      const mats = o.material ? [].concat(o.material) : [];
      for (const m of mats) {
        if (m.isMeshStandardMaterial && !envMats.has(m)) {
          m.envMap = envTex;
          m.userData.e0 = m.envMapIntensity;
          m.needsUpdate = true;
          envMats.add(m);
        }
      }
    });
  }
  attachEnv(scene);
  let envK = 1;
  function envScale(k) {
    if (k === envK) return;
    envK = k;
    for (const m of envMats) m.envMapIntensity = m.userData.e0 * k;
  }

  let isLite = false;
  let qLevel = 0;
  const DPR = window.devicePixelRatio || 1;

  function resize() {
    ctx.resize();
    tracers.setPointScale(renderer.domElement.height);
  }

  function setQuality(l) {
    qLevel = l;
    renderer.setPixelRatio(Math.min(DPR, [2, 1.5, 1, 1][l]));
    const lite = l >= 3;
    if (sun.castShadow === lite) {
      sun.castShadow = !lite;
      ctx.markShadowsDirty();
    }
    if (lite !== isLite) {
      isLite = lite;
      shaderQuality.caustics = !lite;
      M.sand.needsUpdate = true;
      M.rock.needsUpdate = true;
    }
    resize();
  }

  function rebuildSiphon() {
    siphon.build(app);
    attachEnv(siphon.sipG);
    eq.boxG.visible = app.P.box;
    water.boxes.B.visible = app.P.box;
    water.boxes.B.userData.l.visible = app.P.box;
    ctx.markShadowsDirty();
  }

  function applyView() {
    const { V } = app;
    fish.fishG.visible = V.fish;
    corals.coralG.visible = V.coral;
    rockG.visible = V.rock;
    sandG.visible = V.sand;
    room.roomG.visible = V.room;
    tracers.trG.visible = V.cfd;
    eq.wmG.visible = V.wm;
    eq.wmMount.visible = V.wm;
    if (!V.cfd) tracers.sliceM.visible = false;
    ctx.markShadowsDirty();
  }

  const applyGlass = () => applyGlassTint(M, app.glassTint);
  const applyBg = () => applyBackground(tank, app.LOOK);
  applyGlass();
  applyBg();

  let tt = 0;
  let lampVisible = null;
  const D2R = Math.PI / 180;

  function update(real, simdt) {
    const { S, P, V, LOOK, NZL, WM } = app;
    tt += real;
    uniforms.uT.value = tt;
    uniforms.uLv.value = S.HT;

    eq.nozG.rotation.y = NZL.yaw * D2R;
    eq.nozG.rotation.z = -NZL.pitch * D2R;
    if (V.wm) {
      eq.wmG.position.y = WM.y;
      eq.wmG.rotation.y = WM.yaw * D2R;
      eq.wmG.rotation.z = -WM.pitch * D2R;
      eq.wmMount.position.y = WM.y;
    }

    /* mode gelap dan lampu */
    {
      const d = LOOK.dark;
      hemi.intensity = LIGHT.hemi * (d ? 0.06 : 1);
      sun.intensity = d ? 0 : LIGHT.sun;
      envScale(d ? 0.08 : 1);
      container.classList.toggle('dark', d);
    }
    {
      const L = LAMP[LOOK.lamp];
      const on = P.on && LOOK.lamp !== 'off';
      const k = on ? LOOK.li / 80 : 0;
      led.color.setRGB(L[0], L[1], L[2]);
      led.intensity = LIGHT.led * k * (LOOK.dark ? 2.4 : 1);
      const fl = on ? (LOOK.lamp === 'blue' || LOOK.lamp === 'purple' ? 0.9 : LOOK.lamp === 'mix' ? 0.5 : 0.22) * (LOOK.dark ? 1.6 : 1) * k : 0.05;
      for (const m of corals.coralMats) m.emissiveIntensity = fl;
      const e = on ? 0.35 + 0.9 * k : 0.06;
      M.led.color.setRGB(L[0] * e * 1.6, L[1] * e * 1.6, L[2] * e * 1.6);
      uniforms.uOn.value = on ? Math.min(1.4, k) : 0;
      const tw = on && LOOK.lamp === 'blue' ? 0.55 : on && LOOK.lamp === 'mix' ? 0.25 : 0;
      M.water.color.setRGB(0.024, 0.34 - 0.12 * tw, 0.75 + 0.15 * tw);
    }
    const lv = V.lamp && camera.position.y < 78;
    if (lv !== lampVisible) {
      lampVisible = lv;
      room.lampG.visible = lv;
      ctx.markShadowsDirty();
    }

    /* level air */
    const wb = water.boxes;
    setWaterHeight(wb.T, S.HT);
    setWaterHeight(wb.c1, S.H1);
    setWaterHeight(wb.c2, S.H2);
    setWaterHeight(wb.c3, S.H3);
    setWaterHeight(wb.cR, S.H3);
    setWaterHeight(wb.cP, S.HP);
    if (P.box) setWaterHeight(wb.B, S.HB, GEO.ZBOX0 + 0.3);
    water.surf.position.y = S.HT + 0.02;
    const q = S.q;
    water.surfMat.userData.uAmp.value = 0.03 + 0.13 * Math.min(1, Math.abs(q.r) / 90);
    water.surfMat.userData.uJet.value = q.r > 1 ? 0.14 * Math.min(1, q.r / 90) : 0;

    /* terjunan di sekat, overflow box, tumpahan */
    const sh = water.sheets;
    let d = S.H2 - S.H3;
    const f2 = q.q23 > 0.5 && d > 0.3;
    sh.s2.visible = f2;
    if (f2) {
      sh.s2.position.set(21.75, (S.H2 + S.H3) / 2, -7.5);
      sh.s2.scale.set(9.6, d, 1);
    }
    d = S.H3 - S.HP;
    const f4 = q.q34 > 0.5 && d > 0.3;
    sh.s4.visible = f4;
    if (f4) {
      sh.s4.position.set(39.75, (S.H3 + S.HP) / 2, -7.5);
      sh.s4.scale.set(9.6, d, 1);
    }
    d = S.HT - S.HB;
    sh.box.visible = P.box && q.c > 0.5 && d > 0.3;
    if (sh.box.visible) {
      sh.box.position.set(5, (S.HT + S.HB) / 2, 6.1);
      sh.box.scale.set(7.2, d, 1);
    }
    const spl = S.spr > 1;
    sh.spill.visible = spl;
    sh.spill2.visible = spl;
    if (spl) {
      sh.spill.position.set(25, 14.5, 25.15);
      sh.spill.scale.set(49, 31, 1);
      sh.spill2.position.set(25, -31.5, 29.12);
      sh.spill2.scale.set(49, 61, 1);
    }
    room.wetTop.visible = S.spill > 5 && V.room;
    room.puddle.visible = S.spill > 5 && V.room;
    if (room.puddle.visible) {
      const r = Math.min(80, Math.sqrt(S.spill / 0.5));
      room.puddle.scale.set(r, r * 0.5, 1);
    }

    /* siphon */
    let fs = false;
    const sip = siphon.sip;
    for (let i = 0; i < sip.length; i++) {
      const o = sip[i];
      const v = S.vs[i];
      const br = S.brk[i];
      const air = S.air[i];
      const cv = V.clear && !br;
      o.cores[0].visible = o.cores[1].visible = o.cores[2].visible = cv;
      o.air.visible = V.clear && air > 0.03;
      o.air.scale.y = Math.max(0.05, air * 7.2);
      o.handle.rotation.z = ((1 - P.sv) * Math.PI) / 2;
      if (o.cupG) {
        const rim = S.rim[i];
        const zcb = rim - GEO.CUPD;
        const top = Math.min(S.Hc[i], S.HT);
        o.cupG.position.y = rim;
        const cw = top > zcb + 0.05;
        o.cupW.visible = cw;
        if (cw) {
          const hh = Math.min(top, rim + 0.3) - zcb;
          o.cupW.scale.y = hh;
          o.cupW.position.set(o.x, zcb + hh / 2, o.zb);
        }
        o.brW.visible = V.clear && !br;
        if (o.brW.visible) {
          const hh = Math.max(0.05, Math.min(top, zcb) - o.zj);
          o.brW.scale.y = hh;
          o.brW.position.set(o.x, o.zj + hh / 2, o.zb);
        }
      }
      const free = P.zd > S.H1 + 0.15 && v > 1 && !br;
      o.stream.visible = free;
      if (free) {
        fs = true;
        const len = P.zd - S.H1;
        o.stream.scale.y = len;
        o.stream.position.set(o.x, S.H1 + len / 2, -7.5);
      }
      o.pts.p.visible = V.flow;
      movePoints(o.pts, o.path, v, simdt, 0.25, 0.25, 0.25, br || Math.abs(v) < 0.4);
    }
    for (const p of fp.flowList) p.p.visible = V.flow;
    movePoints(fp.ret, fp.retPath, S.vr * 0.35, simdt, 0.3, 0.3, 0.3, Math.abs(S.vr) < 1);
    movePoints(fp.fil, fp.filPath, q.q23 / 11, simdt, 3.2, 0.6, 6, V.cfd || (Math.abs(q.q23) < 0.8 && Math.abs(q.q34) < 0.8));
    movePoints(fp.tank, siphon.tankPath || fp.tankPath, q.r / 10, simdt, 3, 2.2, 7, q.r < 0.8 || V.cfd);
    if (V.cfd && simdt > 0) tracers.update(Math.max(0.01, Math.min(0.06, simdt)), flow, S.HT);
    tracers.sliceM.visible = V.cfd && V.sliceOn && tracers.hasSlice;

    foamAt(fp.foam, tt, 0, 26, f2, 21.7, 23.4, S.H3, -12.2, -2.8);
    foamAt(fp.foam, tt, 26, 26, f4, 39.7, 41.4, S.HP, -12.2, -2.8);
    foamAt(fp.foam, tt, 52, 14, fs, sip.length ? sip[0].x - 1.2 : 4, sip.length ? sip[0].x + 1.2 : 6, S.H1, -8.7, -6.3);
    fp.foam.g.attributes.position.needsUpdate = true;

    /* skimmer: gelembung dan buih */
    const top = Math.min(S.H2, 23.5);
    const skOn = P.on && top > 3;
    const bub = fp.bub;
    for (let i = 0; i < bub.n; i++) {
      bub.ph[i] += real * (0.5 + bub.off[i][1] * 0.3);
      if (bub.ph[i] > 1) bub.ph[i] -= 1;
      const y = 2.4 + bub.ph[i] * Math.max(0.5, top - 2.4);
      const w = tt * 3 + i;
      bub.a[i * 3] = 16 + bub.off[i][0] * 5.6 + Math.sin(w) * 0.25;
      bub.a[i * 3 + 1] = skOn ? y : -999;
      bub.a[i * 3 + 2] = -7.5 + bub.off[i][2] * 5.6 + Math.cos(w * 1.3) * 0.25;
    }
    bub.g.attributes.position.needsUpdate = true;
    eq.skAirG.visible = LOOK.skim === 'air';
    eq.skVenG.visible = LOOK.skim === 'ven';
    eq.airPumpG.visible = LOOK.skim === 'air';
    eq.skFoam.visible = skOn;
    if (skOn) {
      const h = Math.max(0.2, 31.2 - top + Math.sin(tt * 1.3) * 0.4);
      eq.skFoam.scale.y = h / 12;
      eq.skFoam.position.y = top + h / 2;
    }

    if (V.fish) updateFish(fish, S, real, tt);

    /* lain-lain */
    M.floss.color.setRGB(1 - 0.6 * P.clog, 1 - 0.72 * P.clog, 1 - 0.85 * P.clog);
    eq.holeM.visible = P.hole;
    eq.fsHi.visible = P.fsw;
    eq.fsLo.visible = P.fsw;
    eq.atoG.visible = P.ato;
    const rem = Math.max(0.02, 1 - S.ato / GEO.ATOMAX) * 11.5;
    eq.atoW.scale.y = rem;
    eq.atoW.position.set(62, -0.3 + rem / 2, -6);
    eq.atoDrip.visible = P.ato && S.atoOn;
    if (eq.atoDrip.visible) {
      const len = 31 - S.HP;
      eq.atoDrip.scale.y = len;
      eq.atoDrip.position.set(47.5, S.HP + len / 2, -11);
    }
    for (let i = 0; i < labels.length; i++) labels[i].visible = V.label && (i < 4 || P.ato);
  }

  function render() {
    controls.update();
    renderer.render(scene, camera);
  }

  return {
    ctx,
    renderer,
    scene,
    camera,
    M,
    tracers,
    update,
    render,
    resize,
    setQuality,
    get quality() {
      return qLevel;
    },
    rebuildSiphon,
    applyView,
    applyGlass,
    applyBg,
    setView: ctx.setView,
  };
}

