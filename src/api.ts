// Bridge to the Electron main process (see electron/preload.cjs).
// When the renderer runs in a plain browser (vite dev without Electron) it falls
// back to localStorage and browser downloads, so the UI is still usable.

export interface JoineryBridge {
  loadData(): Promise<string | null>;
  saveData(json: string): Promise<boolean>;
  dataLocation(): Promise<string>;
  saveText(opts: { defaultName: string; filters?: { name: string; extensions: string[] }[]; content: string }): Promise<string | null>;
  savePdf(opts: { defaultName: string; html: string; landscape?: boolean }): Promise<string | null>;
  reveal(filePath: string): Promise<void>;
}

declare global {
  interface Window {
    joinery?: JoineryBridge;
  }
}

const KEY = 'joinery-data';

function download(name: string, content: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const browserBridge: JoineryBridge = {
  async loadData() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  },
  async saveData(json) {
    try { localStorage.setItem(KEY, json); return true; } catch { return false; }
  },
  async dataLocation() { return 'Browser storage (not running in Electron)'; },
  async saveText({ defaultName, content }) { download(defaultName, content, 'text/plain'); return defaultName; },
  async savePdf({ defaultName, html }) { download(defaultName.replace(/\.pdf$/i, '.html'), html, 'text/html'); return defaultName; },
  async reveal() {},
};

export const api: JoineryBridge = window.joinery ?? browserBridge;
export const isElectron = Boolean(window.joinery);
