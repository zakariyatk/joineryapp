import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import type { Geometry } from './drawing';
import {
  applyLayout, EMPTY_LAYOUT, freeSpan, isLayoutApplied, layoutDrawings, layoutErrors, layoutUnits, newCabinet, roomOf, runToLayout, setWallAngle,
  setWallLength, snap, snapEdges, wallAngle, walls, placeMoved, applyDimEdit, isDimEdit, type DimEdit, deleteWall, remapCabinets, chainFromLocation, putChain, wallShapes, normaliseRoom, moveCorner,
} from './layout';
import { DEFAULT_RUN, resolveRun } from './run';
import type { DrawnLayout, Room, Unit } from '../types';

const at = (c: ReturnType<typeof newCabinet>, patch: Partial<typeof c> = {}) => ({ ...c, ...patch });

describe('drawing cabinets on the plan', () => {
  const base1 = newCabinet('base', 0, 600);
  const base2 = newCabinet('base', 600, 1400);
  const wall1 = newCabinet('wall', 0, 600);
  const l: DrawnLayout = { ...EMPTY_LAYOUT, length: 3000, cabinets: [base1, base2, wall1] };

  it('gives each kind its own starting and ending levels', () => {
    expect(base1).toMatchObject({ x: 0, width: 600, bottom: 100, top: 820, depth: 560 });
    expect(wall1).toMatchObject({ bottom: 1450, top: 2170, depth: 320 });
    expect(newCabinet('tall', 900, 300)).toMatchObject({ x: 300, width: 600, bottom: 100, top: 2200 });
  });

  it('finds the free stretch for a new cabinet, letting wall units go over base units', () => {
    expect(freeSpan(l, 2000, 100, 820)).toEqual({ from: 1400, to: 3000 });
    expect(freeSpan(l, 300, 100, 820)).toBeNull(); // inside base1
    expect(freeSpan(l, 900, 1450, 2170)).toEqual({ from: 600, to: 3000 }); // over base2 is fine for a wall unit
    expect(freeSpan(l, 2000, 100, 2200)).toEqual({ from: 1400, to: 3000 }); // a tall unit is blocked by base and wall
  });

  it('snaps to 10 mm or a nearby cabinet edge', () => {
    expect(snap(1234, [], 0)).toBe(1230);
    expect(snap(1395, [1400], 20)).toBe(1400);
  });

  it('reports overlaps and cabinets past the wall', () => {
    const bad: DrawnLayout = { ...l, cabinets: [base1, at(newCabinet('tall', 500, 1100)), at(newCabinet('base', 2800, 3200))] };
    const errs = layoutErrors(bad, new Map());
    expect(errs.some((e) => e.includes('overlap'))).toBe(true);
    expect(errs.some((e) => e.includes('past the end'))).toBe(true);
    expect(layoutErrors(l, new Map())).toEqual([]);
  });

  it('creates units with heights and plinths from the levels', () => {
    const drawers = at(newCabinet('base', 1400, 2000), { kind: 'drawers', drawers: 4 });
    const tall = at(newCabinet('tall', 2400, 3000), { bottom: 150, top: 2250 });
    const lay: DrawnLayout = { ...l, cabinets: [...l.cabinets, drawers, tall] };
    const units = layoutUnits(lay, []);
    expect(units.get(base1.id)).toMatchObject({ type: 'base', height: 720, plinth: 100, code: 'B1' });
    expect(units.get(wall1.id)).toMatchObject({ type: 'wall', height: 720, plinth: 0, code: 'W1' });
    expect(units.get(tall.id)).toMatchObject({ type: 'tall', height: 2100, plinth: 150 });
    expect(units.get(drawers.id)).toMatchObject({ name: '4-drawer base unit', drawers: 4 });

    const manual = { ...units.get(base1.id)!, id: 'm', code: 'B9', source: undefined } as Unit;
    const out = applyLayout([manual], lay);
    expect(out).toHaveLength(6);
    expect(isLayoutApplied(out, lay)).toBe(true);
    expect(isLayoutApplied(out, { ...lay, cabinets: lay.cabinets.slice(1) })).toBe(false);
  });

  it('draws the elevation with each cabinet at its levels', () => {
    const units = layoutUnits(l, []);
    const v = layoutDrawings(l, units, DEFAULT_SETTINGS, 0, base1);
    const carcasses = v.elevation.boxes.filter((b) => b.kind === 'carcass');
    expect(carcasses.map((b) => [b.x, b.y, b.h])).toEqual(expect.arrayContaining([[0, -820, 720], [0, -2170, 720]]));
    expect(v.elevation.boxes.some((b) => b.kind === 'worktop' && b.x === 0 && b.w === 1400)).toBe(true);
    // Section through base1 also cuts the wall unit above it.
    expect(v.section.boxes.filter((b) => b.kind === 'carcass')).toHaveLength(2);
  });

  it('copies a wall-length run', () => {
    const r = resolveRun(DEFAULT_RUN);
    const lay = runToLayout(DEFAULT_RUN, r.slots);
    expect(lay.cabinets.filter((c) => c.layer === 'base')).toHaveLength(r.slots.length);
    expect(lay.cabinets.find((c) => c.layer === 'wall')).toMatchObject({ bottom: 1450, top: 2170 });
    expect(layoutErrors(lay, new Map())).toEqual([]);
  });
});

describe('block walls drawn as a line', () => {
  // U-shaped kitchen drawn left wall down→up, back wall left→right, right wall top→down.
  const U = [{ x: 0, y: 2000 }, { x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 2000 }];
  const room: Room = { chains: [{ points: U, closed: false }], thickness: 150 };

  it('finds each wall with the room on its inside and measures from the left as you face it', () => {
    const ws = walls(room);
    expect(ws.map((w) => w.len)).toEqual([2000, 3000, 2000]);
    expect(ws[1].a).toEqual({ x: 0, y: 0 }); // back wall: left end is x = 0
    expect(ws[1].n).toEqual({ x: -0, y: 1 }); // faces down into the room
    expect(ws[0].n.x).toBeCloseTo(1); // left wall faces right
    expect(ws[2].n.x).toBeCloseTo(-1); // right wall faces left
    expect(wallAngle(ws[1])).toBe(0);
    expect(wallAngle(ws[0])).toBe(90);
  });

  it('flips the inside when asked', () => {
    expect(walls({ ...room, chains: [{ points: U, closed: false, flip: true }] })[1].n.y).toBeCloseTo(-1);
  });

  it('sets an exact length or angle, moving the walls after it', () => {
    const r = setWallLength(room, 1, 3600);
    expect(r.chains[0].points[2]).toEqual({ x: 3600, y: 0 });
    expect(r.chains[0].points[3]).toEqual({ x: 3600, y: 2000 });
    const r2 = setWallAngle(room, 1, 90); // back wall now points straight up
    expect(r2.chains[0].points[2].x).toBeCloseTo(0);
    expect(r2.chains[0].points[2].y).toBeCloseTo(-3000);
  });

  it('places cabinets on any wall and catches clashes at a corner', () => {
    const back = newCabinet('base', 0, 600, 1);
    const side = newCabinet('base', 1400, 2000, 0); // left wall, top end runs into the back corner
    const lay: DrawnLayout = { ...EMPTY_LAYOUT, room, cabinets: [back, side] };
    expect(layoutErrors(lay, new Map()).some((e) => e.includes('corner'))).toBe(true);
    // Snapping on the left wall offers the back cabinet's depth so the run can stop short of it.
    expect(snapEdges(lay, 0)).toContain(2000 - 560);
    const ok: DrawnLayout = { ...lay, cabinets: [back, { ...side, x: 840, width: 600 }] };
    expect(layoutErrors(ok, new Map())).toEqual([]);
    const v = layoutDrawings(ok, layoutUnits(ok, []), DEFAULT_SETTINGS, 0, side);
    expect(v.plan.polys!.filter((p) => p.kind === 'poche')).toHaveLength(3);
    expect(v.elevation.boxes.some((b) => b.kind === 'carcass')).toBe(true);
  });

  it('removes nothing when there is no room drawn', () => {
    expect(walls(roomOf(EMPTY_LAYOUT))).toHaveLength(1);
  });
});

describe('a new project', () => {
  it('starts Build as a blank drawing with no walls or cabinets', async () => {
    const { newProject } = await import('./defaults');
    const p = newProject('Kitchen', 'Client');
    expect(p.buildMode).toBe('draw');
    expect(p.layout?.cabinets).toEqual([]);
    expect(p.layout?.room?.chains).toEqual([]);
    expect(p.run).toBeUndefined();
    expect(p.units).toEqual([]);
    expect(walls(roomOf(p.layout!))).toEqual([]);
    expect(layoutErrors(p.layout!, new Map())).toEqual(['Draw at least one wall.']);
    // Drawing a blank page must not throw.
    expect(() => layoutDrawings(p.layout!, new Map(), DEFAULT_SETTINGS, 0)).not.toThrow();
    // Two new projects never share their drawing.
    expect(newProject('A', '').layout).not.toBe(newProject('B', '').layout);
  });
});

describe('Revit-style walls', () => {
  const rect: Room = { chains: [{ points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }], closed: true }], thickness: 200 };

  it('reads drawings saved as a single line', () => {
    const old = { points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }], closed: false, thickness: 150 } as unknown as Room;
    expect(normaliseRoom(old).chains).toEqual([{ points: old.points, closed: false, flip: undefined }]);
    expect(walls(old)).toHaveLength(1);
  });

  it('treats a closed rectangle as a room: every wall faces inwards, mitred corners', () => {
    const ws = walls(rect);
    expect(ws).toHaveLength(4);
    expect(ws[0].n).toEqual({ x: -0, y: 1 });
    expect(ws[1].n.x).toBeCloseTo(-1);
    // Drawn anticlockwise, the inside is still the room.
    const ccw: Room = { ...rect, chains: [{ ...rect.chains[0], points: [...rect.chains[0].points].reverse() }] };
    expect(walls(ccw).every((w) => onCentre(w))).toBe(true);
    const { solids, outer } = wallShapes(rect);
    expect(solids[0].pts[3]).toEqual({ x: -200, y: -200 }); // outer corner mitred
    expect(outer[0]).toHaveLength(5);
    function onCentre(w: ReturnType<typeof walls>[number]) {
      return (2000 - (w.a.x + w.b.x) / 2) * w.n.x + (1500 - (w.a.y + w.b.y) / 2) * w.n.y > 0;
    }
  });

  it('places walls drawn by centre line or outside face with their inside face on the room side', () => {
    const base: Room = { chains: [], thickness: 200 };
    const ch = { points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }], closed: true };
    expect(chainFromLocation(base, ch, 'centre').points[0]).toEqual({ x: 100, y: 100 });
    expect(chainFromLocation(base, ch, 'outside').points[2]).toEqual({ x: 3800, y: 2800 });
    expect(chainFromLocation(base, ch, 'inside')).toBe(ch);
  });

  it('deletes a wall, splitting its run, and keeps cabinets on the walls that remain', () => {
    const open: Room = { chains: [{ points: [{ x: 0, y: 2000 }, { x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 2000 }], closed: false }], thickness: 150 };
    const side = newCabinet('base', 0, 600, 2);
    const back = newCabinet('base', 600, 1200, 1);
    const after = deleteWall(open, 1);
    expect(after.chains.map((c) => c.points.length)).toEqual([2, 2]);
    const cabs = remapCabinets(open, after, [side, back]);
    expect(cabs).toHaveLength(1); // the back wall's cabinet goes with it
    expect(cabs[0]).toMatchObject({ id: side.id, wall: 1, x: 0 });
    // Deleting a wall of a closed room opens it.
    const opened = deleteWall(rect, 0);
    expect(opened.chains[0]).toMatchObject({ closed: false });
    expect(walls(opened)).toHaveLength(3);
  });

  it('adds runs without moving cabinets on earlier walls, and moves corners', () => {
    const one: Room = { chains: [{ points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }], closed: false }], thickness: 150 };
    const two = putChain(one, { points: [{ x: 0, y: 1000 }, { x: 0, y: 3000 }], closed: false });
    expect(walls(two)).toHaveLength(2);
    const c = newCabinet('base', 0, 600, 0);
    expect(remapCabinets(one, two, [c])[0]).toMatchObject({ wall: 0, x: 0 });
    expect(moveCorner(one, 0, 1, { x: 3500, y: 0 }).chains[0].points[1]).toEqual({ x: 3500, y: 0 });
  });
});

describe('moving a cabinet on the plan', () => {
  const a = newCabinet('base', 0, 600, 0);
  const b = newCabinet('base', 1200, 1800, 0);
  const up = newCabinet('wall', 0, 600, 0);
  const l: DrawnLayout = { ...EMPTY_LAYOUT, length: 3000, cabinets: [a, b, up] };

  it('snaps either edge to nearby cabinet edges and to 10 mm', () => {
    expect(placeMoved(l, b, 0, 613, 20)?.x).toBe(600); // left edge onto a's right edge
    expect(placeMoved(l, a, 0, 597, 20)?.x).toBe(600); // right edge 1197 → 1200 (b's left edge)
    expect(placeMoved(l, b, 0, 2003, 0)?.x).toBe(2000);
  });

  it('never overlaps: it stops against the cabinet in the way', () => {
    expect(placeMoved(l, b, 0, 500, 0)).toMatchObject({ x: 600, from: 600 });
    expect(placeMoved(l, b, 0, 2900, 0)?.x).toBe(2400); // stops at the wall end
    // A wall unit passes over base units.
    expect(placeMoved(l, up, 0, 1300, 0)?.x).toBe(1300);
  });

  it('still moves into a gap that is too small, flagged as a clash', () => {
    const tight: DrawnLayout = { ...l, cabinets: [a, { ...b, x: 900 }, newCabinet('base', 600, 900, 0)] };
    expect(placeMoved(tight, a, 0, 700, 0)).toMatchObject({ x: 700, clash: true });
  });

  it('moves a wall unit in a full row (the bug: it used to stay put)', () => {
    const row = runToLayout(DEFAULT_RUN, resolveRun(DEFAULT_RUN).slots);
    const w1 = row.cabinets.find((c) => c.layer === 'wall')!;
    expect(placeMoved(row, w1, 0, 100, 0)).toMatchObject({ x: 0, clash: false }); // small nudge stops against W2
    expect(placeMoved(row, w1, 0, 300, 0)).toMatchObject({ x: 300, clash: true });
    // Pulled forward off the wall it no longer clashes with the other wall units.
    expect(placeMoved(row, w1, 0, 300, 0, 400)).toMatchObject({ x: 300, clash: false });
  });
});

describe('cabinets away from the wall', () => {
  it('draws, checks and sections a cabinet with a gap from the wall', () => {
    const island = { ...newCabinet('base', 1000, 2200, 0), offset: 1200 };
    const back = newCabinet('base', 1000, 1600, 0);
    const l: DrawnLayout = { ...EMPTY_LAYOUT, length: 4000, cabinets: [back, island] };
    expect(layoutErrors(l, new Map())).toEqual([]); // same stretch of wall, but not touching
    expect(layoutErrors({ ...l, cabinets: [back, { ...island, offset: 300 }] }, new Map()).some((e) => e.includes('overlap'))).toBe(true);
    const v = layoutDrawings(l, layoutUnits(l, []), DEFAULT_SETTINGS, 0, island);
    expect(v.section.boxes.some((b) => b.kind === 'worktop' && b.x === 1200)).toBe(true);
    expect(v.plan.polys!.some((p) => p.kind === 'worktop' && p.pts[0].y === 1200)).toBe(true);
  });
});

describe('editing dimensions', () => {
  const a = newCabinet('base', 0, 600, 0);
  const b = newCabinet('base', 600, 1200, 0);
  const c = newCabinet('base', 1200, 1800, 0);
  const far = newCabinet('base', 2400, 3000, 0);
  const up = newCabinet('wall', 0, 600, 0);
  const tall = newCabinet('tall', 3000, 3600, 0);
  const l: DrawnLayout = { ...EMPTY_LAYOUT, length: 4000, cabinets: [a, b, c, far, up, tall] };
  const get = (x: DrawnLayout, id: string) => x.cabinets.find((q) => q.id === id)!;

  it('tags the drawings so dimensions can be edited', () => {
    const v = layoutDrawings(l, layoutUnits(l, []), DEFAULT_SETTINGS, 0, a);
    const kinds = (g: Geometry) => new Set(g.labels.filter((x) => isDimEdit(x.edit)).map((x) => (x.edit as DimEdit).kind));
    expect([...kinds(v.plan)].sort()).toEqual(['wallLength', 'width']);
    expect([...kinds(v.elevation)].sort()).toEqual(['level', 'wallLength', 'width']);
    expect(kinds(v.section).has('depth')).toBe(true);
    expect(kinds(v.section).has('worktopDepth')).toBe(true);
  });

  it('widens a cabinet and pushes the cabinets butting up to it', () => {
    const r = applyDimEdit(l, { kind: 'width', id: a.id }, 700);
    expect(get(r, a.id).width).toBe(700);
    expect(get(r, b.id).x).toBe(700);
    expect(get(r, c.id).x).toBe(1300);
    expect(get(r, far.id).x).toBe(2400); // not touching: stays
    expect(get(r, up.id).x).toBe(0); // wall unit above is not part of the run
  });

  it('changes the wall length', () => {
    expect(applyDimEdit(l, { kind: 'wallLength', wall: 0 }, 4200).length).toBe(4200);
    const room: Room = { chains: [{ points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 2000 }], closed: false }], thickness: 150 };
    const r = applyDimEdit({ ...l, room }, { kind: 'wallLength', wall: 0 }, 3500);
    expect(r.room!.chains[0].points[2]).toEqual({ x: 3500, y: 2000 });
  });

  it('moves a level and everything above it, leaving tall units alone', () => {
    // Base carcass 100 → 820 made 760 high: base tops go up 40, wall units above move 40.
    const r = applyDimEdit(l, { kind: 'level', lo: 100, hi: 820, ids: l.cabinets.map((q) => q.id) }, 760);
    expect(get(r, a.id)).toMatchObject({ bottom: 100, top: 860 });
    expect(get(r, up.id)).toMatchObject({ bottom: 1490, top: 2210 });
    expect(get(r, tall.id)).toMatchObject({ bottom: 100, top: 2200 });
    // Plinth 0 → 100 made 150: base units rise but keep their height.
    const p = applyDimEdit(l, { kind: 'level', lo: 0, hi: 100, ids: [a.id] }, 150);
    expect(get(p, a.id)).toMatchObject({ bottom: 150, top: 870 });
    // The worktop step changes the worktop thickness.
    const w = applyDimEdit(l, { kind: 'level', lo: 820, hi: 858, ids: [a.id] }, 40);
    expect(w.worktop).toBe(40);
  });

  it('sets depth, gap from wall and worktop depth', () => {
    expect(get(applyDimEdit(l, { kind: 'depth', id: a.id }, 600), a.id).depth).toBe(600);
    expect(get(applyDimEdit(l, { kind: 'offset', id: a.id }, 900), a.id).offset).toBe(900);
    expect(applyDimEdit(l, { kind: 'worktopDepth', depth: 560 }, 620).overhang).toBe(42);
  });
});

describe('dimension text placement', () => {
  it('keeps aligned dimension numbers clear of their lines, on the far side, reading bottom to top when vertical', () => {
    const room: Room = { chains: [{ points: [{ x: 0, y: 2000 }, { x: 0, y: 0 }, { x: 3000, y: 0 }], closed: false }], thickness: 150 };
    const cab = newCabinet('base', 0, 850, 1);
    const l: DrawnLayout = { ...EMPTY_LAYOUT, room, cabinets: [cab] };
    const g = layoutDrawings(l, layoutUnits(l, []), DEFAULT_SETTINGS, 1).plan;
    const width = g.labels.find((x) => isDimEdit(x.edit) && (x.edit as DimEdit).kind === 'width')!;
    const back = g.labels.find((x) => isDimEdit(x.edit) && (x.edit as DimEdit).kind === 'wallLength' && (x.edit as { wall: number }).wall === 1)!;
    const side = g.labels.find((x) => isDimEdit(x.edit) && (x.edit as DimEdit).kind === 'wallLength' && (x.edit as { wall: number }).wall === 0)!;
    // Horizontal dimension lines at the label's x: the nearest one must be 11 nominal px away.
    const gapTo = (lab: typeof width) => Math.min(...g.segs.filter((s) => s.kind === 'dim' && Math.abs(s.y1 - s.y2) < 1e-6
      && Math.min(s.x1, s.x2) <= lab.x && lab.x <= Math.max(s.x1, s.x2)).map((s) => Math.abs(s.y1 - lab.y)));
    expect(gapTo(width)).toBeCloseTo(11 * g.k, 3);
    expect(gapTo(back)).toBeCloseTo(11 * g.k, 3);
    expect(width.y).toBeGreaterThan(0); // inside the room, below its line
    expect(back.y).toBeLessThan(-150); // outside the wall, above it
    expect(width.middle && back.middle).toBe(true);
    expect(side.angle).toBeCloseTo(-90); // vertical: reads bottom to top
  });
});
