/// <reference lib="webworker" />
import { createFlowEngine } from './engine.js';

const engine = createFlowEngine((msg, transfer) => self.postMessage(msg, transfer));
self.onmessage = (e) => {
  try {
    engine(e.data);
  } catch (err) {
    // laporkan ke klien (bukan error tak tertangkap) supaya klien bisa pulih tanpa macet
    const where = String(err?.stack || '')
      .split('\n')
      .find((l) => l.includes('.js'));
    self.postMessage({ t: 'error', message: err?.message || String(err), where: where ? where.trim().replace(/https?:\/\/[^/\s)]+\//g, '') : '' });
  }
};
