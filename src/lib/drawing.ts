import type { Settings, Unit } from '../types';
import { DOOR_GAP, fronts, normalise, RAIL_WIDTH } from './cabinet';

export type View = 'front' | 'side';
export type SegKind = 'outline' | 'thin' | 'dim' | 'ext' | 'hidden' | 'handle' | 'swing' | 'floor';
export type BoxKind = 'carcass' | 'front' | 'inset' | 'plinth' | 'back' | 'worktop' | 'wallmass' | 'hidden';

export interface Seg { x1: number; y1: number; x2: number; y2: number; kind: SegKind }
export interface Box { x: number; y: number; w: number; h: number; kind: BoxKind }
export interface Label { x: number; y: number; text: string; vertical: boolean; tone?: 'dim' | 'note'; size?: number }

export interface Geometry {
  boxes: Box[];
  segs: Seg[];
  labels: Label[];
  /** Millimetres per nominal screen pixel; used for text size, ticks and offsets. */
  k: number;
  bounds: { x: number; y: number; w: number; h: number };
}

/**
 * Collects drawing primitives in millimetres (y pointing down). Offsets for
 * dimensions are nominal pixels × k so drawings read the same at any size.
 */
export function createSketch(k: number) {
  const boxes: Box[] = [];
  const segs: Seg[] = [];
  const labels: Label[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number, kind: SegKind) => { segs.push({ x1, y1, x2, y2, kind }); };
  const box = (x: number, y: number, w: number, h: number, kind: BoxKind) => { boxes.push({ x, y, w, h, kind }); };
  const tick = (x: number, y: number) => seg(x - 4 * k, y + 4 * k, x + 4 * k, y - 4 * k, 'dim');
  const hdim = (x1: number, x2: number, y: number, v: number) => {
    seg(x1, y, x2, y, 'dim'); tick(x1, y); tick(x2, y);
    labels.push({ x: (x1 + x2) / 2, y: y - 7 * k, text: String(Math.round(v)), vertical: false });
  };
  const vdim = (x: number, y1: number, y2: number, v: number) => {
    seg(x, y1, x, y2, 'dim'); tick(x, y1); tick(x, y2);
    labels.push({ x: x - 7 * k, y: (y1 + y2) / 2, text: String(Math.round(v)), vertical: true });
  };
  const note = (x: number, y: number, text: string, size = 12) => { labels.push({ x, y, text, vertical: false, tone: 'note', size }); };

  /** Copy another drawing's shapes (not its dimensions), moved and optionally mirrored left-right. */
  const place = (g: Geometry, dx: number, dy: number, mirrorWidth?: number) => {
    const mx = (x: number) => (mirrorWidth === undefined ? x : mirrorWidth - x);
    for (const b of g.boxes) {
      const x = mirrorWidth === undefined ? b.x : mirrorWidth - (b.x + b.w);
      box(x + dx, b.y + dy, b.w, b.h, b.kind);
    }
    for (const s of g.segs) {
      if (s.kind === 'dim' || s.kind === 'ext') continue;
      seg(mx(s.x1) + dx, s.y1 + dy, mx(s.x2) + dx, s.y2 + dy, s.kind);
    }
  };

  const finish = (pad = 24): Geometry => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    boxes.forEach((b) => { add(b.x, b.y); add(b.x + b.w, b.y + b.h); });
    segs.forEach((s) => { add(s.x1, s.y1); add(s.x2, s.y2); });
    labels.forEach((l) => add(l.x, l.y));
    if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
    const p = pad * k;
    return { boxes, segs, labels, k, bounds: { x: minX - p, y: minY - p, w: maxX - minX + 2 * p, h: maxY - minY + 2 * p } };
  };

  return { boxes, segs, labels, k, seg, box, hdim, vdim, note, place, finish };
}

/**
 * Orthographic drawing of one unit in millimetres, y pointing down,
 * carcass top-left at (0, 0). In the side view the front faces left.
 */
export function buildGeometry(raw: Unit, view: View, settings: Settings): Geometry {
  const u = normalise(raw);
  const W = u.width, H = u.height, P = u.plinth, D = u.depth, DH = u.drawerHeight;
  const T = settings.materials.carcass.thickness;
  const F = settings.materials.front.thickness;
  const B = settings.materials.back.thickness;
  const objW = view === 'front' ? W : D;
  // Fit into a nominal 360 × 440 px area.
  const k = 1 / Math.min(360 / objW, 440 / (H + P));
  const sk = createSketch(k);
  const { seg, box, hdim, vdim } = sk;
  const shelfYs = Array.from({ length: u.shelves }, (_, j) => (H * (j + 1)) / (u.shelves + 1));

  if (view === 'front') {
    const f = fronts(u);
    box(0, 0, W, H, 'carcass');
    const g = DOOR_GAP;
    const inset = (x: number, y: number, w: number, h: number) => {
      if (u.doorStyle !== 'shaker') return;
      const i = Math.min(60, h / 4, w / 4);
      box(x + i, y + i, w - 2 * i, h - 2 * i, 'inset');
    };
    if (f.doors === 0 && !f.drawer) {
      // Open unit: show the carcass thickness and shelves.
      box(T, T, W - 2 * T, H - 2 * T, 'back');
      for (const y of shelfYs) box(T, y - T / 2, W - 2 * T, T, 'carcass');
    }
    if (f.drawer) {
      const d = { x: g, y: g, w: f.drawer.w, h: f.drawer.h };
      box(d.x, d.y, d.w, d.h, 'front');
      inset(d.x, d.y, d.w, d.h);
      const hl = Math.min(160, d.w / 3);
      seg(d.x + d.w / 2 - hl / 2, d.y + d.h / 2, d.x + d.w / 2 + hl / 2, d.y + d.h / 2, 'handle');
    }
    for (let i = 0; i < f.doors; i++) {
      const x = g + i * (f.doorW + 2 * g);
      const y = DH + g;
      const w = f.doorW, h = f.doorH;
      box(x, y, w, h, 'front');
      inset(x, y, w, h);
      const hingeLeft = i % 2 === 0;
      const hx = hingeLeft ? x : x + w;
      const ox = hingeLeft ? x + w : x;
      seg(ox, y, hx, y + h / 2, 'swing');
      seg(hx, y + h / 2, ox, y + h, 'swing');
      const handleX = hingeLeft ? x + w - 40 : x + 40;
      const len = Math.min(160, h / 3);
      if (u.type === 'wall') seg(handleX, y + h - 50 - len, handleX, y + h - 50, 'handle');
      else seg(handleX, y + 50, handleX, y + 50 + len, 'handle');
    }
    if (f.doors > 0 || f.drawer) for (const y of shelfYs) if (y > DH) seg(T, y, W - T, y, 'hidden');
    if (P > 0) box(0, H, W, P, 'plinth');

    hdim(0, W, -28 * k, W);
    seg(0, -4 * k, 0, -34 * k, 'ext');
    seg(W, -4 * k, W, -34 * k, 'ext');
    if (DH > 0) {
      const xl = -28 * k;
      vdim(xl, 0, DH, DH);
      vdim(xl, DH, H, H - DH);
      for (const y of [0, DH, H]) seg(-4 * k, y, xl - 6 * k, y, 'ext');
    }
  } else {
    box(0, 0, D, H, 'carcass');
    const hasFront = fronts(u).doors > 0 || u.drawerHeight > 0;
    if (hasFront) box(-F, 0, F, H, 'front');
    box(D - 12 - B, T, B, H - 2 * T, 'back');
    if (u.type === 'base') {
      seg(0, T, RAIL_WIDTH, T, 'thin');
      seg(D - RAIL_WIDTH, T, D, T, 'thin');
    } else {
      seg(0, T, D, T, 'thin');
    }
    seg(0, H - T, D, H - T, 'thin');
    for (const y of shelfYs) seg(4, y, D - 40, y, 'hidden');
    if (P > 0) box(50, H, D - 50, P, 'plinth');
    hdim(0, D, -28 * k, D);
    seg(0, -4 * k, 0, -34 * k, 'ext');
    seg(D, -4 * k, D, -34 * k, 'ext');
  }

  // Heights on the right, shared by both views.
  const xr = objW + 30 * k;
  const xr2 = xr + 36 * k;
  vdim(xr, 0, H, H);
  if (P > 0) {
    vdim(xr, H, H + P, P);
    vdim(xr2, 0, H + P, H + P);
  }
  for (const y of [0, H, H + P]) seg(objW + 4 * k, y, (P > 0 ? xr2 : xr) + 6 * k, y, 'ext');

  return sk.finish();
}
