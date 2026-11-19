import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Geometry, Label } from '../lib/drawing';
import {
  at, chainFromLocation, footprint, freeSpan, LAYER_DEFAULTS, offOf, placeMoved, LAYER_LABEL, MIN_WIDTH, moveCorner, newCabinet, onWall, putChain, roomOf, snap,
  snapEdges, wallRun, walls, wallShapes, type WallLocation, type WallSeg,
} from '../lib/layout';
import { FRONT_THICKNESS, KIND_LABEL, KIND_WIDTH } from '../lib/run';
import type { DrawnCabinet, DrawnLayer, DrawnLayout, Pt, Room, SlotKind } from '../types';
import { DimInput, FitButton, usePanZoom, type ViewBox } from './PanZoom';
import { GeometryShapes } from './UnitDrawing';

export type DrawTool = 'select' | 'block' | DrawnLayer;
export type WallMode = 'line' | 'rect';

/** What is selected on the plan: cabinets by id and walls by index. */
export interface Selection { cabs: string[]; walls: number[] }
export const NOTHING: Selection = { cabs: [], walls: [] };

interface Props {
  layout: DrawnLayout;
  g: Geometry;
  tool: DrawTool;
  wallMode: WallMode;
  location: WallLocation;
  sel: Selection;
  /** Kind of base unit the Base tool draws. */
  baseKind: SlotKind;
  onSelect(s: Selection): void;
  onAdd(c: DrawnCabinet): void;
  onDeleteSelected(): void;
  /** A cabinet dragged to a new place: wall index, left edge along it and gap from the wall face. */
  onMoveCab(id: string, wall: number, x: number, offset: number): void;
  /** A dimension double-clicked and given a new value. */
  onEditDim(l: Label, v: number): void;
  /** New walls. `topology` is true when walls were added, removed or split (not just moved). */
  onRoom(room: Room, topology: boolean): void;
}

const ACCENT = '#B45309';
const GUIDE = '#2563EB';
const ANGLE_STEP = 15;
const ptsAttr = (p: Pt[]) => p.map((q) => `${q.x},${q.y}`).join(' ');
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const round10 = (p: Pt): Pt => ({ x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 });

function inside(poly: Pt[], p: Pt): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

interface Snapped { p: Pt; kind: 'end' | 'mid' | 'free'; gx?: number; gy?: number }

/**
 * Plan of the room. Select: click or window-drag to select walls and cabinets
 * (Ctrl/Shift adds), Delete removes them, drag a selected wall's end to move it.
 * Block wall: draw walls as a line or a rectangle, Revit style, with snaps and
 * typed lengths. Base / Wall unit / Tall: drag along a wall to add a cabinet.
 * The wheel zooms and the middle button pans in every tool.
 */
export function DrawPlan({ layout, g, tool, wallMode, location, sel, baseKind, onSelect, onAdd, onDeleteSelected, onMoveCab, onEditDim, onRoom }: Props) {
  const [editing, setEditing] = useState<Label | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const press = useRef<{
    clientX: number; clientY: number; p: Pt; wall: WallSeg | null; x0: number; span: { from: number; to: number } | null; add: boolean;
    /** Cabinet under the press, and where along its wall it was grabbed. */
    cab?: DrawnCabinet; grab?: number; grabD?: number;
    /** A wall pressed on with Select: dragging moves it. */
    wallDrag?: number;
  } | null>(null);
  const [moving, setMoving] = useState<{ c: DrawnCabinet; w: WallSeg; x: number; off: number; from: number; to: number; clash: boolean } | null>(null);
  const [wallMove, setWallMove] = useState<{ i: number; dn: number } | null>(null);
  const [draft, setDraft] = useState<{ w: WallSeg; x0: number; x1: number } | null>(null);
  const [line, setLine] = useState<Pt[] | null>(null); // wall run being drawn
  const [cont, setCont] = useState<{ c: number; atStart: boolean } | null>(null); // carrying on an existing run
  const [rectStart, setRectStart] = useState<Pt | null>(null);
  const [cursor, setCursor] = useState<Snapped | null>(null);
  const [typed, setTyped] = useState('');
  const [grip, setGrip] = useState<{ c: number; k: number; p: Pt } | null>(null);
  const [box, setBox] = useState<{ a: Pt; b: Pt } | null>(null); // window selection
  const room = roomOf(layout);
  const ws = walls(room);
  const shapes = wallShapes(room);
  const corners = room.chains.flatMap((ch) => ch.points);

  // Fitted frame: the drawing, with space to draw walls when there are few.
  let frame: ViewBox = g.bounds;
  if (tool === 'block' || ws.length === 0) {
    const all = [...corners, ...(line ?? [])];
    const minX = Math.min(frame.x, ...all.map((q) => q.x - 1500), -1000), minY = Math.min(frame.y, ...all.map((q) => q.y - 1500), -1000);
    const maxX = Math.max(frame.x + frame.w, ...all.map((q) => q.x + 1500), 6000), maxY = Math.max(frame.y + frame.h, ...all.map((q) => q.y + 1500), 4500);
    frame = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  const pz = usePanZoom(svg, frame);
  const { view } = pz;
  const kv = Math.max(view.w, view.h) / 520; // mm per nominal px in the current view

  const toMM = (e: { clientX: number; clientY: number }): Pt => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  // ---- Snapping (Revit style: endpoints, midpoints, alignment, angle steps) --------

  const snapPoint = (raw: Pt, from: Pt | null, shift: boolean, skip?: Pt): Snapped => {
    const px = pz.perPx();
    const pool = [...corners, ...(line ?? [])].filter((q) => q !== skip && q !== from);
    if (line && line.length >= 3 && dist(raw, line[0]) < 12 * px) return { p: line[0], kind: 'end' };
    for (const q of pool) if (dist(raw, q) < 12 * px) return { p: q, kind: 'end' };
    for (const w of ws) {
      const m = { x: (w.p0.x + w.p1.x) / 2, y: (w.p0.y + w.p1.y) / 2 };
      if (dist(raw, m) < 10 * px) return { p: m, kind: 'mid' };
    }
    let q: Pt;
    let axis: 'h' | 'v' | null = null;
    if (from && !shift) {
      let ang = Math.atan2(raw.y - from.y, raw.x - from.x);
      const deg = Math.round((ang * 180) / Math.PI / ANGLE_STEP) * ANGLE_STEP;
      ang = (deg * Math.PI) / 180;
      const len = Math.round(dist(raw, from) / 10) * 10;
      q = { x: Math.round(from.x + Math.cos(ang) * len), y: Math.round(from.y + Math.sin(ang) * len) };
      if (deg % 180 === 0) axis = 'h';
      else if (deg % 90 === 0) axis = 'v';
    } else q = shift ? { x: Math.round(raw.x), y: Math.round(raw.y) } : round10(raw);
    // Line up with other corners: dashed guides, as Revit's alignment lines.
    let gx: number | undefined, gy: number | undefined;
    for (const c of pool) {
      if (gx === undefined && axis !== 'v' && Math.abs(raw.x - c.x) < 8 * px) gx = c.x;
      if (gy === undefined && axis !== 'h' && Math.abs(raw.y - c.y) < 8 * px) gy = c.y;
    }
    if (gx !== undefined) q = { ...q, x: gx };
    if (gy !== undefined) q = { ...q, y: gy };
    return { p: q, kind: 'free', gx, gy };
  };

  // ---- Wall drawing -----------------------------------------------------------

  const resetLine = () => { setLine(null); setCont(null); setTyped(''); };

  const finishLine = (closed = false) => {
    const p = (line ?? []).filter((q, i, a) => i === 0 || dist(q, a[i - 1]) >= 1);
    if (p.length >= 2) {
      if (cont) {
        const pts = cont.atStart ? [...p].reverse() : p;
        const old = room.chains[cont.c];
        onRoom(putChain(room, { ...old, points: pts, closed: closed && pts.length >= 3 }, cont.c), true);
      } else {
        const ch = chainFromLocation(room, { points: p, closed: closed && p.length >= 3 }, location);
        onRoom(putChain(room, ch), true);
      }
    }
    resetLine();
  };

  const addCorner = (q: Pt) => {
    if (!line) return;
    if (line.length >= 3 && q === line[0]) { finishLine(true); return; }
    if (dist(q, line[line.length - 1]) < 1) return;
    setLine([...line, q]);
    setTyped('');
  };

  /** Open ends of runs, which a click carries on drawing from. */
  const openEnds = room.chains.flatMap((ch, c) => (ch.closed || ch.points.length < 2 ? [] : [
    { c, atStart: true, p: ch.points[0] }, { c, atStart: false, p: ch.points[ch.points.length - 1] },
  ]));

  // ---- Hit testing ------------------------------------------------------------

  const hitCabinet = (p: Pt): DrawnCabinet | undefined => {
    const hits = layout.cabinets.filter((c) => {
      const s = ws[c.wall ?? 0];
      return s && inside(footprint(s, c, c.layer === 'wall' ? 0 : FRONT_THICKNESS), p);
    });
    const pref = tool === 'select' || tool === 'block' ? null : tool;
    return hits.sort((a, b) => Number(b.layer === pref) - Number(a.layer === pref) || a.depth - b.depth)[0];
  };
  const hitWall = (p: Pt): number | null => {
    const px = pz.perPx();
    const s = shapes.solids.find((x) => inside(x.pts, p) || (() => { const o = onWall(x.w, p); return o.t >= 0 && o.t <= x.w.len && Math.abs(o.d) < 8 * px; })());
    return s ? s.w.i : null;
  };
  const wallAt = (p: Pt): WallSeg | null => {
    let best: WallSeg | null = null, bd = Infinity;
    for (const s of ws) {
      const o = onWall(s, p);
      if (o.t < -100 || o.t > s.len + 100 || o.d < -room.thickness || o.d > 1200) continue;
      const score = o.d < 0 ? -o.d + 200 : o.d;
      if (score < bd) { bd = score; best = s; }
    }
    return best;
  };

  const oneWall = sel.walls.length === 1 && sel.cabs.length === 0 ? ws[sel.walls[0]] : undefined;
  /** Grips: the two corners of a single selected wall. */
  const grips = oneWall ? [{ c: oneWall.c, k: oneWall.j, p: oneWall.p0 }, { c: oneWall.c, k: (oneWall.j + 1) % room.chains[oneWall.c].points.length, p: oneWall.p1 }] : [];

  const selectHit = (p: Pt, add: boolean) => {
    const c = hitCabinet(p);
    const w = c ? null : hitWall(p);
    if (!c && w === null) { if (!add) onSelect({ cabs: [], walls: [] }); return; }
    if (!add) { onSelect(c ? { cabs: [c.id], walls: [] } : { cabs: [], walls: [w!] }); return; }
    const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
    onSelect(c ? { ...sel, cabs: toggle(sel.cabs, c.id) } : { ...sel, walls: toggle(sel.walls, w!) });
  };

  const windowSelect = (a: Pt, b: Pt, add: boolean) => {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const inBox = (q: Pt) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
    // Left to right: things wholly inside. Right to left: anything touched (crossing), as in Revit.
    const crossing = b.x < a.x;
    const pick = (pts: Pt[]) => (crossing ? pts.some(inBox) || [{ x: x0, y: y0 }, { x: x1, y: y1 }].some((c) => inside(pts, c)) : pts.every(inBox));
    const cabs = layout.cabinets.filter((c) => { const s = ws[c.wall ?? 0]; return s && pick(footprint(s, c, c.layer === 'wall' ? 0 : FRONT_THICKNESS)); }).map((c) => c.id);
    const wl = shapes.solids.filter((s) => pick(s.pts)).map((s) => s.w.i);
    onSelect(add ? { cabs: [...new Set([...sel.cabs, ...cabs])], walls: [...new Set([...sel.walls, ...wl])] } : { cabs, walls: wl });
  };

  /** Room with wall i moved dn mm square to itself (both its corners move). */
  const movedWallRoom = (i: number, dn: number): Room => {
    const w = ws[i];
    const ch = room.chains[w.c];
    const k1 = (w.j + 1) % ch.points.length;
    const mv = (q: Pt) => ({ x: Math.round(q.x + w.n.x * dn), y: Math.round(q.y + w.n.y * dn) });
    return moveCorner(moveCorner(room, w.c, w.j, mv(ch.points[w.j])), w.c, k1, mv(ch.points[k1]));
  };

  const layer: DrawnLayer = tool === 'select' || tool === 'block' ? 'base' : tool;
  const d = LAYER_DEFAULTS[layer];

  // ---- Pointer and keys -------------------------------------------------------

  const down = (e: PointerEvent) => {
    if (pz.down(e)) return;
    if (e.button !== 0) return;
    svg.current?.focus();
    const p = toMM(e);
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    const px = pz.perPx();
    // A grip of the selected wall: drag it to move that corner.
    const gr = grips.find((q) => dist(q.p, p) < 10 * px);
    if (gr && (tool === 'select' || tool === 'block') && !line) {
      setGrip({ c: gr.c, k: gr.k, p: gr.p });
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    // Pressing on a cabinet (with Select or a cabinet tool) picks it up to move it.
    const hitC = tool !== 'block' ? hitCabinet(p) : undefined;
    if (hitC) {
      const hw = ws[hitC.wall ?? 0];
      const o = hw ? onWall(hw, p) : { t: 0, d: 0 };
      press.current = { clientX: e.clientX, clientY: e.clientY, p, wall: null, x0: 0, span: null, add, cab: hitC, grab: o.t - hitC.x, grabD: o.d - offOf(hitC) };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    // Pressing on a wall with Select: a click selects it, a drag moves it.
    const hw = tool === 'select' ? hitWall(p) : null;
    if (hw !== null) {
      press.current = { clientX: e.clientX, clientY: e.clientY, p, wall: null, x0: 0, span: null, add, wallDrag: hw };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    let wall: WallSeg | null = null, x0 = 0, span = null;
    if (tool !== 'select' && tool !== 'block') {
      wall = wallAt(p);
      if (wall) {
        x0 = snap(Math.min(Math.max(onWall(wall, p).t, 0), wall.len), snapEdges(layout, wall.i), 10 * px);
        span = freeSpan(wallRun(layout, wall.i), x0, d.bottom, d.top);
      }
    }
    press.current = { clientX: e.clientX, clientY: e.clientY, p, wall, x0, span, add };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const move = (e: PointerEvent) => {
    if (pz.move(e)) return;
    const p = toMM(e);
    if (grip) { setGrip({ ...grip, p: snapPoint(p, null, e.shiftKey, room.chains[grip.c].points[grip.k]).p }); return; }
    const s = press.current;
    const dragged = s && Math.hypot(e.clientX - s.clientX, e.clientY - s.clientY) >= 4;
    if (s?.cab && dragged) {
      // Any direction: along the wall and away from it. It stays with its own wall
      // unless dropped right against another one.
      const own = ws[s.cab.wall ?? 0];
      const near = wallAt(p);
      const switchTo = near && own && near.i !== own.i && onWall(near, p).d - (s.grabD ?? 0) < 150 ? near : null;
      const w = switchTo ?? own ?? near;
      if (!w) { setMoving(null); return; }
      const o = onWall(w, p);
      const same = w.i === (s.cab.wall ?? 0);
      const want = o.t - (same ? s.grab ?? 0 : s.cab.width / 2);
      // Gap from the wall: 10 mm steps, sticking to the wall when close. Shift keeps it where it is.
      let off = e.shiftKey && same ? offOf(s.cab) : Math.max(0, o.d - (same ? s.grabD ?? 0 : 0));
      if (!e.altKey) off = off < 100 ? 0 : Math.round(off / 10) * 10;
      else off = Math.round(off);
      const placed = placeMoved(layout, s.cab, w.i, e.altKey ? Math.round(want) : want, e.altKey ? 0 : 10 * pz.perPx(), off);
      if (placed) setMoving({ c: s.cab, w, off, ...placed });
      return;
    }
    if (s?.wallDrag !== undefined && dragged) {
      // Walls move square to themselves, like Revit; the walls joined to them stretch.
      const w = ws[s.wallDrag];
      if (w) {
        const dn = (p.x - s.p.x) * w.n.x + (p.y - s.p.y) * w.n.y;
        setWallMove({ i: w.i, dn: e.altKey ? Math.round(dn) : Math.round(dn / 10) * 10 });
      }
      return;
    }
    if (tool === 'select') { if (s && dragged) setBox({ a: s.p, b: p }); return; }
    if (tool === 'block') {
      if (wallMode === 'rect') setCursor(snapPoint(p, null, e.shiftKey));
      else if (line) setCursor(snapPoint(p, line[line.length - 1], e.shiftKey));
      else setCursor(snapPoint(p, null, e.shiftKey));
      return;
    }
    if (!s || !s.wall || !s.span || !dragged) return;
    const x1 = Math.min(Math.max(snap(onWall(s.wall, p).t, snapEdges(layout, s.wall.i), 10 * pz.perPx()), s.span.from), s.span.to);
    setDraft({ w: s.wall, x0: s.x0, x1 });
  };

  const up = (e: PointerEvent) => {
    if (pz.up(e)) return;
    if (grip) {
      const old = room.chains[grip.c].points[grip.k];
      if (dist(old, grip.p) >= 1) onRoom(moveCorner(room, grip.c, grip.k, grip.p), false);
      setGrip(null);
      return;
    }
    const s = press.current;
    press.current = null;
    const dr = draft, bx = box, mv = moving, wm = wallMove;
    setDraft(null); setBox(null); setMoving(null); setWallMove(null);
    if (!s) return;
    const clicked = Math.hypot(e.clientX - s.clientX, e.clientY - s.clientY) < 4;
    const p = toMM(e);
    if (s.cab) {
      if (clicked || !mv) { selectHit(p, s.add); return; }
      onMoveCab(s.cab.id, mv.w.i, mv.x, mv.off);
      if (!sel.cabs.includes(s.cab.id)) onSelect({ cabs: [s.cab.id], walls: [] });
      return;
    }
    if (s.wallDrag !== undefined) {
      if (clicked || !wm || !wm.dn) { selectHit(p, s.add); return; }
      onRoom(movedWallRoom(wm.i, wm.dn), false);
      onSelect({ cabs: [], walls: [wm.i] });
      return;
    }

    if (tool === 'select') {
      if (bx && !clicked) windowSelect(bx.a, bx.b, s.add);
      else selectHit(p, s.add);
      return;
    }
    if (tool === 'block') {
      if (!clicked) return;
      if (wallMode === 'rect') {
        const q = snapPoint(p, null, e.shiftKey).p;
        if (!rectStart) { setRectStart(q); return; }
        if (Math.abs(q.x - rectStart.x) >= MIN_WIDTH && Math.abs(q.y - rectStart.y) >= MIN_WIDTH) {
          const a = rectStart;
          const ch = chainFromLocation(room, { points: [a, { x: q.x, y: a.y }, q, { x: a.x, y: q.y }], closed: true }, location);
          onRoom(putChain(room, ch), true);
        }
        setRectStart(null);
        return;
      }
      if (line) { addCorner(snapPoint(p, line[line.length - 1], e.shiftKey).p); return; }
      const px = pz.perPx();
      const end = openEnds.find((o) => dist(o.p, p) < 12 * px);
      if (end && sel.walls.length) {
        const pts = room.chains[end.c].points;
        setLine(end.atStart ? [...pts].reverse() : pts);
        setCont({ c: end.c, atStart: end.atStart });
        return;
      }
      const w = hitWall(p);
      if (w !== null && !s.add) { onSelect({ cabs: [], walls: [w] }); return; }
      onSelect({ cabs: [], walls: [] });
      setLine([snapPoint(p, null, e.shiftKey).p]);
      return;
    }
    if (clicked && s.wall && s.span && !s.add) {
      // A single click on a wall drops in a unit of the usual width, centred on the click.
      const width = layer === 'base' ? KIND_WIDTH[baseKind] : 600;
      if (s.span.to - s.span.from >= width) {
        const x = Math.round(Math.min(Math.max(s.x0 - width / 2, s.span.from), s.span.to - width));
        onAdd(newCabinet(layer, x, x + width, s.wall.i, baseKind));
        return;
      }
    }
    if (clicked || !dr) { selectHit(p, s.add); return; }
    if (Math.abs(dr.x1 - dr.x0) >= MIN_WIDTH) onAdd(newCabinet(layer, dr.x0, dr.x1, dr.w.i, baseKind));
  };

  const key = (e: KeyboardEvent) => {
    if (tool === 'block' && (line || rectStart)) {
      if (rectStart && e.key === 'Escape') { e.preventDefault(); setRectStart(null); return; }
      if (!line) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); setTyped((t) => (t + e.key).slice(0, 6)); return; }
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (typed) setTyped((t) => t.slice(0, -1));
        else if (line.length > 1) setLine(line.slice(0, -1));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        const len = Number(typed);
        if (e.key === 'Enter' && typed && len > 0) {
          // Exact length in the direction the cursor shows (to the right before the mouse moves).
          const last = line[line.length - 1];
          const tgt = cursor && dist(cursor.p, last) > 0 ? cursor.p : { x: last.x + 1, y: last.y };
          const ang = Math.atan2(tgt.y - last.y, tgt.x - last.x);
          addCorner({ x: Math.round(last.x + Math.cos(ang) * len), y: Math.round(last.y + Math.sin(ang) * len) });
        } else finishLine(false); // Enter or Escape ends the run, keeping what is drawn
        return;
      }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && (sel.cabs.length || sel.walls.length)) { e.preventDefault(); onDeleteSelected(); return; }
    // Arrow keys nudge a selected cabinet along its wall: 10 mm, or 100 mm with Shift.
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && sel.cabs.length === 1 && !sel.walls.length) {
      const c = layout.cabinets.find((x) => x.id === sel.cabs[0]);
      if (!c) return;
      e.preventDefault();
      const step = (e.shiftKey ? 100 : 10) * (e.key === 'ArrowLeft' ? -1 : 1);
      const placed = placeMoved(layout, c, c.wall ?? 0, c.x + step, 0);
      if (placed && placed.x !== c.x) onMoveCab(c.id, c.wall ?? 0, placed.x, offOf(c));
      return;
    }
    // Up / down arrows move it away from or towards its wall.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && sel.cabs.length === 1 && !sel.walls.length) {
      const c = layout.cabinets.find((x) => x.id === sel.cabs[0]);
      const w = c && ws[c.wall ?? 0];
      if (!c || !w) return;
      e.preventDefault();
      const step = (e.shiftKey ? 100 : 10) * (e.key === 'ArrowUp' ? -1 : 1) * Math.sign(w.n.y || w.n.x || 1);
      onMoveCab(c.id, c.wall ?? 0, c.x, Math.max(0, offOf(c) + step));
    }
    if (e.key === 'Escape') onSelect({ cabs: [], walls: [] });
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && tool === 'select') {
      e.preventDefault();
      onSelect({ cabs: layout.cabinets.map((c) => c.id), walls: ws.map((w) => w.i) });
    }
  };

  // ---- Overlays ---------------------------------------------------------------

  const text = (tx: number, ty: number, s: string, size = 13, weight = 700, color = ACCENT) => (
    <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fontFamily="Segoe UI, sans-serif" fontSize={size * kv} fontWeight={weight}
      fill={color} stroke="#fff" strokeWidth={3 * kv} paintOrder="stroke" pointerEvents="none">{s}</text>
  );
  const last = line?.[line.length - 1];
  const preview = line && cursor && last ? cursor.p : null;
  const angleOf = (a: Pt, b: Pt) => Math.round(((-Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360);
  const help = tool === 'select'
    ? 'Click to select a wall or cabinet; Ctrl or Shift adds; drag a window to select several; Delete removes the selection; drag a cabinet to move it (it snaps to edges; hold Alt to skip snapping; arrow keys nudge); drag a selected wall end to move it.'
    : tool === 'block'
      ? wallMode === 'rect' ? 'Click two opposite corners to draw four walls.' : 'Click to place each corner; type a length and press Enter for an exact wall; Shift for any angle; Enter, Escape or double-click ends the run.'
      : `Drag along a wall to draw a ${layer === 'base' ? KIND_LABEL[baseKind].toLowerCase() : LAYER_LABEL[layer].toLowerCase()}, or click a wall to drop one in at the usual width; click a cabinet to select it.`;
  const gripPreview = grip ? room.chains[grip.c].points.map((q, k) => (k === grip.k ? grip.p : q)) : null;

  return (
    <div className="zoom-wrap">
      <svg ref={svg} viewBox={pz.viewBox} preserveAspectRatio="xMidYMid meet" className={`draw-plan tool-${tool}`} tabIndex={0}
        role="application" aria-label={`Room plan. ${help} Scroll to zoom; drag with the middle button to pan.`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onKeyDown={key}
        onDoubleClick={() => { if (tool === 'block' && line) finishLine(false); }}
        onPointerLeave={() => setCursor(null)}
        onPointerCancel={() => { press.current = null; setDraft(null); setBox(null); setGrip(null); setMoving(null); setWallMove(null); }}>
        <rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill="transparent" />
        <GeometryShapes g={g} onEditDim={tool === 'block' && line ? undefined : setEditing} />

        {/* Selection */}
        {shapes.solids.filter((s) => sel.walls.includes(s.w.i)).map((s) => (
          <polygon key={`sw${s.w.i}`} points={ptsAttr(s.pts)} fill={ACCENT} fillOpacity={0.3} stroke={ACCENT} strokeWidth={2.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        ))}
        {layout.cabinets.filter((c) => sel.cabs.includes(c.id)).map((c) => {
          const s = ws[c.wall ?? 0];
          return s && <polygon key={`sc${c.id}`} points={ptsAttr(footprint(s, c, c.layer === 'wall' ? 0 : FRONT_THICKNESS))} fill={ACCENT} fillOpacity={0.15}
            stroke={ACCENT} strokeWidth={2.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />;
        })}
        {(tool === 'select' || tool === 'block') && !line && grips.map((q, i) => (
          <rect key={`g${i}`} x={q.p.x - 5 * kv} y={q.p.y - 5 * kv} width={10 * kv} height={10 * kv} fill="#fff" stroke={ACCENT} strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        ))}
        {oneWall && !line && text((oneWall.p0.x + oneWall.p1.x) / 2, (oneWall.p0.y + oneWall.p1.y) / 2 - 16 * kv, `${oneWall.len}`, 13)}
        {gripPreview && (
          <g pointerEvents="none">
            <polyline points={ptsAttr(room.chains[grip!.c].closed ? [...gripPreview, gripPreview[0]] : gripPreview)} fill="none" stroke={ACCENT} strokeWidth={3}
              strokeDasharray={`${6 * kv} ${4 * kv}`} vectorEffect="non-scaling-stroke" />
            {text(grip!.p.x, grip!.p.y - 18 * kv, `${Math.round(grip!.p.x)}, ${Math.round(grip!.p.y)}`, 11, 600)}
          </g>
        )}

        {/* Window selection: solid left to right (inside), dashed right to left (crossing). */}
        {box && (
          <rect x={Math.min(box.a.x, box.b.x)} y={Math.min(box.a.y, box.b.y)} width={Math.abs(box.b.x - box.a.x)} height={Math.abs(box.b.y - box.a.y)}
            fill={GUIDE} fillOpacity={0.06} stroke={GUIDE} strokeWidth={1.5} strokeDasharray={box.b.x < box.a.x ? `${6 * kv} ${4 * kv}` : undefined}
            vectorEffect="non-scaling-stroke" pointerEvents="none" />
        )}

        {/* Cabinet being moved: where it would land, with gaps to its neighbours */}
        {moving && (() => {
          const { c, w, x, off } = moving;
          const ok = !moving.clash;
          const fp = footprint(w, { ...c, x, offset: off }, c.layer === 'wall' ? 0 : FRONT_THICKNESS);
          const mid = { x: (fp[0].x + fp[2].x) / 2, y: (fp[0].y + fp[2].y) / 2 };
          const col = ok ? ACCENT : '#B42318';
          const gap = (t0: number, t1: number) => {
            if (t1 - t0 < 1) return null;
            const p0 = at(w, t0, off + c.depth + 60 * kv), p1 = at(w, t1, off + c.depth + 60 * kv);
            return (
              <g>
                <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={GUIDE} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
                {text((p0.x + p1.x) / 2, (p0.y + p1.y) / 2 - 10 * kv, String(Math.round(t1 - t0)), 11, 600, GUIDE)}
              </g>
            );
          };
          return (
            <g pointerEvents="none">
              <polygon points={ptsAttr(fp)} fill={col} fillOpacity={0.18} stroke={col} strokeWidth={2.5} strokeDasharray={`${6 * kv} ${4 * kv}`} vectorEffect="non-scaling-stroke" />
              {text(mid.x, mid.y, `${x} – ${x + c.width}${off ? ` · ${off} off wall` : ''}`, 12)}
              {!ok && text(mid.x, mid.y + 16 * kv, 'overlaps', 11, 600, col)}
              {off > 0 && (() => { const a0 = at(w, x + c.width / 2, 0), a1 = at(w, x + c.width / 2, off); return (
                <g>
                  <line x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={GUIDE} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
                  {text((a0.x + a1.x) / 2 + 14 * kv, (a0.y + a1.y) / 2, String(off), 11, 600, GUIDE)}
                </g>); })()}
              {ok && gap(moving.from, x)}
              {ok && gap(x + c.width, moving.to)}
            </g>
          );
        })()}

        {/* Wall being moved */}
        {wallMove && (() => {
          const r = movedWallRoom(wallMove.i, wallMove.dn);
          const w = walls(r)[wallMove.i];
          return (
            <g pointerEvents="none">
              {r.chains.map((ch, c) => (
                <polyline key={c} points={ptsAttr(ch.closed ? [...ch.points, ch.points[0]] : ch.points)} fill="none" stroke={ACCENT} strokeWidth={3}
                  strokeDasharray={`${6 * kv} ${4 * kv}`} vectorEffect="non-scaling-stroke" />
              ))}
              {w && text((w.p0.x + w.p1.x) / 2, (w.p0.y + w.p1.y) / 2 - 18 * kv, `moved ${wallMove.dn}`, 12)}
            </g>
          );
        })()}

        {/* Cabinet being drawn */}
        {draft && Math.abs(draft.x1 - draft.x0) > 0 && (() => {
          const c = newCabinet(layer, draft.x0, draft.x1, draft.w.i, baseKind);
          const fp = footprint(draft.w, c);
          const mid = { x: (fp[0].x + fp[2].x) / 2, y: (fp[0].y + fp[2].y) / 2 };
          return (
            <g pointerEvents="none">
              <polygon points={ptsAttr(fp)} fill={ACCENT} fillOpacity={c.width >= MIN_WIDTH ? 0.2 : 0.06} stroke={ACCENT} strokeWidth={2}
                strokeDasharray={`${6 * kv} ${4 * kv}`} vectorEffect="non-scaling-stroke" />
              {text(mid.x, mid.y, String(c.width), 14)}
              {text(mid.x, mid.y + 18 * kv, `${c.x} – ${c.x + c.width}`, 11, 600)}
            </g>
          );
        })()}

        {/* Wall drawing: open ends to carry on from, snaps, guides and temporary dimensions */}
        {tool === 'block' && !line && sel.walls.length > 0 && openEnds.map((o, i) => (
          <circle key={`o${i}`} cx={o.p.x} cy={o.p.y} r={6 * kv} fill="#fff" stroke={ACCENT} strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        ))}
        {tool === 'block' && cursor && (
          <g pointerEvents="none">
            {cursor.gx !== undefined && <line x1={cursor.gx} y1={view.y} x2={cursor.gx} y2={view.y + view.h} stroke={GUIDE} strokeWidth={1} strokeDasharray={`${8 * kv} ${5 * kv}`} vectorEffect="non-scaling-stroke" />}
            {cursor.gy !== undefined && <line x1={view.x} y1={cursor.gy} x2={view.x + view.w} y2={cursor.gy} stroke={GUIDE} strokeWidth={1} strokeDasharray={`${8 * kv} ${5 * kv}`} vectorEffect="non-scaling-stroke" />}
            {cursor.kind === 'end' && <rect x={cursor.p.x - 6 * kv} y={cursor.p.y - 6 * kv} width={12 * kv} height={12 * kv} fill="none" stroke={GUIDE} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
            {cursor.kind === 'mid' && <polygon points={ptsAttr([{ x: cursor.p.x, y: cursor.p.y - 7 * kv }, { x: cursor.p.x + 7 * kv, y: cursor.p.y + 5 * kv }, { x: cursor.p.x - 7 * kv, y: cursor.p.y + 5 * kv }])} fill="none" stroke={GUIDE} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
            {cursor.kind === 'free' && <path d={`M${cursor.p.x - 6 * kv},${cursor.p.y}h${12 * kv}M${cursor.p.x},${cursor.p.y - 6 * kv}v${12 * kv}`} stroke={GUIDE} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
          </g>
        )}
        {line && (
          <g pointerEvents="none">
            <polyline points={ptsAttr(preview ? [...line, preview] : line)} fill="none" stroke={ACCENT} strokeWidth={3} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {line.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={(i === 0 ? 6 : 4) * kv} fill={i === 0 ? '#fff' : ACCENT} stroke={ACCENT} strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
            {line.slice(1).map((q, i) => <g key={`l${i}`}>{text((line[i].x + q.x) / 2, (line[i].y + q.y) / 2 - 14 * kv, String(Math.round(dist(line[i], q))), 11, 600)}</g>)}
            {preview && last && dist(preview, last) > 0 && text((last.x + preview.x) / 2, (last.y + preview.y) / 2 - 16 * kv, typed ? `${typed} ⏎` : `${Math.round(dist(preview, last))}`, 14)}
            {preview && last && dist(preview, last) > 0 && text(preview.x + 24 * kv, preview.y + 18 * kv, `${angleOf(last, preview)}°`, 11, 600, GUIDE)}
            {!preview && typed && last && text(last.x, last.y - 22 * kv, `${typed} ⏎`, 13)}
          </g>
        )}
        {rectStart && cursor && (() => {
          const a = rectStart, b = cursor.p;
          return (
            <g pointerEvents="none">
              <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="none" stroke={ACCENT} strokeWidth={3} vectorEffect="non-scaling-stroke" />
              {text((a.x + b.x) / 2, Math.min(a.y, b.y) - 16 * kv, `${Math.round(Math.abs(b.x - a.x))}`, 14)}
              {text(Math.max(a.x, b.x) + 30 * kv, (a.y + b.y) / 2, `${Math.round(Math.abs(b.y - a.y))}`, 14)}
            </g>
          );
        })()}
      </svg>
      {editing && <DimInput svg={svg} label={editing} onCommit={(v) => { onEditDim(editing, v); setEditing(null); }} onCancel={() => setEditing(null)} />}
      <FitButton show={pz.zoomed} onClick={pz.fit} />
    </div>
  );
}
