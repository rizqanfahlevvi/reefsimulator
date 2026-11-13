import { describe, it, expect, vi } from 'vitest';
import { sanitize, snapshot, applySettings, loadSettings, saveSettings, clearSettings, STORAGE_KEY, SCHEMA } from '../src/settings.js';
import { defaultParams, initialState } from '../src/physics/hydraulics.js';
import { DEFAULT_VIEW } from '../src/state.js';

/** storage tiruan (pengganti localStorage) */
function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    raw: m,
  };
}

function freshApp() {
  const P = defaultParams();
  return {
    P,
    S: initialState(P),
    V: { ...DEFAULT_VIEW },
    NZL: { yaw: 20, pitch: 15 },
    WM: { q: 1000, yaw: 0, pitch: 0, y: 16 },
    LOOK: { dark: false, skim: 'air', bg: 'black', bgc: '#1e3a5f', lamp: 'mix', li: 80 },
    FV: { orient: 'h', sliceZ: 12.5, cmap: 'turbo', value: 'inst', vmax: 0, mapAlpha: 0.9, anim: 1.5, fogMode: 'fast', fogDensity: 0.6 },
    sliceY: 14,
    glassTint: 0.5,
    SPD: 3,
    volS: 37.7,
    quality: 'a',
  };
}

function freshEL() {
  return {
    tarif: 1444.7,
    rows: [
      { id: 'pump', w: 6, h: 24 },
      { id: 'led', w: 20, h: 9 },
    ],
  };
}

describe('pengaturan: simpan dan muat', () => {
  it('pengaturan bertahan setelah "reload" (simpan → muat ke app baru)', () => {
    const st = memStorage();
    const a = freshApp();
    const el = freshEL();
    a.P.fswLo = false;
    a.P.ato = false;
    a.P.qmax = 800;
    a.NZL.yaw = -35;
    a.LOOK.lamp = 'blue';
    a.LOOK.bgc = '#123ABC';
    a.FV.cmap = 'viridis';
    a.V.planeOn = true;
    a.V.fog = true;
    a.FV.fogMode = 'dead';
    a.FV.fogDensity = 1.2;
    a.quality = '2';
    el.rows[1].w = 32;
    el.tarif = 605;
    expect(saveSettings(a, el, st)).toBe(true);

    const b = freshApp();
    const el2 = freshEL();
    const s = loadSettings(el2, st);
    applySettings(b, el2, s);
    expect(b.P.fswLo).toBe(false);
    expect(b.P.ato).toBe(false);
    expect(b.P.qmax).toBe(800);
    expect(b.NZL.yaw).toBe(-35);
    expect(b.LOOK.lamp).toBe('blue');
    expect(b.LOOK.bgc).toBe('#123abc');
    expect(b.FV.cmap).toBe('viridis');
    expect(b.V.planeOn).toBe(true);
    expect(b.V.fog).toBe(true);
    expect(b.FV.fogMode).toBe('dead');
    expect(b.FV.fogDensity).toBe(1.2);
    expect(b.quality).toBe('2');
    expect(el2.rows[1].w).toBe(32);
    expect(el2.tarif).toBe(605);
  });

  it('status listrik (P.on) tidak ikut disimpan', () => {
    const a = freshApp();
    a.P.on = false;
    const snap = snapshot(a, freshEL());
    expect('on' in snap.P).toBe(false);
  });

  it('JSON rusak atau versi skema lain → diabaikan (pakai bawaan), tanpa error', () => {
    const st = memStorage();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    st.setItem(STORAGE_KEY, '{rusak');
    expect(loadSettings(freshEL(), st)).toBeNull();
    st.setItem(STORAGE_KEY, JSON.stringify({ v: SCHEMA + 99, P: { qmax: 900 } }));
    expect(loadSettings(freshEL(), st)).toBeNull();
    warn.mockRestore();
  });

  it('nilai di luar rentang dipotong, tipe salah & pilihan tak dikenal dibuang', () => {
    const s = sanitize(
      {
        v: SCHEMA,
        P: { qmax: 99999, zin: -5, D: 3.3, venturi: 'ya', sk: 7, clog: Number.NaN, evil: 'x' },
        LOOK: { bgc: 'red; background:url(x)', lamp: 'disko', li: 50 },
        FV: { cmap: 'jet' },
        top: { SPD: 1000, quality: '9' },
        EL: { tarif: -1, rows: { pump: { w: 7 }, hacker: { w: 1 } } },
      },
      ['pump', 'led'],
    );
    expect(s.P).toEqual({ qmax: 1500, zin: 2 });
    expect(s.LOOK).toEqual({ li: 50 });
    expect(s.FV).toEqual({});
    expect(s.top).toEqual({ SPD: 20 });
    expect(s.EL).toEqual({ tarif: 0, rows: { pump: { w: 7 } } });
  });

  it('data tersimpan selalu menghasilkan parameter yang aman untuk fisika', () => {
    // pengaturan ekstrem tapi sah tetap bisa disimulasikan tanpa NaN
    const s = sanitize({ v: SCHEMA, P: { qmax: 0, hmax: 0, spd: 0, rv: 0, sv: 0, kb: 0, zd: 0, zin: 100 } }, []);
    const P = Object.assign(defaultParams(), s.P);
    const S = initialState(P);
    // langkah fisika memakai fungsi asli
    return import('../src/physics/hydraulics.js').then(({ step }) => {
      for (let n = 0; n < 3000; n++) step(S, P, 0.02);
      for (const k of ['HT', 'H1', 'H2', 'H3', 'HP', 'salt']) expect(Number.isFinite(S[k])).toBe(true);
    });
  });

  it('clearSettings menghapus data', () => {
    const st = memStorage();
    saveSettings(freshApp(), freshEL(), st);
    clearSettings(st);
    expect(st.getItem(STORAGE_KEY)).toBeNull();
  });

  it('storage tidak tersedia (mode privat) tidak membuat error', () => {
    expect(loadSettings(freshEL(), null)).toBeNull();
    expect(saveSettings(freshApp(), freshEL(), null)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadSettings(freshEL(), broken)).toBeNull();
    expect(saveSettings(freshApp(), freshEL(), broken)).toBe(false);
    warn.mockRestore();
  });
});
