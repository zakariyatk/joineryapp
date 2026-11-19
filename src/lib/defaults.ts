import type { AppData, Project, Settings, Unit, UnitType } from '../types';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// Placeholder prices — the user sets their own in Settings.
export const DEFAULT_SETTINGS: Settings = {
  company: 'Your Joinery Co.',
  currency: '₹',
  materials: {
    carcass: { name: '18 mm MR MDF', thickness: 18, sheetLength: 2440, sheetWidth: 1220, price: 2400, grain: false },
    front: { name: '18 mm MDF paint grade', thickness: 18, sheetLength: 2440, sheetWidth: 1220, price: 2900, grain: false },
    back: { name: '6 mm HDF', thickness: 6, sheetLength: 2440, sheetWidth: 1220, price: 650, grain: false },
  },
  edgeBandPrice: 12,
  edgeWaste: 10,
  kerf: 4,
  trim: 10,
  hardware: { hinge: 120, runner: 650, handle: 180, leg: 45, shelfPin: 3, fittings: 350, wallHanger: 220 },
  labourRates: { cutting: 600, edging: 450, assembly: 450, finishing: 700, install: 500 },
};

export interface Template {
  label: string;
  type: UnitType;
  name: string;
  width: number;
  height: number;
  depth: number;
  plinth: number;
  drawerHeight: number;
  shelves: number;
  doors: number;
}

export const TEMPLATES: Template[] = [
  { label: 'Base cabinet', type: 'base', name: 'Base cabinet', width: 600, height: 720, depth: 560, plinth: 100, drawerHeight: 140, shelves: 1, doors: 0 },
  { label: 'Sink base', type: 'base', name: 'Sink base', width: 800, height: 720, depth: 560, plinth: 100, drawerHeight: 0, shelves: 0, doors: 2 },
  { label: 'Wall cabinet', type: 'wall', name: 'Wall cabinet', width: 600, height: 720, depth: 320, plinth: 0, drawerHeight: 0, shelves: 2, doors: 0 },
  { label: 'Tall unit', type: 'tall', name: 'Tall pantry', width: 600, height: 2100, depth: 560, plinth: 100, drawerHeight: 0, shelves: 4, doors: 0 },
  { label: 'Wardrobe', type: 'tall', name: 'Wardrobe', width: 1200, height: 2300, depth: 600, plinth: 100, drawerHeight: 0, shelves: 2, doors: 2 },
  { label: 'Open shelving', type: 'tall', name: 'Open shelving', width: 800, height: 1800, depth: 300, plinth: 0, drawerHeight: 0, shelves: 4, doors: -1 },
];

const PREFIX: Record<UnitType, string> = { base: 'B', wall: 'W', tall: 'T' };

export function nextCode(units: Unit[], type: UnitType): string {
  const p = PREFIX[type];
  let n = 1;
  const used = new Set(units.map((u) => u.code));
  while (used.has(p + n)) n++;
  return p + n;
}

export function unitFromTemplate(t: Template, existing: Unit[]): Unit {
  return {
    id: uid(),
    code: nextCode(existing, t.type),
    name: t.name,
    type: t.type,
    qty: 1,
    width: t.width,
    height: t.height,
    depth: t.depth,
    plinth: t.plinth,
    drawerHeight: t.drawerHeight,
    shelves: t.shelves,
    doors: t.doors,
    doorStyle: 'shaker',
  };
}

export function newProject(name: string, client: string): Project {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name,
    client,
    status: 'Drafting',
    createdAt: now,
    updatedAt: now,
    units: [],
    // Build starts as a blank drawing: walls first, then cabinets.
    buildMode: 'draw',
    layout: { length: 3000, worktop: 38, overhang: 20, cabinets: [], room: { chains: [], thickness: 150, height: 2700 } },
    estimate: { overhead: 10, margin: 25, tax: 18, overrides: {}, extras: [] },
  };
}

/** One row of the "Add units" dialog: a unit of the chosen template with its own size. */
export interface UnitRow {
  name: string;
  width: number;
  height: number;
  depth: number;
  qty: number;
}

export const SIZE_LIMITS = {
  width: { min: 150, max: 3000 },
  height: { min: 150, max: 3000 },
  depth: { min: 100, max: 1200 },
  qty: { min: 1, max: 999 },
} as const;

/** Problems with a row, keyed by field; empty when the row is valid. */
export function rowErrors(r: UnitRow): Partial<Record<keyof UnitRow, string>> {
  const e: Partial<Record<keyof UnitRow, string>> = {};
  if (!r.name.trim()) e.name = 'Name is required';
  for (const k of ['width', 'height', 'depth', 'qty'] as const) {
    const { min, max } = SIZE_LIMITS[k];
    if (!Number.isFinite(r[k]) || r[k] < min || r[k] > max) e[k] = `${min}–${max}`;
  }
  return e;
}

/** Parse "300, 450 600;900" into widths. Returns null if any entry is not a number. */
export function parseWidths(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  const nums = parts.map(Number);
  return nums.every((n) => Number.isFinite(n) && n > 0) ? nums.map((n) => Math.round(n)) : null;
}

/**
 * Create one unit per row from a template, each with its own size, giving
 * each the next free code (B1, B2…) after the units already in the project.
 */
export function unitsFromRows(t: Template, rows: UnitRow[], existing: Unit[]): Unit[] {
  const created: Unit[] = [];
  for (const r of rows) {
    const u = unitFromTemplate(t, [...existing, ...created]);
    created.push({
      ...u,
      name: r.name.trim(),
      width: r.width,
      height: r.height,
      depth: r.depth,
      qty: Math.round(r.qty),
      // Keep the template's drawer from swallowing a short carcass.
      drawerHeight: Math.min(u.drawerHeight, Math.max(0, r.height - 100)),
    });
  }
  return created;
}

/** First-run data: one sample kitchen so every screen has something to show. */
export function sampleData(): AppData {
  const p = newProject('Kitchen – sample', 'Sample client');
  const units: Unit[] = [];
  units.push(unitFromTemplate(TEMPLATES[0], units));
  units.push(unitFromTemplate(TEMPLATES[1], units));
  units.push(unitFromTemplate(TEMPLATES[2], units));
  p.units = units;
  return { version: 1, settings: structuredClone(DEFAULT_SETTINGS), projects: [p] };
}
