/**
 * Diagram potongan (skematik) jalur air overflow: tank → sisir → kotak dalam → lubang → kotak luar →
 * tiga pipa Bean Animal. Sumbu tegak BERSKALA (cm dari dasar tank), sumbu datar skematik.
 * Murni: mengembalikan string SVG (angka saja, tanpa teks dari pengguna).
 */
import { BULKHEADS } from './model.js';

const f1 = (v) => (+v).toFixed(1).replace('.', ',');

export function diagramSVG(g, s) {
  const p = g.p;
  const top = p.tankH;
  const yMax = top + 2.5;
  const yMin = g.outBot - 7;
  const H = 250;
  const pad = 12;
  const sy = (H - 2 * pad) / (yMax - yMin);
  const Y = (y) => pad + (yMax - y) * sy;
  const o = [];
  const line = (x1, y1, x2, y2, cls = 'ln') => o.push(`<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  const rect = (x, y, w, h, cls) => h > 0 && w > 0 && o.push(`<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}"/>`);
  const text = (x, y, t, cls = 'tx', anchor = 'start') => o.push(`<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${t}</text>`);

  // kolom skematik (px)
  const tank0 = 8;
  const in0 = 86;
  const in1 = 150;
  const gl0 = in1;
  const gl1 = in1 + 8;
  const out1 = 352;
  const hT = Math.min(s.hTank, top);
  const hI = Math.min(s.hIn, top);
  const hO = Math.min(s.hOut, top);
  const yb = Y(yMin + 0.01);

  // air tank (di kiri & di bawah kotak dalam)
  rect(tank0, Y(hT), gl0 - tank0, yb - Y(hT), 'wt');
  // interior kotak dalam menutup air tank, lalu air kotak dalam
  rect(in0, Y(top), in1 - in0, Y(g.inBot) - Y(top), 'bg');
  rect(in0 + 2, Y(hI), in1 - in0 - 4, Y(g.inBot) - Y(hI) - 2, 'wt');
  // kaca belakang
  rect(gl0, Y(top), gl1 - gl0, yb - Y(top), 'gl');
  // kotak luar
  rect(gl1 + 2, Y(hO), out1 - gl1 - 4, Y(g.outBot) - Y(hO) - 2, 'wt');

  // dinding kotak dalam: sisi sisir (celah = garis putus), alas, sisi kaca
  line(in0, Y(top), in0, Y(g.slotTop), 'ac');
  line(in0, Y(g.slotTop), in0, Y(g.slotBot), 'ac dash');
  line(in0, Y(g.slotBot), in0, Y(g.inBot), 'ac');
  line(in0, Y(g.inBot), in1, Y(g.inBot), 'ac');
  line(in1, Y(top), in1, Y(g.inBot), 'ac');
  // kotak luar
  line(gl1, Y(top), gl1, Y(g.outBot), 'ac');
  line(gl1, Y(g.outBot), out1, Y(g.outBot), 'ac');
  line(out1, Y(top), out1, Y(g.outBot), 'ac');
  // bibir kaca
  line(tank0, Y(top), gl1, Y(top), 'rim');
  text(tank0 + 2, Y(top) - 3, `bibir kaca ${f1(top)}`, 'tx sm red');

  // lubang penghubung (bulkhead) menembus kotak dalam – kaca – kotak luar
  const hd = Math.max(4, g.holeD * sy);
  rect(in1 - 5, Y(p.holeY) - hd / 2, gl1 - in1 + 10, hd, 'bh');
  rect(in1 - 5, Y(p.holeY) - (g.holeBore * sy) / 2, gl1 - in1 + 10, g.holeBore * sy, 'bore');

  // air terjun di balik sisir
  if (s.combFree) {
    o.push(`<path class="fall" d="M${in0 + 2} ${Y(g.slotBot)} q 6 4 7 ${Y(hI) - Y(g.slotBot)}"/>`);
  }

  // pipa Bean Animal
  const px = { main: gl1 + 66, open: gl1 + 130, em: gl1 + 176 };
  const bottom = yb;
  for (const d of g.drains) {
    const x = px[d.key];
    const r = Math.max(4, ((BULKHEADS[d.size].hole + 0.1) * sy) / 2);
    if (d.key === 'main') {
      const R = r * 1.6;
      const yU = Y(g.mainInlet + 2.2);
      o.push(
        `<path class="pipe" d="M${x} ${bottom} V${yU} a${R} ${R} 0 0 1 ${2 * R} 0 V${Y(g.mainInlet)}" style="stroke-width:${2 * r}"/>`,
        `<path class="pipeIn" d="M${x} ${bottom} V${yU} a${R} ${R} 0 0 1 ${2 * R} 0 V${Y(g.mainInlet)}" style="stroke-width:${2 * r - 3}"/>`,
      );
      // gate valve (simbol dasi kupu-kupu)
      const yv = Y(g.outBot - 4);
      o.push(`<path class="valve" d="M${x - 7} ${yv - 5} L${x + 7} ${yv + 5} V${yv - 5} L${x - 7} ${yv + 5} Z"/>`);
      text(x + 10, yv + 4, `gate ${Math.round(p.gate * 100)}%`, 'tx sm');
      text(x + R, Y(g.mainInlet) + 11, 'siphon', 'tx sm', 'middle');
    } else {
      o.push(
        `<path class="pipe" d="M${x} ${bottom} V${Y(d.top)}" style="stroke-width:${2 * r}"/>`,
        `<path class="pipeIn" d="M${x} ${bottom} V${Y(d.top) + 1}" style="stroke-width:${2 * r - 3}"/>`,
      );
      if (d.key === 'open') text(x, Y(d.top) - 4, `terbuka ${f1(d.top)}`, 'tx sm', 'middle');
      else text(x + r, Y(d.top) - 4, `darurat ${f1(d.top)}`, 'tx sm', 'end');
      const q = s.flows[d.key];
      if (q > 0.3) o.push(`<path class="fall" d="M${x - r} ${Y(Math.min(hO, d.top + 1.5))} q ${r * 0.6} 2 ${r * 0.8} 12"/>`);
    }
  }

  // muka air & angka
  const lvl = (x0, x1, h, label, cls = '') => {
    line(x0, Y(h), x1, Y(h), 'lvl');
    text((x0 + x1) / 2, Y(h) + 13, label, 'tx b ' + cls, 'middle');
  };
  lvl(tank0, in0, hT, `tank ${f1(s.hTank)}`, s.ok ? '' : 'red');
  lvl(in0 + 2, in1 - 2, hI, `dalam ${f1(s.hIn)}`);
  line(gl1 + 2, Y(hO), out1 - 2, Y(hO), 'lvl');
  text(gl1 + 6, Y(hO) + 13, `luar ${f1(s.hOut)}`, 'tx b');
  text(in0 - 3, Y((g.slotTop + g.slotBot) / 2) + 3, 'sisir', 'tx sm', 'end');
  text(tank0 + 2, yb - 4, 'cm dari dasar tank · tinggi berskala, lebar skematik', 'tx sm mut');
  return `<svg class="d2-diagram" viewBox="0 0 360 ${H}" role="img" aria-label="Potongan jalur air overflow dengan muka air tank ${f1(s.hTank)} cm, kotak dalam ${f1(s.hIn)} cm, kotak luar ${f1(s.hOut)} cm">${o.join('')}</svg>`;
}
