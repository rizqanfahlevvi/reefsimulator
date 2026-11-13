/** Grafik canvas 2D: level air, debit, kurva pompa vs kurva sistem. */
import { app } from '../state.js';
import { G, GEO } from '../physics/constants.js';
import { returnK } from '../physics/hydraulics.js';
import { $ } from '../util/format.js';

function prep(cv) {
  const w = cv.clientWidth || 300;
  const h = cv.clientHeight || 170;
  const r = Math.min(window.devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) {
    cv.width = Math.round(w * r);
    cv.height = Math.round(h * r);
  }
  const x = cv.getContext('2d');
  if (!x) return null;
  x.setTransform(r, 0, 0, r, 0, 0);
  x.clearRect(0, 0, w, h);
  return { x, w, h };
}

let cssCache = null;
let cssAt = 0;
function css() {
  const now = performance.now();
  if (!cssCache || now - cssAt > 2000) {
    const s = getComputedStyle(document.documentElement);
    cssCache = { mut: s.getPropertyValue('--mut').trim() || '#888', ink: s.getPropertyValue('--ink').trim() || '#000' };
    cssAt = now;
  }
  return cssCache;
}

function axes(c, ymin, ymax, xl, xr, nt = 4) {
  const x = c.x;
  const L = 34;
  const R = 6;
  const T = 6;
  const B = 16;
  x.font = '10px system-ui,sans-serif';
  x.fillStyle = css().mut;
  x.lineWidth = 1;
  x.strokeStyle = 'rgba(137,135,129,0.28)';
  const Y = (v) => T + (1 - (v - ymin) / (ymax - ymin)) * (c.h - T - B);
  for (let i = 0; i <= nt; i++) {
    const v = ymin + ((ymax - ymin) * i) / nt;
    x.beginPath();
    x.moveTo(L, Y(v));
    x.lineTo(c.w - R, Y(v));
    x.stroke();
    x.textAlign = 'right';
    x.fillText(Math.abs(v) < 10 && v % 1 !== 0 ? v.toFixed(1) : Math.round(v), L - 4, Y(v) + 3);
  }
  x.textAlign = 'left';
  x.fillText(xl, L, c.h - 3);
  x.textAlign = 'right';
  x.fillText(xr, c.w - R, c.h - 3);
  return { Y, L, R };
}

function line(c, ax, data, col, dash, X) {
  const x = c.x;
  x.strokeStyle = col;
  x.lineWidth = 2;
  x.setLineDash(dash || []);
  x.beginPath();
  for (let i = 0; i < data.length; i++) {
    const px = X(i);
    const py = ax.Y(data[i]);
    if (i === 0) x.moveTo(px, py);
    else x.lineTo(px, py);
  }
  x.stroke();
  x.setLineDash([]);
}

export function drawCharts() {
  const { hist, P, S } = app;
  const n = hist.length;
  const tl = n ? Math.round(hist[0].t) + ' dtk' : '';
  const tr = n ? Math.round(hist[n - 1].t) + ' dtk' : '';

  let c = prep($('cLev'));
  if (c) {
    let lo = 16;
    for (let i = 0; i < n; i++) lo = Math.min(lo, hist[i].HP, hist[i].H3);
    lo = Math.max(0, Math.floor((lo - 0.5) / 4) * 4);
    const ax = axes(c, lo, 32, tl, tr, (32 - lo) / 4);
    const X = (i) => ax.L + (n > 1 ? i / (n - 1) : 0) * (c.w - ax.L - ax.R);
    c.x.strokeStyle = '#d03b3b';
    c.x.lineWidth = 1.2;
    c.x.setLineDash([4, 3]);
    c.x.beginPath();
    c.x.moveTo(ax.L, ax.Y(30));
    c.x.lineTo(c.w - ax.R, ax.Y(30));
    c.x.stroke();
    c.x.setLineDash([]);
    if (n > 1) {
      for (const [k, col] of [
        ['HP', '#6250d6'],
        ['H3', '#1baf7a'],
        ['H2', '#eda100'],
        ['H1', '#eb6834'],
      ])
        line(c, ax, hist.map((h) => h[k]), col, null, X);
      if (P.box) line(c, ax, hist.map((h) => h.HB), '#e87ba4', null, X);
      line(c, ax, hist.map((h) => h.HT), '#2a78d6', null, X);
    }
  }

  c = prep($('cFlow'));
  if (c) {
    let lo = 0;
    let hi = 400;
    for (let i = 0; i < n; i++) {
      lo = Math.min(lo, hist[i].qs, hist[i].qr);
      hi = Math.max(hi, hist[i].qs, hist[i].qr);
    }
    lo = Math.floor(lo / 100) * 100;
    hi = Math.ceil(hi / 100) * 100;
    const ax = axes(c, lo, hi, tl, tr, 4);
    const X = (i) => ax.L + (n > 1 ? i / (n - 1) : 0) * (c.w - ax.L - ax.R);
    if (n > 1) {
      line(c, ax, hist.map((h) => h.qr), '#eb6834', null, X);
      line(c, ax, hist.map((h) => h.qs), '#1baf7a', [6, 3], X);
    }
  }

  c = prep($('cPump'));
  if (c) {
    const qM = P.qmax * 1.05;
    const hM = P.hmax * 100 * 1.08;
    const ax = axes(c, 0, hM, '0 L/jam', Math.round(qM) + ' L/jam', 4);
    const N = 40;
    const X = (i) => ax.L + (i / N) * (c.w - ax.L - ax.R);
    const Ar = (Math.PI * GEO.DR * GEO.DR) / 4;
    const full = [];
    const cur = [];
    const sys = [];
    for (let i = 0; i <= N; i++) {
      const Q = (qM * i) / N;
      const r = Q / P.qmax;
      full.push(Math.max(0, P.hmax * 100 * (1 - r * r)));
      cur.push(Math.max(0, P.hmax * 100 * (P.spd * P.spd - r * r)));
      const v = Q / 3.6 / Ar;
      sys.push(Math.min(hM, Math.max(0, Math.max(S.HT, GEO.ZOUT) - S.HP) + (returnK(P, v) * v * v) / (2 * G)));
    }
    line(c, ax, full, '#9bbfe8', [3, 3], X);
    line(c, ax, cur, '#2a78d6', null, X);
    line(c, ax, sys, '#eb6834', [6, 3], X);
    const qo = Math.max(0, S.q.r) * 3.6;
    const px = ax.L + (qo / qM) * (c.w - ax.L - ax.R);
    const py = ax.Y(Math.min(hM, S.q.hp));
    c.x.fillStyle = css().ink;
    c.x.beginPath();
    c.x.arc(px, py, 4.5, 0, Math.PI * 2);
    c.x.fill();
    c.x.font = '11px system-ui,sans-serif';
    const right = px > c.w - 110;
    c.x.textAlign = right ? 'right' : 'left';
    c.x.fillText(Math.round(qo) + ' L/jam · ' + Math.round(S.q.hp) + ' cm', px + (right ? -8 : 8), py - 7);
  }
}
