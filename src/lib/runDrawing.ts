import type { RunConfig, Settings, Unit } from '../types';
import { buildGeometry, createSketch, type Geometry } from './drawing';
import { baseFrontDepth, type ResolvedSlot } from './run';

export interface RunViews {
  plan: Geometry;
  elevation: Geometry;
  section: Geometry;
}

const NOMINAL = 520; // nominal drawing size in px, for dimension offsets and text

interface Heights {
  P: number; H: number; T: number; topBase: number; worktopTop: number;
  wb: number; wt: number; overallH: number;
}

function heights(c: RunConfig): Heights {
  const P = c.plinth, H = c.baseHeight, T = c.worktop;
  const topBase = P + H;
  const worktopTop = topBase + T;
  const wb = c.wallBottom, wt = c.wallBottom + c.wallHeight;
  return { P, H, T, topBase, worktopTop, wb, wt, overallH: c.wall ? wt : worktopTop };
}

/** Height dimensions up the right-hand side: a chain of each zone plus the overall height. */
function heightChain(sk: ReturnType<typeof createSketch>, c: RunConfig, h: Heights, xFace: number) {
  const { k } = sk;
  const xr = xFace + 30 * k;
  const xr2 = xr + 40 * k;
  const levels = [0, h.P, h.topBase, h.worktopTop];
  if (c.wall) levels.push(h.wb, h.wt);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1]) sk.vdim(xr, -levels[i], -levels[i - 1], levels[i] - levels[i - 1]);
  }
  sk.vdim(xr2, -h.overallH, 0, h.overallH);
  for (const y of levels) sk.seg(xFace + 4 * k, -y, xr2 + 6 * k, -y, 'ext');
}

/** Front view of the whole run: base cabinets, worktop and wall cabinets. */
function elevation(c: RunConfig, slots: ResolvedSlot[], base: Unit[], wall: Unit[], settings: Settings): Geometry {
  const h = heights(c);
  const L = c.length;
  const sk = createSketch(Math.max(L, h.overallH) / NOMINAL);
  const { k } = sk;

  sk.seg(-60 * k, 0, L + 60 * k, 0, 'floor');
  slots.forEach((s, i) => {
    sk.place(buildGeometry(base[i], 'front', settings), s.x, -h.topBase);
    sk.note(s.x + s.width / 2, 16 * k, base[i].code, 11);
    if (c.wall && wall[i]) {
      sk.place(buildGeometry(wall[i], 'front', settings), s.x, -h.wt);
      sk.note(s.x + s.width / 2, -h.wt - 14 * k, wall[i].code, 11);
    }
  });
  sk.box(0, -h.worktopTop, L, h.T, 'worktop');

  // Width chain and overall length under the floor line.
  slots.forEach((s) => sk.hdim(s.x, s.x + s.width, 44 * k, s.width));
  sk.hdim(0, L, 80 * k, L);
  for (const s of slots) sk.seg(s.x, 4 * k, s.x, 50 * k, 'ext');
  sk.seg(0, 4 * k, 0, 86 * k, 'ext');
  sk.seg(L, 4 * k, L, 86 * k, 'ext');

  heightChain(sk, c, h, L);
  return sk.finish();
}

/** Top view: back wall, worktop, base cabinet divisions and wall cabinets above (dashed). */
function plan(c: RunConfig, slots: ResolvedSlot[], base: Unit[], wall: Unit[]): Geometry {
  const L = c.length;
  const Fd = baseFrontDepth(c);
  const WD = Fd + c.overhang;
  const sk = createSketch(Math.max(L, WD + 300) / NOMINAL);
  const { k } = sk;

  sk.box(-150, -100, L + 300, 100, 'wallmass');
  sk.box(0, 0, L, WD, 'worktop');
  sk.seg(0, Fd, L, Fd, 'thin'); // door faces
  slots.forEach((s, i) => {
    if (i > 0) sk.seg(s.x, 0, s.x, Fd, 'thin');
    sk.note(s.x + s.width / 2, Math.min(Fd * 0.65, Fd - 40), base[i].code, 11);
    if (c.wall && wall[i]) {
      sk.box(s.x, 0, s.width, c.wallDepth, 'hidden');
      sk.note(s.x + s.width / 2, c.wallDepth / 2, wall[i].code, 10);
    }
  });

  sk.hdim(0, L, -100 - 28 * k, L);
  sk.seg(0, -104, 0, -100 - 34 * k, 'ext');
  sk.seg(L, -104, L, -100 - 34 * k, 'ext');
  slots.forEach((s) => sk.hdim(s.x, s.x + s.width, WD + 30 * k, s.width));
  for (const s of [...slots.map((x) => x.x), L]) sk.seg(s, WD + 4 * k, s, WD + 36 * k, 'ext');

  const xr = L + 30 * k;
  sk.vdim(xr, 0, WD, WD);
  sk.seg(L + 4 * k, WD, xr + 6 * k, WD, 'ext');
  if (c.wall) {
    sk.vdim(xr + 36 * k, 0, c.wallDepth, c.wallDepth);
    sk.seg(L + 4 * k, c.wallDepth, xr + 42 * k, c.wallDepth, 'ext');
  }
  sk.seg(L + 4 * k, 0, xr + (c.wall ? 42 : 6) * k, 0, 'ext');
  return sk.finish();
}

/** Side section through one cabinet position, wall on the left. */
function section(c: RunConfig, base: Unit, wall: Unit | undefined, settings: Settings): Geometry {
  const h = heights(c);
  const Fd = baseFrontDepth(c);
  const WD = Fd + c.overhang;
  const sk = createSketch(Math.max(h.overallH, WD + 400) / NOMINAL);
  const { k } = sk;

  sk.box(-100, -(h.overallH + 150), 100, h.overallH + 150, 'wallmass');
  sk.seg(-100, 0, WD + 150, 0, 'floor');
  // Unit side views face left; mirror them so the front faces the room on the right.
  sk.place(buildGeometry(base, 'side', settings), 0, -h.topBase, c.baseDepth);
  sk.box(0, -h.worktopTop, WD, h.T, 'worktop');
  if (c.wall && wall) sk.place(buildGeometry(wall, 'side', settings), 0, -h.wt, c.wallDepth);

  sk.hdim(0, c.baseDepth, 30 * k, c.baseDepth);
  sk.hdim(0, WD, 64 * k, WD);
  sk.seg(c.baseDepth, 4 * k, c.baseDepth, 36 * k, 'ext');
  sk.seg(WD, -h.topBase, WD, 70 * k, 'ext');
  if (c.wall && wall) {
    sk.hdim(0, c.wallDepth, -h.wt - 28 * k, c.wallDepth);
    sk.seg(c.wallDepth, -h.wt - 4 * k, c.wallDepth, -h.wt - 34 * k, 'ext');
  }
  heightChain(sk, c, h, WD);
  return sk.finish();
}

export function runDrawings(c: RunConfig, slots: ResolvedSlot[], base: Unit[], wall: Unit[], settings: Settings, sectionIndex: number): RunViews {
  const i = Math.min(Math.max(0, sectionIndex), base.length - 1);
  return {
    plan: plan(c, slots, base, wall),
    elevation: elevation(c, slots, base, wall, settings),
    section: section(c, base[i], wall[i], settings),
  };
}
