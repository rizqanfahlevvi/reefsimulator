/** Rakit pipa: katalog, posisi 3D, kecocokan ujung, sisip di tengah, daftar bahan, validasi. */
import { describe, it, expect } from 'vitest';
import { TYPES, SIZES, dims, portsOf, mates, sizesMatch } from '../src/plumb/catalog.js';
import { newDesign, addRoot, addPart, frames, freePorts, candidates, removePart, updatePart, insertInline, altCports, validateDesign, partPorts } from '../src/plumb/model.js';
import { bom, packCuts, bomMarkdown } from '../src/plumb/bom.js';

const near = (v, a, eps = 1e-6) => {
  expect(v.x).toBeCloseTo(a[0], 4);
  expect(v.y).toBeCloseTo(a[1], 4);
  expect(v.z).toBeCloseTo(a[2], 4);
};

describe('katalog', () => {
  it('semua jenis punya port valid untuk semua ukuran; arah port satuan di bidang XZ', () => {
    for (const size of Object.keys(SIZES)) {
      const A = dims(size, 'AW');
      for (const type of Object.keys(TYPES)) {
        const ps = portsOf(type, A, A, 300);
        expect(ps.length).toBeGreaterThan(0);
        for (const p of ps) {
          expect(Math.hypot(...p.d)).toBeCloseTo(1, 6);
          expect(p.d[1]).toBe(0);
          expect(['S', 'P', 'F', 'M', 'FL']).toContain(p.end);
        }
      }
    }
  });
  it('kedalaman sok metrik mengikuti ISO 727 (0,5·D + 6 mm)', () => {
    for (const k of ['m20', 'm25', 'm32']) expect(dims(k).sock).toBeCloseTo(0.5 * SIZES[k].od + 6, 6);
  });
  it('aturan sambungan: sok↔polos, drat dalam↔luar, flange↔flange; drat dibandingkan per ukuran drat', () => {
    expect(mates('S', 'P')).toBe(true);
    expect(mates('S', 'S')).toBe(false);
    expect(mates('F', 'M')).toBe(true);
    expect(mates('F', 'P')).toBe(false);
    expect(sizesMatch('F', 'i12', 'M', 'm20')).toBe(true); // ½" BSP keduanya
    expect(sizesMatch('S', 'i12', 'P', 'm20')).toBe(false);
  });
});

describe('rakitan', () => {
  it('pipa → knee 90° → pipa: posisi dunia benar dan ujung bebas mengikuti', () => {
    const d = newDesign();
    const p1 = addRoot(d, { type: 'pipe', size: 'i12', cls: 'AW', len: 300, anchor: { p: [0, 0, 0], dir: 'up' } });
    let fr = frames(d);
    near(fr.get(p1).ports[1].p, [0, 300, 0]); // pipa tumbuh ke atas sepanjang potongannya
    const e = addPart(d, p1, 1, { type: 'elbow90', slot: 'a' });
    const p2 = addPart(d, e, 1, { type: 'pipe', slot: 'a', len: 200 });
    fr = frames(d);
    const ePorts = fr.get(e).ports;
    near(ePorts[0].p, [0, 300, 0]); // dasar sok knee = ujung pipa
    const z = 0.6 * 22 + 2;
    // keluar knee tegak lurus, berjarak z dari sudut (sudut di 300 + z)
    expect(ePorts[1].p.y).toBeCloseTo(300 + z, 4);
    expect(Math.hypot(ePorts[1].p.x, ePorts[1].p.z)).toBeCloseTo(z, 4);
    expect(Math.abs(ePorts[1].d.y)).toBeLessThan(1e-9);
    const end = fr.get(p2).ports[1];
    expect(end.p.distanceTo(ePorts[1].p)).toBeCloseTo(200, 4);
    expect(freePorts(d, fr).map((f) => f.pid)).toEqual([p1, p2]); // pangkal pipa 1 & ujung pipa 2
  });

  it('putaran 90° memutar knee di sumbu pipa; 4 × 90° kembali ke semula', () => {
    const d = newDesign();
    const p1 = addRoot(d, { type: 'pipe', size: 'i34', len: 300, anchor: { p: [0, 0, 0], dir: 'up' } });
    const e = addPart(d, p1, 1, { type: 'elbow90', slot: 'a' });
    const dir0 = frames(d).get(e).ports[1].d.clone();
    updatePart(d, e, { roll: 90 });
    const dir1 = frames(d).get(e).ports[1].d.clone();
    expect(dir0.dot(dir1)).toBeCloseTo(0, 6);
    updatePart(d, e, { roll: 360 });
    expect(frames(d).get(e).ports[1].d.dot(dir0)).toBeCloseTo(1, 6);
  });

  it('kandidat hanya yang cocok: ujung pipa → fitting sok; drat dalam → drat luar; reducer perkecil/perbesar', () => {
    const fromPipe = candidates('P', 'i34', 'AW');
    expect(fromPipe.some((c) => c.type === 'elbow90')).toBe(true);
    expect(fromPipe.some((c) => c.type === 'pipe')).toBe(false); // pipa tidak bisa langsung ke pipa
    expect(fromPipe.some((c) => c.type === 'nipple')).toBe(false);
    const red = fromPipe.filter((c) => c.type === 'socketR');
    expect(red.map((c) => c.slot).sort()).toEqual(['a', 'b']);
    expect(red.find((c) => c.slot === 'a').other).toEqual(['i12']);
    const fromF = candidates('F', 'i12', 'AW');
    expect(fromF.every((c) => ['socketM', 'nipple', 'plug', 'elbowMF'].includes(c.type))).toBe(true);
    expect(candidates('P', 'i12', 'AW').some((c) => c.type === 'socketR' && c.slot === 'a')).toBe(false); // tak ada yang lebih kecil dari ½"
  });

  it('sambungan yang tidak cocok ditolak', () => {
    const d = newDesign();
    const p1 = addRoot(d, { type: 'pipe', size: 'i12', len: 300 });
    expect(() => addPart(d, p1, 1, { type: 'pipe' })).toThrow();
    expect(() => addPart(d, p1, 1, { type: 'nipple' })).toThrow();
    const e = addPart(d, p1, 1, { type: 'elbow90' });
    expect(() => addPart(d, p1, 1, { type: 'cap' })).toThrow(/terpakai/);
    expect(e).toBeGreaterThan(p1);
  });

  it('sisipkan ball valve di tengah pipa: panjang total tetap, bagian di ujung jauh ikut pindah', () => {
    const d = newDesign();
    const p1 = addRoot(d, { type: 'pipe', size: 'i34', len: 400, anchor: { p: [0, 0, 0], dir: '+x' } });
    const cap = addPart(d, p1, 1, { type: 'cap' });
    const before = frames(d).get(cap).m.elements.slice(12, 15);
    const r = insertInline(d, p1, 'ballvalve');
    const fr = frames(d);
    const after = fr.get(cap).m.elements.slice(12, 15);
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i], 4)); // dop tetap di tempatnya
    expect(d.parts.find((p) => p.id === cap).parent).toBe(r.pipe);
    const lens = d.parts.filter((p) => p.type === 'pipe').map((p) => p.len);
    const span = Math.abs(partPorts(d.parts.find((p) => p.id === r.fitting))[1].p[2] - partPorts(d.parts.find((p) => p.id === r.fitting))[0].p[2]);
    expect(lens.reduce((a, b) => a + b, 0) + span).toBeCloseTo(400, 0);
    // pipa pendek (60 mm) tidak muat untuk valve (±71 mm antar dasar sok) + 2 × 20 mm
    const d2 = newDesign();
    const short = addRoot(d2, { type: 'pipe', size: 'i34', len: 60 });
    expect(() => insertInline(d2, short, 'ballvalve')).toThrow(/pendek/);
    expect(() => insertInline(d2, short, 'elbow90')).toThrow();
  });

  it('tee: ganti ujung sambung (lurus ↔ cabang) dan hapus beserta turunannya', () => {
    const d = newDesign();
    const p1 = addRoot(d, { type: 'pipe', size: 'i1', len: 200 });
    const t = addPart(d, p1, 1, { type: 'tee' });
    const a = addPart(d, t, 1, { type: 'pipe', len: 100 });
    addPart(d, t, 2, { type: 'pipe', len: 100 });
    expect(altCports(d, t)).toEqual([0, 1, 2]);
    updatePart(d, t, { cport: 1 }); // pipa a yang di port 1 pindah ke port 0
    expect(d.parts.find((p) => p.id === a).pport).toBe(0);
    expect(removePart(d, t)).toBe(3);
    expect(d.parts.length).toBe(1);
  });

  it('validasi: data rusak dibuang beserta turunannya, data baik utuh', () => {
    const d = newDesign('Uji');
    const p1 = addRoot(d, { type: 'pipe', size: 'i12', len: 300 });
    const e = addPart(d, p1, 1, { type: 'elbow90' });
    addPart(d, e, 1, { type: 'pipe', len: 150 });
    const raw = JSON.parse(JSON.stringify(d));
    expect(validateDesign(raw).design.parts.length).toBe(3);
    raw.parts[1].type = 'tidak-ada';
    const v = validateDesign(raw);
    expect(v.design.parts.length).toBe(1);
    expect(v.dropped).toBe(2);
    expect(validateDesign(null).design.parts).toEqual([]);
    expect(validateDesign({ parts: [{ id: 1, type: 'pipe', size: 'i12', len: 99999 }] }).design.parts[0].len).toBe(4000);
  });
});

describe('daftar bahan', () => {
  it('first-fit decreasing ke batang 4 m', () => {
    expect(packCuts([3000, 1500, 1000, 900, 500], 4000, 3)).toMatchObject({ sticks: 2, tooLong: [] });
    expect(packCuts([4500], 4000).tooLong).toEqual([4500]);
  });
  it('menghitung fitting, potongan pipa, sambungan lem/drat, dan ujung terbuka', () => {
    const d = newDesign('Return');
    const p1 = addRoot(d, { type: 'pipe', size: 'i12', len: 300 });
    const e = addPart(d, p1, 1, { type: 'elbow90' });
    const p2 = addPart(d, e, 1, { type: 'pipe', len: 250 });
    const fa = addPart(d, p2, 1, { type: 'socketF' });
    addPart(d, fa, 1, { type: 'plug' });
    const b = bom(d);
    expect(b.pipes[0].cuts).toEqual([300, 250]);
    expect(b.pipes[0].sticks).toBe(1);
    expect(b.items.map((i) => i.name)).toEqual(['Knee 90° ½" AW', 'Plug drat luar ½" AW', 'Sok drat dalam (female adapter) ½" AW']);
    expect(b.joints).toEqual({ solvent: 3, thread: 1, flange: 0 });
    expect(b.open.length).toBe(1); // pangkal pipa pertama
    const md = bomMarkdown(b, 'Return');
    expect(md).toContain('seal tape');
    expect(md).toContain('30,0, 25,0');
  });
});

describe('geometri', () => {
  it('semua jenis menghasilkan geometri valid (tanpa NaN) untuk ukuran terkecil & terbesar', async () => {
    const { partGeometry } = await import('../src/plumb/geometry.js');
    for (const [size, sizeB] of [['i12', 'i12'], ['i2', 'i1'], ['m32', 'm20']]) {
      for (const type of Object.keys(TYPES)) {
        const part = { type, size, sizeB: TYPES[type].two ? sizeB : undefined, cls: 'AW', len: 250 };
        if (TYPES[type].two && size === sizeB) continue;
        const list = partGeometry(part);
        expect(list.length, type).toBeGreaterThan(0);
        for (const { geo, mat } of list) {
          expect(['body', 'thread', 'nut', 'handle']).toContain(mat);
          const a = geo.attributes.position.array;
          expect(a.length).toBeGreaterThan(0);
          for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) throw new Error(`${type} ${size}: NaN`);
        }
      }
    }
  });
  it('sok knee berada tepat di port (dasar sok) dan menghadap keluar', async () => {
    const { partGeometry } = await import('../src/plumb/geometry.js');
    const THREE = await import('three');
    const A = dims('i34');
    const ps = portsOf('elbow90', A);
    const hubs = partGeometry({ type: 'elbow90', size: 'i34', cls: 'AW' }).slice(1); // [0] badan
    for (let k = 0; k < 2; k++) {
      hubs[k].geo.computeBoundingBox();
      const c = hubs[k].geo.boundingBox.getCenter(new THREE.Vector3());
      const expectC = ps[k].p.map((v, i) => v + ps[k].d[i] * (A.sock / 2));
      expect(c.distanceTo(new THREE.Vector3(...expectC))).toBeLessThan(0.6);
    }
  });
});

/* ===================== fase 2: tabrakan & templat ===================== */
import { collisions, segmentDistance, capsuleBoxDepth, OBSTACLES } from '../src/plumb/collide.js';
import { TEMPLATES, buildTemplate, rollToward, addSiphon, addReturn } from '../src/plumb/templates.js';
import { analyzeLine } from '../src/plumb/hydro.js';
import * as THREE from 'three';

describe('tabrakan', () => {
  const V = (a) => new THREE.Vector3(...a);
  it('jarak ruas–ruas & kapsul–kotak', () => {
    expect(segmentDistance(V([0, 0, 0]), V([10, 0, 0]), V([5, 3, -5]), V([5, 3, 5]))).toBeCloseTo(3, 9);
    expect(segmentDistance(V([0, 0, 0]), V([10, 0, 0]), V([12, 0, 0]), V([20, 0, 0]))).toBeCloseTo(2, 9);
    const glass = [0, 500, 0, 300, 0, 5];
    expect(capsuleBoxDepth({ a: V([100, 100, 30]), b: V([200, 100, 30]), r: 11 }, glass)).toBeLessThanOrEqual(0); // 25 mm dari kaca
    expect(capsuleBoxDepth({ a: V([100, 100, -50]), b: V([100, 100, 50]), r: 11 }, glass)).toBeGreaterThan(10); // menembus
  });

  it('pipa menembus kaca terdeteksi; bulkhead di kaca diizinkan', () => {
    const d = newDesign();
    // pipa mendatar dari dalam tank menembus kaca belakang ke filter
    const p = addRoot(d, { type: 'pipe', size: 'i12', cls: 'AW', len: 200, anchor: { p: [250, 150, 100], dir: '-z' } });
    const c = collisions(d);
    expect(c.parts.has(p)).toBe(true);
    expect(c.hits.some((h) => h.what === 'kaca belakang tank')).toBe(true);
    // bulkhead tepat di kaca belakang tank (z = 2,5 mm)
    const d2 = newDesign();
    const b = addRoot(d2, { type: 'bulkhead', size: 'i12', cls: 'AW', anchor: { p: [250, 150, 2.5 + 13.7], dir: '-z' } });
    expect(collisions(d2).parts.has(b)).toBe(false);
  });

  it('bagian bertetangga tidak dianggap menabrak; dua rangkaian bersilangan terdeteksi', () => {
    const d = newDesign();
    const p0 = addRoot(d, { type: 'pipe', size: 'i12', cls: 'AW', len: 200, anchor: { p: [250, 400, 100], dir: 'up' } });
    const e = addPart(d, p0, 1, { type: 'elbow90', slot: 'a' });
    addPart(d, e, 1, { type: 'pipe', slot: 'a', len: 200 });
    expect(collisions(d).hits).toEqual([]);
    const x = addRoot(d, { type: 'pipe', size: 'i12', cls: 'AW', len: 300, anchor: { p: [100, 500, 100], dir: '+x' } });
    const c = collisions(d);
    expect(c.parts.has(x)).toBe(true);
    expect(c.parts.has(p0)).toBe(true);
  });

  it('penghalang memakai kotak yang sama dengan scene (tank 50×25×30, filter z −13..−2)', () => {
    const front = OBSTACLES.find((o) => o.name === 'kaca depan tank').b;
    expect(front).toEqual([0, 50, 0, 30, 24.5, 25]);
  });
});

describe('templat', () => {
  it('rollToward mengarahkan knee', () => {
    const d = newDesign();
    const p = addRoot(d, { type: 'pipe', size: 'i12', cls: 'AW', len: 100, anchor: { p: [0, 0, 0], dir: 'up' } });
    const e = addPart(d, p, 1, { type: 'elbow90', slot: 'a' });
    for (const want of [[1, 0, 0], [0, 0, -1], [-1, 0, 0], [0, 0, 1]]) expect(rollToward(d, e, want)).toBeCloseTo(1, 6);
  });

  it('U-pipe siphon: intake, puncak, dan ujung buang sesuai siphon di simulasi', () => {
    for (const size of ['i12', 'i34', 'm20', 'm25']) {
      const d = newDesign();
      const root = addSiphon(d, { size, cls: 'AW' });
      const fr = frames(d);
      const free = freePorts(d, fr);
      expect(free.length).toBe(2);
      const start = free.find((f) => f.pid === root);
      near(start.p, [50, 80, 35]);
      const end = free.find((f) => f.pid !== root);
      near(end.p, [50, 220, -75]);
      expect(end.d.y).toBeCloseTo(-1, 6);
      // titik tertinggi garis tengah = 34 cm (knee atas)
      const top = Math.max(...d.parts.filter((p) => p.type === 'elbow90').map((p) => fr.get(p.id).m.elements[13]));
      expect(top).toBeCloseTo(340, 6);
      expect(d.parts.some((p) => p.type === 'ballvalve')).toBe(true);
      expect(collisions(d, fr).hits).toEqual([]);
    }
  });

  it('return pompa: dari keluaran pompa ke duckbill, union + ball valve, tanpa tabrakan, siap dihitung', () => {
    for (const size of ['i12', 'i34']) {
      const d = newDesign();
      addReturn(d, { size, cls: 'AW' });
      const fr = frames(d);
      const free = freePorts(d, fr);
      expect(free.length).toBe(2);
      expect(collisions(d, fr).hits).toEqual([]);
      const types = d.parts.map((p) => p.type);
      expect(types.filter((t) => t === 'union').length).toBe(1);
      expect(types.filter((t) => t === 'ballvalve').length).toBe(1);
      // valve di atas muka air chamber pompa (±18 cm)
      const vy = fr.get(d.parts.find((p) => p.type === 'ballvalve').id).m.elements[13];
      expect(vy).toBeGreaterThan(200);
      const r = analyzeLine(d, {});
      expect(r.ok).toBe(true);
      expect(r.zout).toBeCloseTo(26.4, 6);
      expect(r.warnings).toEqual([]);
      expect(r.elems.filter((e) => e.kind === 'elbow90').length).toBe(2);
      expect(r.elems.some((e) => e.valve)).toBe(true);
    }
  });

  it('semua templat bisa dirakit untuk seri Indonesia & metrik', () => {
    for (const t of TEMPLATES)
      for (const series of ['in', 'm']) {
        const d = newDesign();
        buildTemplate(d, t, { series, cls: 'AW' });
        expect(d.parts.length).toBeGreaterThan(4);
        expect(validateDesign(JSON.parse(JSON.stringify(d))).dropped).toBe(0);
      }
  });
});

describe('hidrolik × templat', () => {
  it('siphon saja: tidak ada ujung di keluaran pompa → tidak dianggap jalur return; ujung manual tetap bisa', () => {
    const d = newDesign();
    const root = addSiphon(d, { size: 'i12', cls: 'AW' });
    const r = analyzeLine(d, {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('keluaran pompa');
    const m = analyzeLine(d, { inlet: { pid: root, port: 0 } });
    expect(m.ok).toBe(true);
    expect(m.warnings.some((w) => w.includes('keluaran pompa'))).toBe(true);
    expect(m.warnings.some((w) => w.includes('tank utama'))).toBe(true);
  });
  it('siphon + return dalam satu desain: jalur bawaan = return', () => {
    const d = newDesign();
    addSiphon(d, { size: 'i12', cls: 'AW' });
    const ret = addReturn(d, { size: 'i12', cls: 'AW' });
    const r = analyzeLine(d, {});
    expect(r.ok).toBe(true);
    expect(r.inlet.pid).toBe(ret);
    expect(r.zout).toBeCloseTo(26.4, 6);
    expect(collisions(d).hits).toEqual([]);
  });
});
