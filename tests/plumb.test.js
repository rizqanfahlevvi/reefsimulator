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
