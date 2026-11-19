import type { Part, Settings, Unit } from '../types';

export const RAIL_WIDTH = 100;
export const DOOR_GAP = 2; // reveal on each side of a front
export const MAX_DOOR_WIDTH = 700;
export const MAX_DRAWERS = 6;

/** Drawers in a drawer unit, 0 when the unit is not one. */
export function drawerCount(u: Unit): number {
  return Math.min(MAX_DRAWERS, Math.max(0, Math.round(u.drawers || 0)));
}

/** Number of doors: an explicit count, -1 for an open unit, 0 for automatic. */
export function doorCount(u: Unit): number {
  if (drawerCount(u) > 0 || u.doors < 0) return 0;
  if (u.doors > 0) return u.doors;
  return u.width > MAX_DOOR_WIDTH ? 2 : 1;
}

/** Clamp a unit into a buildable range so drawing and parts never go negative. */
export function normalise(u: Unit): Unit {
  const width = Math.max(150, u.width || 0);
  const height = Math.max(150, u.height || 0);
  const depth = Math.max(100, u.depth || 0);
  return {
    ...u,
    width,
    height,
    depth,
    qty: Math.max(1, Math.round(u.qty || 1)),
    plinth: Math.max(0, u.plinth || 0),
    drawers: drawerCount(u),
    // A drawer unit has no top drawer or shelves; its fronts fill the height.
    drawerHeight: drawerCount(u) > 0 ? 0 : Math.min(Math.max(0, u.drawerHeight || 0), height - 100),
    shelves: drawerCount(u) > 0 ? 0 : Math.max(0, Math.round(u.shelves || 0)),
  };
}

function hingesPerDoor(doorHeight: number): number {
  if (doorHeight <= 900) return 2;
  if (doorHeight <= 1600) return 3;
  return 4;
}

/** Front sizes, shared by the parts list, drawing and hardware counts. */
export function fronts(raw: Unit) {
  const u = normalise(raw);
  const n = doorCount(u);
  const doorW = n > 0 ? Math.round((u.width - DOOR_GAP * 2 - (n - 1) * DOOR_GAP * 2) / n) : 0;
  const doorH = u.height - u.drawerHeight - DOOR_GAP * 2;
  const drawer = u.drawerHeight > 0 ? { w: u.width - DOOR_GAP * 2, h: u.drawerHeight - DOOR_GAP * 2 } : null;
  // Drawer unit: equal fronts top to bottom, each with a gap all round.
  const dn = drawerCount(u);
  const pack = dn > 0 ? { n: dn, w: u.width - DOOR_GAP * 2, h: Math.floor(u.height / dn) - DOOR_GAP * 2, pitch: u.height / dn } : null;
  return { doors: n, doorW, doorH, drawer, pack, hinges: n * hingesPerDoor(doorH) };
}

/**
 * Parts for one unit (quantities already multiplied by unit.qty).
 * Construction: sides run full height; panels fit between the sides;
 * base units get two top rails, wall units a full top and bottom,
 * tall units a full top and bottom; grooved back panel.
 */
export function unitParts(raw: Unit, settings: Settings): Part[] {
  const u = normalise(raw);
  const T = settings.materials.carcass.thickness;
  const B = settings.materials.back.thickness;
  const F = settings.materials.front.thickness;
  const inner = u.width - 2 * T;
  const front: Part['edges'] = [true, false, false, false];
  const all: Part['edges'] = [true, true, true, true];
  const none: Part['edges'] = [false, false, false, false];
  const parts: Omit<Part, 'key' | 'unitId' | 'unitCode'>[] = [];

  parts.push({ name: 'Side', qty: 2, length: u.height, width: u.depth, thickness: T, role: 'carcass', edges: front });
  if (u.type === 'base') {
    parts.push({ name: 'Bottom', qty: 1, length: inner, width: u.depth, thickness: T, role: 'carcass', edges: front });
    parts.push({ name: 'Top rail', qty: 2, length: inner, width: RAIL_WIDTH, thickness: T, role: 'carcass', edges: front });
  } else {
    parts.push({ name: 'Top / bottom', qty: 2, length: inner, width: u.depth, thickness: T, role: 'carcass', edges: front });
  }
  if (u.shelves > 0) {
    parts.push({ name: 'Shelf', qty: u.shelves, length: inner - 1, width: u.depth - 40, thickness: T, role: 'carcass', edges: front });
  }
  parts.push({ name: 'Back', qty: 1, length: u.height - 12, width: u.width - 24, thickness: B, role: 'back', edges: none });

  const f = fronts(u);
  if (f.drawer) parts.push({ name: 'Drawer front', qty: 1, length: f.drawer.w, width: f.drawer.h, thickness: F, role: 'front', edges: all });
  if (f.pack) parts.push({ name: 'Drawer front', qty: f.pack.n, length: f.pack.w, width: f.pack.h, thickness: F, role: 'front', edges: all });
  if (f.doors > 0) parts.push({ name: 'Door', qty: f.doors, length: f.doorH, width: f.doorW, thickness: F, role: 'front', edges: all });

  return parts.map((p, i) => ({
    ...p,
    qty: p.qty * u.qty,
    key: `${u.id}:${i}`,
    unitId: u.id,
    unitCode: u.code,
  }));
}

export function projectParts(units: Unit[], settings: Settings): Part[] {
  return units.flatMap((u) => unitParts(u, settings));
}

/** Banded edge length of a part line in mm (all pieces). */
export function edgeLength(p: Part): number {
  const [l1, l2, w1, w2] = p.edges;
  return p.qty * ((Number(l1) + Number(l2)) * p.length + (Number(w1) + Number(w2)) * p.width);
}

export function partArea(p: Part): number {
  return p.qty * p.length * p.width;
}

/** Hardware quantities for the whole project. */
export function hardwareCounts(units: Unit[]) {
  let hinges = 0, runners = 0, handles = 0, legs = 0, pins = 0, fittings = 0, hangers = 0, drawers = 0;
  for (const raw of units) {
    const u = normalise(raw);
    const f = fronts(u);
    const q = u.qty;
    hinges += f.hinges * q;
    const nd = (f.drawer ? 1 : 0) + (f.pack?.n ?? 0);
    runners += nd * q;
    drawers += nd * q;
    handles += (f.doors + nd) * q;
    if (u.plinth > 0) legs += (u.width > 1000 ? 6 : 4) * q;
    pins += u.shelves * 4 * q;
    fittings += q;
    if (u.type === 'wall') hangers += q;
  }
  return { hinges, runners, handles, legs, pins, fittings, hangers, drawers };
}
