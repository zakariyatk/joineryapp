import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { DEFAULT_SETTINGS, sampleData } from './lib/defaults';
import type { AppData, Project, ProjectEstimate, Settings, Unit } from './types';

const EMPTY_ESTIMATE: ProjectEstimate = { overhead: 10, margin: 25, tax: 18, overrides: {}, extras: [] };

export type SaveState = 'loading' | 'saved' | 'saving' | 'error';

interface Store {
  data: AppData;
  saveState: SaveState;
  setSettings(fn: (s: Settings) => Settings): void;
  addProject(p: Project): void;
  deleteProject(id: string): void;
  updateProject(id: string, fn: (p: Project) => Project): void;
  updateUnit(projectId: string, unitId: string, patch: Partial<Unit>): void;
}

const Ctx = createContext<Store | null>(null);

/** Merge stored data over defaults so settings added in later versions get values. */
function hydrate(raw: string | null): AppData {
  if (!raw) return sampleData();
  const parsed = JSON.parse(raw) as Partial<AppData>;
  if (!parsed || !Array.isArray(parsed.projects)) throw new Error('Data file has no projects list');
  const s = (parsed.settings ?? {}) as Partial<Settings>;
  const d = DEFAULT_SETTINGS;
  const settings: Settings = {
    ...d,
    ...s,
    materials: {
      carcass: { ...d.materials.carcass, ...s.materials?.carcass },
      front: { ...d.materials.front, ...s.materials?.front },
      back: { ...d.materials.back, ...s.materials?.back },
    },
    hardware: { ...d.hardware, ...s.hardware },
    labourRates: { ...d.labourRates, ...s.labourRates },
  };
  const projects = parsed.projects.map((p) => ({
    ...p,
    units: Array.isArray(p.units) ? p.units : [],
    estimate: { ...EMPTY_ESTIMATE, ...(p.estimate as Partial<ProjectEstimate> | undefined) },
  }));
  return { version: 1, settings, projects };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const loaded = useRef(false);

  useEffect(() => {
    api.loadData()
      .then((raw) => { setData(hydrate(raw)); setSaveState('saved'); })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  // Debounced autosave after every change.
  useEffect(() => {
    if (!data) return;
    if (!loaded.current) { loaded.current = true; return; }
    setSaveState('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.saveData(JSON.stringify(data))
        .then((ok) => setSaveState(ok ? 'saved' : 'error'))
        .catch(() => setSaveState('error'));
    }, 300);
  }, [data]);

  const mutate = useCallback((fn: (d: AppData) => AppData) => setData((d) => (d ? fn(d) : d)), []);

  const store = useMemo<Store | null>(() => {
    if (!data) return null;
    const touch = (p: Project): Project => ({ ...p, updatedAt: new Date().toISOString() });
    const updateProject = (id: string, fn: (p: Project) => Project) =>
      mutate((d) => ({ ...d, projects: d.projects.map((p) => (p.id === id ? touch(fn(p)) : p)) }));
    return {
      data,
      saveState,
      setSettings: (fn) => mutate((d) => ({ ...d, settings: fn(d.settings) })),
      addProject: (p) => mutate((d) => ({ ...d, projects: [p, ...d.projects] })),
      deleteProject: (id) => mutate((d) => ({ ...d, projects: d.projects.filter((p) => p.id !== id) })),
      updateProject,
      updateUnit: (projectId, unitId, patch) =>
        updateProject(projectId, (p) => ({ ...p, units: p.units.map((u) => (u.id === unitId ? { ...u, ...patch } : u)) })),
    };
  }, [data, saveState, mutate]);

  if (loadError) {
    return (
      <div className="fatal">
        <h1>Could not open your JoineryApp data</h1>
        <p>{loadError}</p>
        <p>Your file has not been changed. A backup copy (joinery-data.json.bak) is kept next to it in the app data folder.</p>
      </div>
    );
  }
  if (!store) return <div className="fatal">Loading…</div>;
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
