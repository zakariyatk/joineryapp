import type { RunConfig, RunSlot, SlotKind, Unit } from '../types';
import { nextCode, uid } from './defaults';

export const DEFAULT_RUN: RunConfig = {
  length: 3000,
  maxWidth: 600,
  count: null,
  slots: [],
  baseHeight: 720,
  baseDepth: 560,
  plinth: 100,
  worktop: 38,
  overhang: 20,
  wall: true,
  wallHeight: 720,
  wallDepth: 320,
  wallBottom: 1450,
};

export const WIDTH_MIN = 150;
export const WIDTH_MAX = 1200;
const DRAWER_HEIGHT = 140;
const FRONT_THICKNESS = 18;

export const KIND_LABEL: Record<SlotKind, string> = {
  standard: 'Normal base unit (drawer + door)',
  drawers: 'Drawer base unit',
  pullout: 'Pull-out drawer base unit',
  bin: 'Trash bin drawer base unit',
  sink: 'Sink cabinet base unit',
  door1: 'Single door base unit',
  door2: 'Double door base unit',
  doors: 'Doors only (count automatic)',
};
/** Short names for tables. */
export const KIND_SHORT: Record<SlotKind, string> = {
  standard: 'Normal', drawers: 'Drawers', pullout: 'Pull-out', bin: 'Bin pull-out', sink: 'Sink', door1: 'Single door', door2: 'Double door', doors: 'Doors',
};
/** The base unit kinds offered for new cabinets, in menu order. */
export const BASE_KINDS: SlotKind[] = ['standard', 'drawers', 'pullout', 'bin', 'sink', 'door1', 'door2'];
/** Usual width of each kind, used when a unit is placed with a single click. */
export const KIND_WIDTH: Record<SlotKind, number> = { standard: 600, drawers: 600, pullout: 300, bin: 450, sink: 900, door1: 450, door2: 800, doors: 600 };
export const DEFAULT_DRAWERS = 3;

/** How each kind of base unit is built: its name, fronts and shelves. */
export function baseSpec(kind: SlotKind, drawers = DEFAULT_DRAWERS): Pick<Unit, 'name' | 'drawerHeight' | 'shelves' | 'doors'> & { drawers?: number } {
  switch (kind) {
    case 'drawers': return { name: `${drawers}-drawer base unit`, drawerHeight: 0, shelves: 0, doors: 0, drawers };
    // A pull-out is one full-height front on runners; a bin pull-out is the same box holding bins.
    case 'pullout': return { name: 'Pull-out base unit', drawerHeight: 0, shelves: 0, doors: 0, drawers: 1 };
    case 'bin': return { name: 'Bin pull-out base unit', drawerHeight: 0, shelves: 0, doors: 0, drawers: 1 };
    case 'sink': return { name: 'Sink base unit', drawerHeight: 0, shelves: 0, doors: 2 };
    case 'door1': return { name: 'Single door base unit', drawerHeight: 0, shelves: 1, doors: 1 };
    case 'door2': return { name: 'Double door base unit', drawerHeight: 0, shelves: 1, doors: 2 };
    case 'doors': return { name: 'Door base', drawerHeight: 0, shelves: 1, doors: 0 };
    default: return { name: 'Base cabinet', drawerHeight: DRAWER_HEIGHT, shelves: 1, doors: 0 };
  }
}

export interface ResolvedSlot {
  width: number;
  kind: SlotKind;
  drawers: number; // drawers in a 'drawers' cabinet, else 0
  fixed: boolean;
  x: number; // left edge from the start of the run
}

export interface ResolvedRun {
  slots: ResolvedSlot[];
  errors: string[];
}

/** Cabinet count: the user's choice, or enough cabinets to keep each within max width. */
export function slotCount(c: RunConfig): number {
  if (c.count && c.count > 0) return Math.round(c.count);
  return Math.max(1, Math.ceil(c.length / Math.max(WIDTH_MIN, c.maxWidth)));
}

/** Slot settings for every cabinet position, padding with defaults. */
export function slotsFor(c: RunConfig): RunSlot[] {
  const n = slotCount(c);
  return Array.from({ length: n }, (_, i) => c.slots[i] ?? { width: null, kind: 'standard' });
}

/**
 * Split the run length into cabinet widths. Fixed widths are kept; the rest
 * share what is left equally in whole millimetres, any leftover millimetres
 * going one each to the first free cabinets so the total is exact.
 */
export function resolveRun(c: RunConfig): ResolvedRun {
  const errors: string[] = [];
  const slots = slotsFor(c);
  if (!(c.length >= WIDTH_MIN)) errors.push(`Enter a wall length of at least ${WIDTH_MIN} mm.`);

  const fixedSum = slots.reduce((a, s) => a + (s.width ?? 0), 0);
  const free = slots.filter((s) => s.width === null).length;
  const rest = c.length - fixedSum;
  const each = free > 0 ? Math.floor(rest / free) : 0;
  let extra = free > 0 ? rest - each * free : 0;

  if (free === 0 && rest !== 0) {
    errors.push(`Fixed widths add up to ${fixedSum} mm but the wall is ${c.length} mm (${rest > 0 ? `${rest} mm left over` : `${-rest} mm too long`}). Clear one width so it can fill the gap.`);
  } else if (free > 0 && each < WIDTH_MIN) {
    errors.push(`Not enough length left for ${free} auto-width cabinet${free > 1 ? 's' : ''} (${Math.max(0, rest)} mm). Reduce the count or the fixed widths.`);
  }

  let x = 0;
  const resolved = slots.map((s) => {
    let w: number;
    if (s.width !== null) w = s.width;
    else {
      w = each + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
    }
    const r = { width: w, kind: s.kind, drawers: s.kind === 'drawers' ? s.drawers ?? DEFAULT_DRAWERS : 0, fixed: s.width !== null, x };
    x += w;
    return r;
  });
  resolved.forEach((s, i) => {
    if (s.width < WIDTH_MIN || s.width > WIDTH_MAX) {
      if (s.fixed || errors.length === 0) errors.push(`Cabinet ${i + 1} is ${s.width} mm wide; keep widths between ${WIDTH_MIN} and ${WIDTH_MAX} mm.`);
    }
  });
  return { slots: resolved, errors };
}

/** Base (and optional wall) units for a resolved run, coded after the units being kept. */
export function runUnits(c: RunConfig, slots: ResolvedSlot[], keep: Unit[]): { base: Unit[]; wall: Unit[] } {
  const all: Unit[] = [...keep];
  const make = (u: Omit<Unit, 'id' | 'code'>): Unit => {
    const unit: Unit = { ...u, id: uid(), code: nextCode(all, u.type) };
    all.push(unit);
    return unit;
  };
  const base = slots.map((s) => make({
    ...baseSpec(s.kind, s.drawers || DEFAULT_DRAWERS),
    type: 'base', qty: 1, width: s.width, height: c.baseHeight, depth: c.baseDepth, plinth: c.plinth, doorStyle: 'shaker', source: 'build',
  }));
  const wall = c.wall
    ? slots.map((s) => make({
      name: 'Wall cabinet', type: 'wall', qty: 1, width: s.width, height: c.wallHeight, depth: c.wallDepth, plinth: 0,
      drawerHeight: 0, shelves: 2, doors: 0, doorStyle: 'shaker', source: 'build',
    }))
    : [];
  return { base, wall };
}

/** The project's units with earlier Build cabinets replaced by this run. */
export function applyRun(units: Unit[], c: RunConfig, slots: ResolvedSlot[]): Unit[] {
  const keep = units.filter((u) => u.source !== 'build');
  const { base, wall } = runUnits(c, slots, keep);
  return [...keep, ...base, ...wall];
}

const sig = (u: Unit) => [u.type, u.name, u.width, u.height, u.depth, u.plinth, u.drawerHeight, u.drawers ?? 0, u.doors, u.shelves].join(':');

/** True when the project already holds exactly the cabinets this run would create. */
export function isApplied(units: Unit[], c: RunConfig, slots: ResolvedSlot[]): boolean {
  const current = units.filter((u) => u.source === 'build').map(sig);
  const { base, wall } = runUnits(c, slots, []);
  const wanted = [...base, ...wall].map(sig);
  return current.length === wanted.length && current.every((s, i) => s === wanted[i]);
}

/** Overall front-to-back size of a base cabinet including the door. */
export const baseFrontDepth = (c: RunConfig) => c.baseDepth + FRONT_THICKNESS;
export { FRONT_THICKNESS };
