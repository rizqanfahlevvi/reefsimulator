/**
 * Daftar bahan (murni): jumlah fitting per jenis & ukuran, panjang potong pipa dan jumlah batang
 * (dikemas first-fit decreasing), jumlah sambungan lem/drat/flange, dan ujung yang masih terbuka.
 */
import { TYPES, SIZES, CLASSES, END_LABEL, jointKind } from './catalog.js';
import { partPorts, freePorts } from './model.js';

/** Nama bagian lengkap dengan ukuran & kelas (mis. "Knee 90° ½" AW"). */
export function partName(p) {
  const size = SIZES[p.size].label + (p.sizeB ? ' × ' + SIZES[p.sizeB].label : '');
  return `${TYPES[p.type].name} ${size}${p.cls === 'M' ? '' : ' ' + p.cls}`;
}

/**
 * Kemas potongan ke batang (first-fit decreasing).
 * @returns {{sticks: number, leftovers: number[], tooLong: number[]}}
 */
export function packCuts(cuts, stick = 4000, kerf = 3) {
  const bins = [];
  const tooLong = [];
  for (const c of [...cuts].sort((a, b) => b - a)) {
    if (c > stick) {
      tooLong.push(c);
      continue;
    }
    const bin = bins.find((b) => b.free >= c);
    if (bin) bin.free -= c + kerf;
    else bins.push({ free: stick - c - kerf });
  }
  return { sticks: bins.length, leftovers: bins.map((b) => Math.max(0, Math.round(b.free + kerf))), tooLong };
}

export function bom(design, { stick = 4000, kerf = 3 } = {}) {
  const items = new Map();
  const pipes = new Map();
  const joints = { solvent: 0, thread: 0, flange: 0 };
  const byId = new Map(design.parts.map((p) => [p.id, p]));
  for (const p of design.parts) {
    if (p.type === 'pipe') {
      const k = p.size + '|' + p.cls;
      if (!pipes.has(k)) pipes.set(k, { size: p.size, cls: p.cls, label: `Pipa ${SIZES[p.size].label}${p.cls === 'M' ? '' : ' ' + p.cls}`, cuts: [] });
      pipes.get(k).cuts.push(p.len);
    } else {
      const name = partName(p);
      items.set(name, (items.get(name) || 0) + 1);
    }
    if (p.parent != null && byId.has(p.parent)) {
      const end = partPorts(p)[p.cport ?? 0].end;
      joints[jointKind(end)]++;
    }
  }
  const pipeList = [...pipes.values()].map((g) => {
    const total = g.cuts.reduce((a, b) => a + b, 0);
    return { ...g, cuts: [...g.cuts].sort((a, b) => b - a), total, ...packCuts(g.cuts, stick, kerf) };
  });
  const open = freePorts(design).map((f) => ({ pid: f.pid, port: f.port, size: f.size, end: f.end, label: `${END_LABEL[f.end]} ${SIZES[f.size].label}` }));
  return {
    items: [...items.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'id')),
    pipes: pipeList,
    joints,
    open,
    parts: design.parts.length,
    stick,
  };
}

const cm = (mm) => (mm / 10).toFixed(1).replace('.', ',');

/** Daftar bahan sebagai Markdown (untuk disalin / laporan Claude). */
export function bomMarkdown(b, name = 'Desain pipa') {
  const L = [`### Daftar bahan — ${name}`, ''];
  if (!b.parts) return L.concat('Belum ada bagian.').join('\n');
  if (b.pipes.length) {
    L.push('| Pipa | Potongan (cm) | Total | Batang ' + b.stick / 1000 + ' m |', '|---|---|---|---|');
    for (const g of b.pipes)
      L.push(`| ${g.label} | ${g.cuts.map(cm).join(', ')} | ${cm(g.total)} cm | ${g.sticks}${g.tooLong.length ? ' + ' + g.tooLong.length + ' potongan > 1 batang (perlu sok)' : ''} |`);
    L.push('');
  }
  if (b.items.length) {
    L.push('| Fitting | Jumlah |', '|---|---|');
    for (const it of b.items) L.push(`| ${it.name} | ${it.count} |`);
    L.push('');
  }
  const j = b.joints;
  L.push(`Sambungan: ${j.solvent} lem (sok polos)${j.thread ? ` · ${j.thread} drat (pakai seal tape)` : ''}${j.flange ? ` · ${j.flange} flange (baut + gasket)` : ''}.`);
  if (b.open.length) L.push(`Ujung terbuka: ${b.open.length} (${b.open.map((o) => o.label).join(', ')}).`);
  L.push('', `Kelas: ${Object.entries(CLASSES).map(([k, v]) => `${k} = ${v}`).join('; ')}. Panjang potong sudah memperhitungkan bagian pipa yang masuk ke sok (perkiraan, beda antar merek).`);
  return L.join('\n');
}
