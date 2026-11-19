// Draw plan mode of the Build page. Block walls are drawn as one continuous
// line in any direction; cabinets stand along those walls, each with an exact
// start/end along its wall and bottom/top level above the floor.
import type { DrawnCabinet, DrawnLayer, DrawnLayout, Project, Pt, Room, RunConfig, Settings, SlotKind, Unit, WallChain } from '../types';
import { buildGeometry, createSketch, type Geometry } from './drawing';
import { nextCode, uid } from './defaults';
import { baseSpec, DEFAULT_DRAWERS, FRONT_THICKNESS, resolveRun, type ResolvedSlot } from './run';
import type { RunViews } from './runDrawing';

export const LAYER_LABEL: Record<DrawnLayer, string> = { base: 'Base', wall: 'Wall unit', tall: 'Tall' };
export const MIN_WIDTH = 100;
export const WALL_THICKNESS = 150;
export const WALL_HEIGHT = 2700;
export const WALL_THICKNESSES = [100, 150, 200, 230, 250];

/** Starting size of a newly drawn cabinet of each kind. */
export const LAYER_DEFAULTS: Record<DrawnLayer, { depth: number; bottom: number; top: number }> = {
  base: { depth: 560, bottom: 100, top: 820 },
  wall: { depth: 320, bottom: 1450, top: 2170 },
  tall: { depth: 560, bottom: 100, top: 2200 },
};

export const EMPTY_LAYOUT: DrawnLayout = { length: 3000, worktop: 38, overhang: 20, cabinets: [] };
/** A fresh drawing for a new project: no walls and no cabinets, ready for the walls to be drawn. */
export const BLANK_LAYOUT: DrawnLayout = { ...EMPTY_LAYOUT, room: { chains: [], thickness: WALL_THICKNESS, height: WALL_HEIGHT } };
/** True when walls have been drawn (or the single straight wall is in use). */
export const hasWalls = (l: DrawnLayout) => walls(roomOf(l)).length > 0;

const end = (c: DrawnCabinet) => c.x + c.width;
const wallOf = (c: DrawnCabinet) => c.wall ?? 0;
/** Gap from the wall face to the back of a cabinet. */
export const offOf = (c: DrawnCabinet) => Math.max(0, c.offset ?? 0);

// ---- Room walls -------------------------------------------------------------

/** A room in the current shape, reading drawings saved when walls were a single line. */
export function normaliseRoom(r: Room): Room {
  if (Array.isArray(r.chains)) return r;
  const chains = r.points && r.points.length >= 2 ? [{ points: r.points, closed: Boolean(r.closed), flip: r.flip }] : [];
  return { chains, thickness: r.thickness || WALL_THICKNESS, height: r.height ?? WALL_HEIGHT };
}

/** The drawn room, or a single straight wall of the layout's length. */
export function roomOf(l: DrawnLayout): Room {
  return l.room
    ? normaliseRoom(l.room)
    : { chains: [{ points: [{ x: 0, y: 0 }, { x: l.length, y: 0 }], closed: false }], thickness: WALL_THICKNESS, height: WALL_HEIGHT };
}

export interface WallSeg {
  /** Index across the whole room; cabinets refer to walls by it. */
  i: number;
  /** Which run of walls, and which wall in that run. */
  c: number;
  j: number;
  /** Left and right ends as seen from inside the room, so positions run left to right like the elevation. */
  a: Pt;
  b: Pt;
  len: number;
  /** Unit vector along the wall, a → b. */
  u: Pt;
  /** Unit normal from the wall face into the room. */
  n: Pt;
  /** Direction the wall was drawn in (corner j → corner j + 1), for its angle. */
  drawn: Pt;
  /** Corners at the drawn start and end. */
  p0: Pt;
  p1: Pt;
}

const segCount = (ch: WallChain) => (ch.closed && ch.points.length > 2 ? ch.points.length : Math.max(0, ch.points.length - 1));

/** Is the room on the right of the run as drawn (screen y down)? */
function roomOnRight(ch: WallChain, cx: number, cy: number): boolean {
  const p = ch.points;
  let right: boolean;
  if (ch.closed && p.length > 2) {
    // A closed run encloses the room: clockwise on screen means the inside is on the right.
    let area = 0;
    for (let k = 0; k < p.length; k++) { const a = p[k], b = p[(k + 1) % p.length]; area += a.x * b.y - b.x * a.y; }
    right = area >= 0;
  } else {
    // An open run faces the middle of everything drawn; a lone straight wall faces down the page.
    let vote = 0;
    for (let k = 0; k < p.length - 1; k++) {
      const a = p[k], b = p[k + 1];
      vote += (cx - (a.x + b.x) / 2) * -(b.y - a.y) + (cy - (a.y + b.y) / 2) * (b.x - a.x);
    }
    right = vote >= -1;
  }
  return ch.flip ? !right : right;
}

/** Each straight wall of the room, with its direction and inside normal. */
export function walls(room: Room): WallSeg[] {
  const r = normaliseRoom(room);
  const all = r.chains.flatMap((ch) => ch.points);
  const cx = all.reduce((s, q) => s + q.x, 0) / Math.max(1, all.length);
  const cy = all.reduce((s, q) => s + q.y, 0) / Math.max(1, all.length);
  const out: WallSeg[] = [];
  r.chains.forEach((ch, c) => {
    const right = roomOnRight(ch, cx, cy);
    for (let j = 0; j < segCount(ch); j++) {
      const p0 = ch.points[j], p1 = ch.points[(j + 1) % ch.points.length];
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const drawn = len > 0 ? { x: (p1.x - p0.x) / len, y: (p1.y - p0.y) / len } : { x: 1, y: 0 };
      const [a, b, u] = right ? [p0, p1, drawn] : [p1, p0, { x: -drawn.x, y: -drawn.y }];
      out.push({ i: out.length, c, j, a, b, len: Math.round(len), u, n: { x: -u.y, y: u.x }, drawn, p0, p1 });
    }
  });
  return out;
}

/** Angle of a wall in degrees, anticlockwise from pointing right, as on paper. */
export const wallAngle = (w: WallSeg) => Math.round(((-Math.atan2(w.drawn.y, w.drawn.x) * 180) / Math.PI + 360) % 360 * 10) / 10;

const withChain = (room: Room, c: number, fn: (ch: WallChain) => WallChain): Room => {
  const r = normaliseRoom(room);
  return { ...r, chains: r.chains.map((ch, k) => (k === c ? fn(ch) : ch)) };
};
/** The wall that closes a closed run can't be set directly; it follows the others. */
export const isClosingWall = (room: Room, w: WallSeg) => {
  const ch = normaliseRoom(room).chains[w.c];
  return Boolean(ch?.closed && w.j === ch.points.length - 1);
};

/** Room with wall i set to an exact length; the walls after it in its run move with its end. */
export function setWallLength(room: Room, i: number, len: number): Room {
  const w = walls(room)[i];
  if (!w || isClosingWall(room, w)) return room;
  const dx = w.drawn.x * len - (w.p1.x - w.p0.x), dy = w.drawn.y * len - (w.p1.y - w.p0.y);
  return withChain(room, w.c, (ch) => ({ ...ch, points: ch.points.map((q, k) => (k > w.j ? { x: q.x + dx, y: q.y + dy } : q)) }));
}

/** Room with wall i turned to an exact angle; the walls after it in its run turn with it. */
export function setWallAngle(room: Room, i: number, deg: number): Room {
  const w = walls(room)[i];
  if (!w || isClosingWall(room, w)) return room;
  const d = ((wallAngle(w) - deg) * Math.PI) / 180; // screen y points down, so negate
  const cos = Math.cos(d), sin = Math.sin(d);
  return withChain(room, w.c, (ch) => ({
    ...ch,
    points: ch.points.map((q, k) => {
      if (k <= w.j) return q;
      const x = q.x - w.p0.x, y = q.y - w.p0.y;
      return { x: w.p0.x + x * cos - y * sin, y: w.p0.y + x * sin + y * cos };
    }),
  }));
}

/** Room with one corner moved (dragging a wall end). */
export function moveCorner(room: Room, c: number, k: number, p: Pt): Room {
  return withChain(room, c, (ch) => ({ ...ch, points: ch.points.map((q, m) => (m === k ? p : q)) }));
}

/** Room with a run of walls added, or run `c` replaced. */
export function putChain(room: Room, ch: WallChain, c?: number): Room {
  const r = normaliseRoom(room);
  return c === undefined ? { ...r, chains: [...r.chains, ch] } : { ...r, chains: r.chains.map((x, k) => (k === c ? ch : x)) };
}

/** Room with wall i taken out; its run is split (or opened, if it was closed) where it was. */
export function deleteWall(room: Room, i: number): Room {
  const w = walls(room)[i];
  if (!w) return room;
  const r = normaliseRoom(room);
  const ch = r.chains[w.c];
  const p = ch.points;
  let parts: Pt[][];
  if (ch.closed && p.length > 2) parts = [[...p.slice(w.j + 1), ...p.slice(0, w.j + 1)]];
  else parts = [p.slice(0, w.j + 1), p.slice(w.j + 1)];
  const chains = parts.filter((q) => q.length >= 2).map((points) => ({ points, closed: false, flip: ch.flip }));
  return { ...r, chains: [...r.chains.slice(0, w.c), ...chains, ...r.chains.slice(w.c + 1)] };
}

/** Room with run c's inside swapped to the other side. */
export const flipChain = (room: Room, c: number): Room => withChain(room, c, (ch) => ({ ...ch, flip: !ch.flip }));

/** Where two lines cross (each a point and a direction), or null when parallel. */
function cross(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-6) return null;
  const s = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den;
  return { x: p.x + d.x * s, y: p.y + d.y * s };
}

/**
 * A run of walls moved sideways by `dist` (positive towards the room), with
 * mitred corners. Used for the outer face and to place walls drawn by centre line or outer face.
 */
export function offsetChain(ch: WallChain, segs: WallSeg[], dist: number): Pt[] {
  const p = ch.points, n = p.length;
  return p.map((q, k) => {
    const before = segs.find((s) => s.j === (k - 1 + n) % n && (ch.closed || k > 0));
    const after = segs.find((s) => s.j === k && (ch.closed || k < n - 1));
    const off = (s: WallSeg) => ({ x: s.p0.x + s.n.x * dist, y: s.p0.y + s.n.y * dist });
    if (before && after) {
      const x = cross(off(before), before.drawn, off(after), after.drawn);
      if (x && Math.hypot(x.x - q.x, x.y - q.y) < Math.abs(dist) * 6 + 1) return x;
    }
    const s = after ?? before;
    return s ? { x: q.x + s.n.x * dist, y: q.y + s.n.y * dist } : q;
  });
}

/**
 * Places a run drawn along its centre line or outer face so that the stored
 * points are the inside face, as for every other wall.
 */
export function chainFromLocation(room: Room, ch: WallChain, location: WallLocation): WallChain {
  if (location === 'inside' || ch.points.length < 2) return ch;
  const r = putChain(room, ch);
  const c = r.chains.length - 1;
  const segs = walls(r).filter((s) => s.c === c);
  const dist = location === 'centre' ? r.thickness / 2 : r.thickness;
  return { ...ch, points: offsetChain(ch, segs, dist).map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) })) };
}

export type WallLocation = 'inside' | 'centre' | 'outside';
export const LOCATION_LABEL: Record<WallLocation, string> = { inside: 'Inside face', centre: 'Centre line', outside: 'Outside face' };

/** The block of every wall, mitred at corners, plus the outer face line of each run. */
export function wallShapes(room: Room): { solids: { w: WallSeg; pts: Pt[] }[]; outer: Pt[][] } {
  const r = normaliseRoom(room);
  const ws = walls(r);
  const solids: { w: WallSeg; pts: Pt[] }[] = [];
  const outer: Pt[][] = [];
  r.chains.forEach((ch, c) => {
    const segs = ws.filter((s) => s.c === c);
    if (!segs.length) return;
    const out = offsetChain(ch, segs, -r.thickness);
    for (const s of segs) {
      const k1 = (s.j + 1) % ch.points.length;
      solids.push({ w: s, pts: [ch.points[s.j], ch.points[k1], out[k1], out[s.j]] });
    }
    outer.push(ch.closed && ch.points.length > 2 ? [...out, out[0]] : out);
  });
  return { solids, outer };
}

/**
 * After walls are added, removed or split, put each cabinet back on the wall
 * that now runs along the same line, measuring from that wall's left end.
 */
export function remapCabinets(before: Room, after: Room, cabinets: DrawnCabinet[]): DrawnCabinet[] {
  const old = walls(before), now = walls(after);
  return cabinets.flatMap((c) => {
    const w = old[wallOf(c)];
    if (!w) return [c];
    const s = at(w, c.x), e = at(w, end(c)), m = at(w, c.x + c.width / 2);
    const hit = now.find((v) => {
      const o = onWall(v, m);
      return Math.abs(o.d) < 1 && o.t > -1 && o.t < v.len + 1 && Math.abs(v.u.x * w.u.x + v.u.y * w.u.y) > 0.999 && v.n.x * w.n.x + v.n.y * w.n.y > 0;
    });
    if (!hit) return []; // its wall was deleted
    const t0 = onWall(hit, s).t, t1 = onWall(hit, e).t;
    return [{ ...c, wall: hit.i, x: Math.round(Math.min(t0, t1)) }];
  });
}

/** Where a point falls against a wall: distance along it and distance out into the room. */
export function onWall(w: WallSeg, p: Pt) {
  const dx = p.x - w.a.x, dy = p.y - w.a.y;
  return { t: dx * w.u.x + dy * w.u.y, d: dx * w.n.x + dy * w.n.y };
}

/** Point at distance t along a wall and d into the room. */
export const at = (w: WallSeg, t: number, d = 0): Pt => ({ x: w.a.x + w.u.x * t + w.n.x * d, y: w.a.y + w.u.y * t + w.n.y * d });

/** Corner points of a cabinet on the plan (back left, back right, front right, front left). */
export function footprint(w: WallSeg, c: DrawnCabinet, extra = 0): Pt[] {
  const o = offOf(c);
  return [at(w, c.x, o), at(w, end(c), o), at(w, end(c), o + c.depth + extra), at(w, c.x, o + c.depth + extra)];
}

// ---- Cabinets along a wall --------------------------------------------------

/** One wall as a straight run: its length and the cabinets standing against it. */
export function wallRun(l: DrawnLayout, i: number): DrawnLayout {
  const w = walls(roomOf(l))[i];
  return { ...l, length: w ? w.len : 0, cabinets: l.cabinets.filter((c) => wallOf(c) === i) };
}

/** Cabinets between the given levels on the same wall. */
const blockers = (l: DrawnLayout, bottom: number, top: number, except?: string, near = 0, far = Infinity) =>
  l.cabinets.filter((c) => c.id !== except && c.bottom < top && bottom < c.top && offOf(c) < far && near < offOf(c) + c.depth);

/**
 * The free stretch of a wall run around x for a cabinet between the given levels,
 * or null when x is inside an existing cabinet there.
 */
export function freeSpan(run: DrawnLayout, x: number, bottom: number, top: number, except?: string, near = 0, far = Infinity): { from: number; to: number } | null {
  let from = 0, to = run.length;
  for (const c of blockers(run, bottom, top, except, near, far)) {
    if (x > c.x && x < end(c)) return null;
    if (end(c) <= x) from = Math.max(from, end(c));
    else to = Math.min(to, c.x);
  }
  return x < 0 || x > run.length ? null : { from, to };
}

/**
 * Positions along wall i worth snapping to: its ends, edges of its cabinets, and
 * the depth of cabinets on the walls either side, so runs meet neatly at corners.
 */
export function snapEdges(l: DrawnLayout, i: number, except?: string): number[] {
  const ws = walls(roomOf(l));
  const w = ws[i];
  if (!w) return [];
  const out = [0, w.len];
  for (const c of l.cabinets) {
    if (c.id === except) continue;
    if (wallOf(c) === i) { out.push(c.x, end(c)); continue; }
    const o = ws[wallOf(c)];
    if (!o) continue;
    for (const q of footprint(o, c)) {
      const { t, d } = onWall(w, q);
      if (t > 0 && t < w.len && Math.abs(d) < 1500) out.push(Math.round(t));
    }
  }
  return out;
}

/**
 * Where a cabinet being moved can go: wall `wall`, its left edge wanted at `want`.
 * Either edge snaps to 10 mm or to nearby edges, then it is kept clear of the
 * cabinets either side. Returns null when it does not fit there.
 */
export function placeMoved(l: DrawnLayout, c: DrawnCabinet, wall: number, want: number, tol: number, offset = offOf(c)):
  { x: number; from: number; to: number; clash: boolean } | null {
  const w = walls(roomOf(l))[wall];
  if (!w) return null;
  const edges = snapEdges(l, wall, c.id);
  const a = snap(want, edges, tol), b = snap(want + c.width, edges, tol) - c.width;
  const near = (v: number) => edges.some((e) => Math.abs(e - v) <= tol);
  let x = near(want) || !near(want + c.width) ? a : b;
  if (near(want) && near(want + c.width)) x = Math.abs(a - want) <= Math.abs(b - want) ? a : b;
  const run = wallRun(l, wall);
  const span = freeSpan(run, Math.min(Math.max(x + c.width / 2, 0), w.len), c.bottom, c.top, c.id, offset, offset + c.depth);
  if (span && span.to - span.from >= c.width) {
    // Room for it: a small overlap stops it against the neighbour or the wall end.
    const into = Math.max(span.from - x, x + c.width - span.to, 0);
    if (into <= Math.min(c.width / 3, 200)) {
      x = Math.min(Math.max(x, span.from), span.to - c.width);
      return { x: Math.round(x), from: span.from, to: span.to, clash: false };
    }
  }
  // No clear space here: put it where it is dragged and let the overlap show, as Revit does.
  x = Math.min(Math.max(x, 0), Math.max(0, w.len - c.width));
  return { x: Math.round(x), from: span?.from ?? NaN, to: span?.to ?? NaN, clash: true };
}

/** Round to 10 mm, or onto a nearby edge within `tol` mm. */
export function snap(x: number, edges: number[], tol: number): number {
  let best = Math.round(x / 10) * 10, d = tol;
  for (const e of edges) if (Math.abs(e - x) <= d) { best = e; d = Math.abs(e - x); }
  return best;
}

/** A new cabinet of a layer between two points along wall `wall`. */
export function newCabinet(layer: DrawnLayer, x1: number, x2: number, wall = 0, kind: SlotKind = 'standard'): DrawnCabinet {
  const d = LAYER_DEFAULTS[layer];
  return {
    id: uid(), layer, wall, x: Math.min(x1, x2), width: Math.abs(x2 - x1), depth: d.depth, bottom: d.bottom, top: d.top,
    kind: layer === 'base' ? kind : 'doors',
    ...(layer === 'base' && kind === 'drawers' ? { drawers: DEFAULT_DRAWERS } : {}),
  };
}

/** Do two convex outlines overlap by more than a millimetre? */
function overlaps(p: Pt[], q: Pt[]): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const nx = -(b.y - a.y), ny = b.x - a.x;
      const len = Math.hypot(nx, ny) || 1;
      const proj = (pts: Pt[]) => pts.map((r) => (r.x * nx + r.y * ny) / len);
      const pp = proj(p), qq = proj(q);
      if (Math.max(...pp) <= Math.min(...qq) + 1 || Math.max(...qq) <= Math.min(...pp) + 1) return false;
    }
  }
  return true;
}

/** Problems that stop the cabinets from being created, worded for the user. */
export function layoutErrors(l: DrawnLayout, codes: Map<string, string>): string[] {
  const errors: string[] = [];
  const name = (c: DrawnCabinet) => codes.get(c.id) ?? LAYER_LABEL[c.layer];
  const ws = walls(roomOf(l));
  const many = ws.length > 1;
  if (ws.every((w) => w.len < MIN_WIDTH)) errors.push(l.room ? 'Draw at least one wall.' : `Enter a wall length of at least ${MIN_WIDTH} mm.`);
  for (const c of l.cabinets) {
    const w = ws[wallOf(c)];
    if (!w) { errors.push(`${name(c)} is on a wall that is no longer drawn.`); continue; }
    if (c.width < MIN_WIDTH) errors.push(`${name(c)} is ${c.width} mm wide; make it at least ${MIN_WIDTH} mm.`);
    if (c.top - c.bottom < 150) errors.push(`${name(c)}: the top level must be at least 150 mm above the bottom level.`);
    if (c.bottom < 0) errors.push(`${name(c)}: the bottom level cannot be below the floor.`);
    if (c.depth < 100) errors.push(`${name(c)}: depth must be at least 100 mm.`);
    if (c.x < 0 || end(c) > w.len) errors.push(`${name(c)} runs past the end of ${many ? `wall ${w.i + 1}` : 'the wall'} (${c.x}–${end(c)} on a ${w.len} mm wall).`);
  }
  const placed = l.cabinets.filter((c) => ws[wallOf(c)]);
  placed.forEach((a, i) => placed.slice(i + 1).forEach((b) => {
    if (!(a.bottom < b.top && b.bottom < a.top)) return;
    const clash = wallOf(a) === wallOf(b)
      ? a.x < end(b) && b.x < end(a) && offOf(a) < offOf(b) + b.depth && offOf(b) < offOf(a) + a.depth
      : overlaps(footprint(ws[wallOf(a)], a), footprint(ws[wallOf(b)], b));
    if (clash) errors.push(`${name(a)} and ${name(b)} overlap${wallOf(a) !== wallOf(b) ? ' at the corner' : ''}.`);
  }));
  return errors;
}

const ORDER: Record<DrawnLayer, number> = { base: 0, tall: 1, wall: 2 };
/** Cabinets in creation order: wall by wall, base and tall first, then wall units, each left to right. */
export const sorted = (l: DrawnLayout) =>
  [...l.cabinets].sort((a, b) => wallOf(a) - wallOf(b) || ORDER[a.layer] - ORDER[b.layer] || a.x - b.x);

function unitFor(c: DrawnCabinet): Omit<Unit, 'id' | 'code'> {
  const height = Math.round(c.top - c.bottom);
  const common = { qty: 1, width: Math.round(c.width), height, depth: Math.round(c.depth), doors: 0, doorStyle: 'shaker' as const, source: 'build' as const };
  if (c.layer === 'wall') return { ...common, name: 'Wall cabinet', type: 'wall', plinth: 0, drawerHeight: 0, shelves: height > 500 ? 2 : 1 };
  if (c.layer === 'tall') return { ...common, name: 'Tall unit', type: 'tall', plinth: Math.round(c.bottom), drawerHeight: 0, shelves: Math.max(1, Math.round(height / 450)) };
  return { ...common, ...baseSpec(c.kind, c.drawers ?? DEFAULT_DRAWERS), type: 'base', plinth: Math.round(c.bottom) };
}

/** Units for the drawn cabinets, coded after the units being kept, keyed by cabinet id. */
export function layoutUnits(l: DrawnLayout, keep: Unit[]): Map<string, Unit> {
  const all: Unit[] = [...keep];
  const out = new Map<string, Unit>();
  for (const c of sorted(l)) {
    const u = unitFor(c);
    const unit: Unit = { ...u, id: uid(), code: nextCode(all, u.type) };
    all.push(unit);
    out.set(c.id, unit);
  }
  return out;
}

/** The project's units with earlier Build cabinets replaced by the drawn ones. */
export function applyLayout(units: Unit[], l: DrawnLayout): Unit[] {
  const keep = units.filter((u) => u.source !== 'build');
  return [...keep, ...layoutUnits(l, keep).values()];
}

const sig = (u: Pick<Unit, 'type' | 'name' | 'width' | 'height' | 'depth' | 'plinth' | 'drawerHeight' | 'drawers' | 'doors' | 'shelves'>) =>
  [u.type, u.name, u.width, u.height, u.depth, u.plinth, u.drawerHeight, u.drawers ?? 0, u.doors, u.shelves].join(':');

/** True when the project already holds exactly the cabinets this drawing would create. */
export function isLayoutApplied(units: Unit[], l: DrawnLayout): boolean {
  const current = units.filter((u) => u.source === 'build').map(sig);
  const wanted = sorted(l).map((c) => sig(unitFor(c)));
  return current.length === wanted.length && current.every((s, i) => s === wanted[i]);
}

/** A drawing of an existing wall-length run, so it can be adjusted by hand. */
export function runToLayout(c: RunConfig, slots: ResolvedSlot[]): DrawnLayout {
  const baseTop = c.plinth + c.baseHeight;
  const cabinets: DrawnCabinet[] = slots.map((s) => ({
    id: uid(), layer: 'base', wall: 0, x: s.x, width: s.width, depth: c.baseDepth, bottom: c.plinth, top: baseTop, kind: s.kind,
    ...(s.kind === 'drawers' ? { drawers: s.drawers } : {}),
  }));
  if (c.wall) {
    for (const s of slots) {
      cabinets.push({ id: uid(), layer: 'wall', wall: 0, x: s.x, width: s.width, depth: c.wallDepth, bottom: c.wallBottom, top: c.wallBottom + c.wallHeight, kind: 'doors' });
    }
  }
  return { length: c.length, worktop: c.worktop, overhang: c.overhang, cabinets };
}

// ---- Drawings ---------------------------------------------------------------

const NOMINAL = 520;

/** Runs of touching base cabinets on one wall run, which share one worktop. */
export function worktopRuns(run: DrawnLayout): { x: number; to: number; top: number; depth: number; off: number }[] {
  const base = run.cabinets.filter((c) => c.layer === 'base').sort((a, b) => offOf(a) - offOf(b) || a.x - b.x);
  const runs: { x: number; to: number; top: number; depth: number; off: number }[] = [];
  for (const c of base) {
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.to - c.x) < 1 && last.off === offOf(c)) {
      last.to = end(c); last.top = Math.max(last.top, c.top); last.depth = Math.max(last.depth, c.depth);
    } else runs.push({ x: c.x, to: end(c), top: c.top, depth: c.depth, off: offOf(c) });
  }
  return runs;
}

/** Height dimensions up the right: a chain through every level plus the overall height. */
function levelChain(sk: ReturnType<typeof createSketch>, levels: number[], xFace: number, ids?: string[]) {
  const { k } = sk;
  const ls = [...new Set([0, ...levels.map(Math.round)])].sort((a, b) => a - b);
  const xr = xFace + 30 * k, xr2 = xr + 40 * k;
  const ed = (lo: number, hi: number): DimEdit | undefined => (ids ? { kind: 'level', lo, hi, ids } : undefined);
  for (let i = 1; i < ls.length; i++) sk.vdim(xr, -ls[i], -ls[i - 1], ls[i] - ls[i - 1], ed(ls[i - 1], ls[i]));
  const top = ls[ls.length - 1];
  if (top > 0) sk.vdim(xr2, -top, 0, top, ed(0, top));
  for (const y of ls) sk.seg(xFace + 4 * k, -y, xr2 + 6 * k, -y, 'ext');
}

function allLevels(run: DrawnLayout, cabs: DrawnCabinet[]): number[] {
  const wt = worktopRuns(run).filter((r) => cabs.some((c) => c.layer === 'base' && c.x >= r.x && end(c) <= r.to));
  return [...cabs.flatMap((c) => [c.bottom, c.top]), ...wt.map((r) => r.top + run.worktop)];
}

/** Width chain along the elevation at height y. */
function widthChain(sk: ReturnType<typeof createSketch>, cabs: DrawnCabinet[], y: number, extFrom: number) {
  const { k } = sk;
  for (const c of cabs) {
    sk.hdim(c.x, end(c), y, c.width, { kind: 'width', id: c.id } satisfies DimEdit);
    for (const x of [c.x, end(c)]) sk.seg(x, extFrom, x, y + Math.sign(y - extFrom) * 6 * k, 'ext');
  }
}

/** Front view of one wall run, each cabinet at its own levels, against the wall up to its height. */
function elevation(run: DrawnLayout, units: Map<string, Unit>, settings: Settings, wallH: number, wallIndex = 0): Geometry {
  const L = run.length;
  const cabs = sorted(run);
  const levels = allLevels(run, cabs);
  const H = Math.max(wallH, ...levels);
  const sk = createSketch(Math.max(L, H) / NOMINAL);
  const { k } = sk;

  sk.seg(-60 * k, 0, L + 60 * k, 0, 'floor');
  sk.seg(0, 0, 0, -wallH, 'thin');
  sk.seg(L, 0, L, -wallH, 'thin');
  sk.seg(0, -wallH, L, -wallH, 'thin');
  for (const c of cabs) {
    const u = units.get(c.id);
    if (!u) continue;
    sk.place(buildGeometry(u, 'front', settings), c.x, -c.top);
    const ly = c.layer === 'wall' ? -c.top - 14 * k : 16 * k;
    sk.note(c.x + c.width / 2, ly, u.code, 11);
  }
  for (const r of worktopRuns(run)) sk.box(r.x, -(r.top + run.worktop), r.to - r.x, run.worktop, 'worktop');

  const floor = cabs.filter((c) => c.layer !== 'wall');
  const wall = cabs.filter((c) => c.layer === 'wall');
  widthChain(sk, floor, 44 * k, 4 * k);
  sk.hdim(0, L, 80 * k, L, { kind: 'wallLength', wall: wallIndex } satisfies DimEdit);
  sk.seg(0, 4 * k, 0, 86 * k, 'ext');
  sk.seg(L, 4 * k, L, 86 * k, 'ext');
  if (wall.length) {
    const top = Math.max(...wall.map((c) => c.top));
    widthChain(sk, wall, -top - 40 * k, -top - 4 * k);
  }
  levelChain(sk, [...levels, wallH], L, cabs.map((c) => c.id));
  return sk.finish();
}

/** Room plan: block walls, worktops and every cabinet, with lengths and cabinet widths. */
function plan(l: DrawnLayout, units: Map<string, Unit>): Geometry {
  const room = roomOf(l);
  const ws = walls(room);
  const pts = room.chains.flatMap((ch) => ch.points);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const span = pts.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 2000) : 2000;
  const sk = createSketch((span + 1200) / NOMINAL);
  const { k } = sk;

  // Walls as Revit draws them: hatched block, inside and outside face lines, square ends on open runs.
  const shapes = wallShapes(room);
  for (const s of shapes.solids) sk.poly(s.pts, 'poche');
  for (const s of shapes.solids) sk.seg(s.pts[0].x, s.pts[0].y, s.pts[1].x, s.pts[1].y, 'outline');
  shapes.outer.forEach((o) => { for (let q = 1; q < o.length; q++) sk.seg(o[q - 1].x, o[q - 1].y, o[q].x, o[q].y, 'outline'); });
  room.chains.forEach((ch, c) => {
    if (ch.closed || ch.points.length < 2) return;
    const o = shapes.outer[c];
    const first = ch.points[0], last = ch.points[ch.points.length - 1];
    if (o) { sk.seg(first.x, first.y, o[0].x, o[0].y, 'outline'); sk.seg(last.x, last.y, o[o.length - 1].x, o[o.length - 1].y, 'outline'); }
  });
  for (const w of ws) {
    const run = wallRun(l, w.i);
    for (const r of worktopRuns(run)) {
      const d = r.off + r.depth + FRONT_THICKNESS + l.overhang;
      sk.poly([at(w, r.x, r.off), at(w, r.to, r.off), at(w, r.to, d), at(w, r.x, d)], 'worktop');
    }
    for (const c of sorted(run)) {
      const code = units.get(c.id)?.code ?? '';
      const fp = footprint(w, c, c.layer === 'wall' ? 0 : FRONT_THICKNESS);
      sk.poly(fp, c.layer === 'tall' ? 'carcass' : 'hidden');
      if (c.layer === 'tall') { sk.seg(fp[0].x, fp[0].y, fp[2].x, fp[2].y, 'thin'); sk.seg(fp[1].x, fp[1].y, fp[3].x, fp[3].y, 'thin'); }
      const m = at(w, c.x + c.width / 2, offOf(c) + (c.layer === 'wall' ? Math.min(c.depth / 2, 120) : Math.max(c.depth * 0.7, 200)));
      sk.note(m.x, m.y, code, c.layer === 'wall' ? 10 : 11);
    }

    // Lengths outside the walls; cabinet widths inside, past the deepest cabinet.
    const left = { x: w.u.y, y: -w.u.x }; // the side adim draws on
    const outSign = left.x * w.n.x + left.y * w.n.y > 0 ? -1 : 1;
    if (w.len > 0) sk.adim(w.a.x, w.a.y, w.b.x, w.b.y, outSign * (room.thickness + 30 * k), w.len, { kind: 'wallLength', wall: w.i } satisfies DimEdit);
    const floor = run.cabinets.filter((c) => c.layer !== 'wall').sort((a, b) => a.x - b.x);
    const deep = Math.max(0, ...run.cabinets.map((c) => offOf(c) + c.depth + (c.layer === 'wall' ? 0 : FRONT_THICKNESS + l.overhang)));
    for (const c of floor) {
      const p = at(w, c.x), q = at(w, end(c));
      sk.adim(p.x, p.y, q.x, q.y, -outSign * (deep + 30 * k), c.width, { kind: 'width', id: c.id } satisfies DimEdit);
    }
    const wallUnits = run.cabinets.filter((c) => c.layer === 'wall');
    for (const c of wallUnits) {
      const p = at(w, c.x), q = at(w, end(c));
      sk.adim(p.x, p.y, q.x, q.y, -outSign * (deep + 64 * k), c.width, { kind: 'width', id: c.id } satisfies DimEdit);
    }
    if (ws.length > 1) {
      const m = at(w, w.len / 2, -room.thickness - 70 * k);
      sk.note(m.x, m.y, `WALL ${w.i + 1}`, 10);
    }
  }
  return sk.finish();
}

/** Side section at a point along one wall run, through every cabinet there. */
function section(run: DrawnLayout, units: Map<string, Unit>, settings: Settings, pos: number, wallH: number, wallT: number): Geometry {
  const cabs = run.cabinets.filter((c) => pos >= c.x && pos <= end(c));
  const levels = allLevels(run, cabs);
  const H = Math.max(wallH, ...levels);
  const runs = worktopRuns(run).filter((r) => pos >= r.x && pos <= r.to);
  const D = Math.max(600, ...cabs.map((c) => offOf(c) + c.depth), ...runs.map((r) => r.off + r.depth + FRONT_THICKNESS + run.overhang));
  const sk = createSketch(Math.max(H, D + 400) / NOMINAL);
  const { k } = sk;

  sk.box(-wallT, -wallH, wallT, wallH, 'wallmass');
  sk.seg(-wallT, 0, D + 150, 0, 'floor');
  for (const c of cabs) {
    const u = units.get(c.id);
    if (u) sk.place(buildGeometry(u, 'side', settings), offOf(c), -c.top, c.depth);
  }
  for (const r of runs) sk.box(r.off, -(r.top + run.worktop), r.depth + FRONT_THICKNESS + run.overhang, run.worktop, 'worktop');
  let row = 30;
  for (const c of cabs.filter((x) => x.layer !== 'wall')) {
    const o = offOf(c);
    if (o > 0) { sk.hdim(0, o, row * k, o, { kind: 'offset', id: c.id } satisfies DimEdit); row += 34; }
    sk.hdim(o, o + c.depth, row * k, c.depth, { kind: 'depth', id: c.id } satisfies DimEdit);
    sk.seg(o + c.depth, 4 * k, o + c.depth, (row + 6) * k, 'ext');
    row += 34;
  }
  for (const r of runs) {
    const wd = r.depth + FRONT_THICKNESS + run.overhang;
    sk.hdim(r.off, r.off + wd, row * k, wd, { kind: 'worktopDepth', depth: r.depth } satisfies DimEdit);
    sk.seg(r.off + wd, -r.top, r.off + wd, (row + 6) * k, 'ext');
  }
  for (const c of cabs.filter((x) => x.layer === 'wall')) {
    const o = offOf(c);
    sk.hdim(o, o + c.depth, -c.top - 28 * k, c.depth, { kind: 'depth', id: c.id } satisfies DimEdit);
    sk.seg(o + c.depth, -c.top - 4 * k, o + c.depth, -c.top - 34 * k, 'ext');
  }
  if (cabs.length === 0) sk.note(D / 2, -H / 2, 'No cabinet here', 14);
  levelChain(sk, [...levels, wallH], D, cabs.map((c) => c.id));
  return sk.finish();
}

/** Room plan, elevation of one wall, and a section through one cabinet (or the middle of that wall). */
export function layoutDrawings(l: DrawnLayout, units: Map<string, Unit>, settings: Settings, elevationWall: number, sectionCab?: DrawnCabinet): RunViews {
  const sw = sectionCab ? wallOf(sectionCab) : elevationWall;
  const srun = wallRun(l, sw);
  const room = roomOf(l);
  const wallH = room.height ?? WALL_HEIGHT;
  return {
    plan: plan(l, units),
    elevation: elevation(wallRun(l, elevationWall), units, settings, wallH, elevationWall),
    section: section(srun, units, settings, sectionCab ? sectionCab.x + sectionCab.width / 2 : srun.length / 2, wallH, room.thickness),
  };
}

// ---- Editing dimensions -----------------------------------------------------

/** What a dimension on a drawing controls, so typing a new value can change the drawing. */
export type DimEdit =
  | { kind: 'wallLength'; wall: number }
  | { kind: 'width'; id: string }
  | { kind: 'depth'; id: string }
  | { kind: 'offset'; id: string }
  | { kind: 'worktopDepth'; depth: number }
  /** A step in a height chain, from level lo to level hi, in a view showing cabinets `ids`. */
  | { kind: 'level'; lo: number; hi: number; ids: string[] };

export const isDimEdit = (x: unknown): x is DimEdit => typeof x === 'object' && x !== null && 'kind' in x;

/**
 * The layout with a dimension set to a new value, as Revit does: the far end
 * moves and whatever hangs off it moves too.
 * - wall length: the wall's end moves and the walls after it follow;
 * - cabinet width: its right end moves and the cabinets touching it on that side shift along;
 * - depth / gap from wall / worktop depth: that cabinet or the worktop overhang changes;
 * - a height step: the upper level moves, with everything at or above it.
 */
export function applyDimEdit(l: DrawnLayout, e: DimEdit, value: number): DrawnLayout {
  const v = Math.round(value);
  if (!Number.isFinite(v)) return l;
  const cab = (id: string) => l.cabinets.find((c) => c.id === id);
  switch (e.kind) {
    case 'wallLength': {
      if (v < MIN_WIDTH) return l;
      if (!l.room) return { ...l, length: v };
      return { ...l, room: setWallLength(roomOf(l), e.wall, v) };
    }
    case 'width': {
      const c = cab(e.id);
      if (!c || v < MIN_WIDTH) return l;
      const delta = v - c.width;
      // Cabinets that butt up on the right, in a chain, move along with the edge.
      const moved = new Set<string>();
      let edge = end(c);
      for (;;) {
        const next = l.cabinets.find((o) => !moved.has(o.id) && o.id !== c.id && wallOf(o) === wallOf(c) && Math.abs(o.x - edge) < 1
          && o.bottom < c.top && c.bottom < o.top && offOf(o) === offOf(c));
        if (!next) break;
        moved.add(next.id);
        edge = end(next);
      }
      return { ...l, cabinets: l.cabinets.map((o) => (o.id === c.id ? { ...o, width: v } : moved.has(o.id) ? { ...o, x: o.x + delta } : o)) };
    }
    case 'depth': {
      if (v < 100) return l;
      return { ...l, cabinets: l.cabinets.map((o) => (o.id === e.id ? { ...o, depth: v } : o)) };
    }
    case 'offset': {
      if (v < 0) return l;
      return { ...l, cabinets: l.cabinets.map((o) => (o.id === e.id ? { ...o, offset: v } : o)) };
    }
    case 'worktopDepth': {
      const overhang = v - e.depth - FRONT_THICKNESS;
      return overhang < 0 ? l : { ...l, overhang };
    }
    case 'level': {
      const delta = v - (e.hi - e.lo);
      if (!delta || v <= 0) return l;
      const hi = e.hi;
      const room = roomOf(l);
      const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
      let worktop = l.worktop;
      // The worktop's top is a level of its own: change the worktop thickness.
      const wtTop = l.cabinets.some((c) => e.ids.includes(c.id) && c.layer === 'base' && near(c.top + l.worktop, hi));
      if (wtTop) worktop = Math.max(1, l.worktop + delta);
      const cabinets = l.cabinets.map((c) => {
        if (!e.ids.includes(c.id)) return c;
        if (c.bottom >= hi - 0.5) return { ...c, bottom: c.bottom + delta, top: c.top + delta };
        if (near(c.top, hi)) return { ...c, top: c.top + delta }; // its top is the level being moved
        // A unit that spans past the level (a tall unit) stays as it is.
        return c;
      });
      const height = (room.height ?? WALL_HEIGHT) >= hi - 0.5 ? (room.height ?? WALL_HEIGHT) + delta : room.height;
      return { ...l, worktop, cabinets, ...(l.room ? { room: { ...normaliseRoom(l.room), height } } : {}) };
    }
  }
}

/**
 * A project's drawing. Projects made before the plan could be drawn have only a
 * wall-length run; that run becomes the drawing so nothing is lost.
 */
export function layoutOf(p: Project): DrawnLayout {
  if (p.layout) return p.layout;
  if (p.run) {
    const r = resolveRun(p.run);
    if (r.errors.length === 0) return runToLayout(p.run, r.slots);
  }
  return BLANK_LAYOUT;
}

