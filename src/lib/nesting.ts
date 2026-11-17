import type { Material, MaterialRole, Part } from '../types';

export interface Placement {
  partKey: string;
  label: string;
  /** Position on the sheet in mm, x along the sheet length, y across its width. */
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Sheet {
  role: MaterialRole;
  index: number; // 1-based within its material
  placements: Placement[];
  offcuts: Rect[];
  usedArea: number;
  yield: number; // 0..1 of the full sheet
}

export interface NestResult {
  role: MaterialRole;
  material: Material;
  sheets: Sheet[];
  oversize: { label: string; length: number; width: number }[];
}

interface Piece {
  partKey: string;
  label: string;
  length: number;
  width: number;
}

interface WorkSheet {
  free: Rect[];
  placements: Placement[];
}

const MIN_OFFCUT = 100;

type Fit = 'short-side' | 'area';
type Split = 'longer' | 'shorter';
type Order = (a: Piece, b: Piece) => number;

const ORDERS: Order[] = [
  (a, b) => b.length * b.width - a.length * a.width,
  (a, b) => Math.max(b.length, b.width) - Math.max(a.length, a.width) || b.length * b.width - a.length * a.width,
  (a, b) => b.width - a.width || b.length - a.length,
  (a, b) => b.length - a.length || b.width - a.width,
];

interface Packed { sheets: WorkSheet[]; oversize: NestResult['oversize'] }

function pack(pieces: Piece[], material: Material, k: number, trim: number, fit: Fit, split: Split): Packed {
  const usableW = material.sheetLength - 2 * trim + k;
  const usableH = material.sheetWidth - 2 * trim + k;
  const sheets: WorkSheet[] = [];
  const oversize: NestResult['oversize'] = [];

  const orientations = (pc: Piece) => {
    const o = [{ w: pc.length + k, h: pc.width + k, rotated: false }];
    if (!material.grain && pc.length !== pc.width) o.push({ w: pc.width + k, h: pc.length + k, rotated: true });
    return o;
  };

  for (const pc of pieces) {
    const opts = orientations(pc);
    if (!opts.some((o) => o.w <= usableW && o.h <= usableH)) {
      oversize.push({ label: pc.label, length: pc.length, width: pc.width });
      continue;
    }

    let best: { sheet: WorkSheet; rectIndex: number; w: number; h: number; rotated: boolean; score: number; tie: number } | null = null;
    for (const sheet of sheets) {
      sheet.free.forEach((fr, rectIndex) => {
        for (const o of opts) {
          if (o.w > fr.w || o.h > fr.h) continue;
          const shortSide = Math.min(fr.w - o.w, fr.h - o.h);
          const area = fr.w * fr.h - o.w * o.h;
          const score = fit === 'short-side' ? shortSide : area;
          const tie = fit === 'short-side' ? area : shortSide;
          if (!best || score < best.score || (score === best.score && tie < best.tie)) {
            best = { sheet, rectIndex, w: o.w, h: o.h, rotated: o.rotated, score, tie };
          }
        }
      });
    }

    if (!best) {
      const sheet: WorkSheet = { free: [{ x: 0, y: 0, w: usableW, h: usableH }], placements: [] };
      sheets.push(sheet);
      const o = opts.find((x) => x.w <= usableW && x.h <= usableH)!;
      best = { sheet, rectIndex: 0, w: o.w, h: o.h, rotated: o.rotated, score: 0, tie: 0 };
    }

    const { sheet, rectIndex, w, h, rotated } = best as NonNullable<typeof best>;
    const fr = sheet.free[rectIndex];
    sheet.placements.push({ partKey: pc.partKey, label: pc.label, x: fr.x + trim, y: fr.y + trim, w: w - k, h: h - k, rotated });

    const rightW = fr.w - w;
    const bottomH = fr.h - h;
    const vertical = split === 'longer' ? rightW > bottomH : rightW <= bottomH;
    const next: Rect[] = vertical
      ? [{ x: fr.x + w, y: fr.y, w: rightW, h: fr.h }, { x: fr.x, y: fr.y + h, w, h: bottomH }]
      : [{ x: fr.x, y: fr.y + h, w: fr.w, h: bottomH }, { x: fr.x + w, y: fr.y, w: rightW, h }];
    sheet.free.splice(rectIndex, 1, ...next.filter((r) => r.w > k && r.h > k));
  }
  return { sheets, oversize };
}

/**
 * Guillotine nesting: every cut runs edge to edge, so layouts can be cut on a
 * panel saw. Several piece orders, fit rules and split rules are tried and the
 * layout with the fewest sheets (then the emptiest last sheet) wins.
 * Kerf is added to each piece; the usable area grows by one kerf so pieces may
 * touch the trimmed edge. Rotation is allowed only for materials without grain.
 */
export function nest(parts: Part[], role: MaterialRole, material: Material, kerf: number, trim: number): NestResult {
  const pieces: Piece[] = [];
  for (const p of parts) {
    if (p.role !== role) continue;
    for (let i = 0; i < p.qty; i++) {
      pieces.push({ partKey: p.key, label: `${p.unitCode} ${p.name}`, length: p.length, width: p.width });
    }
  }
  const k = Math.max(0, kerf);
  const lastArea = (r: Packed) => {
    const last = r.sheets[r.sheets.length - 1];
    return last ? last.placements.reduce((a, p) => a + p.w * p.h, 0) : 0;
  };

  // Fixed orders plus seeded "area order with jitter" restarts. Deterministic,
  // so the same project always produces the same layout.
  const orders: Piece[][] = ORDERS.map((o) => [...pieces].sort(o));
  const restarts = pieces.length <= 400 ? 40 : 8;
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < restarts; i++) {
    const keyed = pieces.map((p) => ({ p, key: p.length * p.width * (0.6 + 0.8 * rand()) }));
    orders.push(keyed.sort((a, b) => b.key - a.key).map((x) => x.p));
  }

  let result: Packed | null = null;
  for (const sorted of orders) {
    for (const fit of ['short-side', 'area'] as Fit[]) {
      for (const split of ['longer', 'shorter'] as Split[]) {
        const r = pack(sorted, material, k, trim, fit, split);
        if (!result || r.sheets.length < result.sheets.length || (r.sheets.length === result.sheets.length && lastArea(r) < lastArea(result))) {
          result = r;
        }
      }
    }
  }
  const { sheets, oversize } = result!;

  const full = material.sheetLength * material.sheetWidth;
  return {
    role,
    material,
    oversize,
    sheets: sheets.map((s, i) => {
      const usedArea = s.placements.reduce((a, p) => a + p.w * p.h, 0);
      return {
        role,
        index: i + 1,
        placements: s.placements,
        offcuts: s.free
          .map((r) => ({ x: r.x + trim, y: r.y + trim, w: r.w - k, h: r.h - k }))
          .filter((r) => r.w >= MIN_OFFCUT && r.h >= MIN_OFFCUT),
        usedArea,
        yield: usedArea / full,
      };
    }),
  };
}

export const ROLES: MaterialRole[] = ['carcass', 'front', 'back'];

export function nestAll(parts: Part[], materials: Record<MaterialRole, Material>, kerf: number, trim: number): NestResult[] {
  return ROLES.map((role) => nest(parts, role, materials[role], kerf, trim));
}
