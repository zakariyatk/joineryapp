import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Strict Content-Security-Policy for the packaged app only. The dev server needs
// an inline React-refresh script, so the policy is injected at build time.
const cspForBuild: Plugin = {
  name: 'csp-for-build',
  apply: 'build',
  transformIndexHtml(html) {
    const csp =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:";
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
  },
};

// `base: './'` lets the built index.html load its assets from file:// inside Electron.
export default defineConfig({
  plugins: [react(), cspForBuild],
  base: './',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
