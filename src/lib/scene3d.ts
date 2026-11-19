// The 3D view of a drawn layout, as plain shapes in millimetres so it can be
// tested without a browser. Plan x / y are the floor; z is the height above it.
import type { DrawnCabinet, DrawnLayout, Pt, Unit } from '../types';
import { DOOR_GAP, fronts, normalise } from './cabinet';
import { offOf, roomOf, wallRun, walls, wallShapes, worktopRuns, type WallSeg, WALL_HEIGHT } from './layout';
import { FRONT_THICKNESS, KIND_SHORT } from './run';

export type SolidKind = 'carcass' | 'front' | 'plinth' | 'worktop' | 'handle';

/**
 * A box standing on the floor plan: its back-left-bottom corner, the plan
 * direction of its width (`u`) and of its depth (`n`, into the room), and its size.
 */
export interface Solid {
  kind: SolidKind;
  o: Pt & { z: number };
  u: Pt;
  n: Pt;
  w: number;
  h: number;
  d: number;
  /** The drawn cabinet it belongs to, for picking. */
  id?: string;
}

/** A block wall: its outline on plan, raised from the floor to the wall height. */
export interface WallPrism { pts: Pt[]; height: number; wall: number }

/** A readable label placed in 3D. */
export interface Tag { at: Pt & { z: number }; lines: string[]; kind: 'cabinet' | 'dim' | 'level'; id?: string }

/** A dimension line drawn on the floor, with its value as a tag. */
export interface DimLine3 { a: Pt & { z: number }; b: Pt & { z: number }; tick: Pt; text: string }

export interface Scene3 {
  walls: WallPrism[];
  solids: Solid[];
  tags: Tag[];
  dims: DimLine3[];
  /** Plan bounds and tallest point, for fitting the camera. */
  min: Pt; max: Pt; top: number;
}

const p3 = (p: Pt, z: number) => ({ x: p.x, y: p.y, z });
const along = (w: WallSeg, t: number, d: number): Pt => ({ x: w.a.x + w.u.x * t + w.n.x * d, y: w.a.y + w.u.y * t + w.n.y * d });

/** Size as a joiner reads it: width × height × depth. */
export const sizeText = (c: DrawnCabinet) => `${Math.round(c.width)} × ${Math.round(c.top - c.bottom)} × ${Math.round(c.depth)}`;

/** Everything in a cabinet: carcass, plinth, fronts and handles, in its wall's frame. */
function cabinetSolids(w: WallSeg, c: DrawnCabinet, unit: Unit | undefined): Solid[] {
  const off = offOf(c);
  const origin = (t: number, d: number, z: number) => p3(along(w, c.x + t, off + d), z);
  const box = (kind: SolidKind, t: number, d: number, z: number, bw: number, bh: number, bd: number): Solid =>
    ({ kind, o: origin(t, d, z), u: w.u, n: w.n, w: bw, h: bh, d: bd, id: c.id });
  const out: Solid[] = [box('carcass', 0, 0, c.bottom, c.width, c.top - c.bottom, c.depth)];
  if (c.layer !== 'wall' && c.bottom > 0) out.push(box('plinth', 0, 0, 0, c.width, c.bottom, Math.max(50, c.depth - 50)));
  if (!unit) return out;

  const u = normalise(unit);
  const f = fronts(u);
  const g = DOOR_GAP;
  const z = (fromTop: number, hgt: number) => c.top - fromTop - hgt; // bottom of a front measured down from the top
  const front = (t: number, fromTop: number, fw: number, fh: number) => box('front', t, c.depth, z(fromTop, fh), fw, fh, FRONT_THICKNESS);
  const hz = (t: number, fromTop: number, fw: number, fh: number) => { // horizontal handle centred near the top of a drawer
    const len = Math.min(160, fw / 3);
    return box('handle', t + fw / 2 - len / 2, c.depth + FRONT_THICKNESS, z(fromTop, Math.min(fh / 2, 50)) - 6, len, 12, 22);
  };

  if (f.drawer) { out.push(front(g, g, f.drawer.w, f.drawer.h)); out.push(hz(g, g, f.drawer.w, f.drawer.h)); }
  if (f.pack) {
    for (let i = 0; i < f.pack.n; i++) {
      const top = i * f.pack.pitch + g;
      out.push(front(g, top, f.pack.w, f.pack.h));
      out.push(hz(g, top, f.pack.w, f.pack.h));
    }
  }
  for (let i = 0; i < f.doors; i++) {
    const t = g + i * (f.doorW + 2 * g);
    const top = u.drawerHeight + g;
    out.push(front(t, top, f.doorW, f.doorH));
    // Vertical handle on the opening edge: near the top on base units, near the bottom on wall units.
    const hingeLeft = i % 2 === 0;
    const len = Math.min(160, f.doorH / 3);
    const ht = hingeLeft ? t + f.doorW - 46 : t + 34;
    const hzTop = c.layer === 'wall' ? top + f.doorH - 50 - len : top + 50;
    out.push(box('handle', ht, c.depth + FRONT_THICKNESS, z(hzTop, len), 12, len, 22));
  }
  return out;
}

/** Builds the 3D view: walls, cabinets with their fronts, worktops, labels and floor dimensions. */
export function buildScene(l: DrawnLayout, units: Map<string, Unit>): Scene3 {
  const room = roomOf(l);
  const ws = walls(room);
  const wallH = room.height ?? WALL_HEIGHT;
  const scene: Scene3 = { walls: [], solids: [], tags: [], dims: [], min: { x: 0, y: 0 }, max: { x: 0, y: 0 }, top: wallH };

  for (const s of wallShapes(room).solids) scene.walls.push({ pts: s.pts, height: wallH, wall: s.w.i });

  for (const w of ws) {
    const run = wallRun(l, w.i);
    for (const c of run.cabinets) {
      const unit = units.get(c.id);
      scene.solids.push(...cabinetSolids(w, c, unit));
      const off = offOf(c);
      const face = along(w, c.x + c.width / 2, off + c.depth + FRONT_THICKNESS + 30);
      const lines = [unit?.code ?? '', sizeText(c)];
      lines.push(c.layer === 'base' ? KIND_SHORT[c.kind] : c.layer === 'wall' ? `from floor ${Math.round(c.bottom)}` : 'Tall unit');
      scene.tags.push({ at: p3(face, (c.bottom + c.top) / 2), lines, kind: 'cabinet', id: c.id });
    }
    for (const r of worktopRuns(run)) {
      const d = r.depth + FRONT_THICKNESS + l.overhang;
      scene.solids.push({ kind: 'worktop', o: p3(along(w, r.x, r.off), r.top), u: w.u, n: w.n, w: r.to - r.x, h: l.worktop, d });
      scene.tags.push({ at: p3(along(w, r.to, r.off + d), r.top + l.worktop), lines: [`Worktop ${Math.round(r.top + l.worktop)}`], kind: 'level' });
    }

    // Floor dimensions in front of the cabinets: each floor unit's width, then the whole wall.
    const floor = run.cabinets.filter((c) => c.layer !== 'wall' && offOf(c) === 0).sort((a, b) => a.x - b.x);
    const reach = Math.max(600, ...run.cabinets.filter((c) => c.layer !== 'wall').map((c) => offOf(c) + c.depth + FRONT_THICKNESS + l.overhang));
    const dim = (t0: number, t1: number, d: number) => {
      if (t1 - t0 < 1) return;
      scene.dims.push({ a: p3(along(w, t0, d), 2), b: p3(along(w, t1, d), 2), tick: w.n, text: String(Math.round(t1 - t0)) });
    };
    for (const c of floor) dim(c.x, c.x + c.width, reach + 200);
    if (w.len > 0) dim(0, w.len, reach + 450);
  }

  const pts = [...room.chains.flatMap((ch) => ch.points), ...scene.solids.map((s) => s.o)];
  if (pts.length) {
    scene.min = { x: Math.min(...pts.map((p) => p.x)) - 600, y: Math.min(...pts.map((p) => p.y)) - 600 };
    scene.max = { x: Math.max(...pts.map((p) => p.x)) + 600, y: Math.max(...pts.map((p) => p.y)) + 1200 };
  }
  scene.top = Math.max(wallH, ...l.cabinets.map((c) => c.top));
  return scene;
}
