import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

/** Versi untuk laporan diagnostik: commit dari Vercel/CI, atau git lokal. */
function commit() {
  const env = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (env) return env.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  // path relatif supaya build bisa dibuka dari sub-folder (mis. GitHub Pages /reefsimulator/)
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(commit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // uji fisika CFD menjalankan ratusan langkah solver
    testTimeout: 60000,
  },
});
