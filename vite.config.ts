import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Set by `tauri dev` when targeting a physical Android/iOS device.
const host = process.env['TAURI_DEV_HOST'];

export default defineConfig({
  plugins: [react()],
  // Keep Rust compiler errors visible in the terminal.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    // WebView2 (Windows) and the Android System WebView are both modern Chromium.
    target: 'es2021',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
