import { describe, expect, it } from 'vitest';
import { hardwareCounts, unitParts } from './cabinet';
import { DEFAULT_SETTINGS, newProject, parseWidths, rowErrors, TEMPLATES, unitFromTemplate, unitsFromRows } from './defaults';
import { buildGeometry } from './drawing';
import { calculate } from './estimate';
import { geometryToDxf, cuttingListCsv } from './exporters';
import { nest } from './nesting';
import type { Part, RunConfig } from '../types';
import { applyRun, baseSpec, DEFAULT_RUN, isApplied, resolveRun, runUnits } from './run';
import { runDrawings } from './runDrawing';

const S = DEFAULT_SETTINGS;
const base = unitFromTemplate(TEMPLATES[0], []); // 600 × 720 × 560, 140 drawer, 1 shelf

describe('unitParts', () => {
  it('builds the standard base cabinet', () => {
    const parts = unitParts(base, S);
    const byName = Object.fromEntries(parts.map((p) => [p.name, p]));
    expect(byName['Side']).toMatchObject({ qty: 2, length: 720, width: 560, thickness: 18 });
    expect(byName['Bottom']).toMatchObject({ qty: 1, length: 564, width: 560 });
    expect(byName['Top rail']).toMatchObject({ qty: 2, length: 564, width: 100 });
    expect(byName['Shelf']).toMatchObject({ qty: 1, length: 563, width: 520 });
    expect(byName['Back']).toMatchObject({ length: 708, width: 576, thickness: 6, role: 'back' });
    expect(byName['Drawer front']).toMatchObject({ length: 596, width: 136, role: 'front' });
    expect(byName['Door']).toMatchObject({ qty: 1, length: 576, width: 596 });
  });

  it('splits wide units into two doors and multiplies by unit quantity', () => {
    const sink = { ...unitFromTemplate(TEMPLATES[1], []), qty: 3 };
    const door = unitParts(sink, S).find((p) => p.name === 'Door')!;
    expect(door).toMatchObject({ qty: 6, width: 396, length: 716 });
  });

  it('clamps nonsense input instead of producing negative parts', () => {
    const parts = unitParts({ ...base, width: 0, height: -5, drawerHeight: 5000 }, S);
    for (const p of parts) {
      expect(p.length).toBeGreaterThan(0);
      expect(p.width).toBeGreaterThan(0);
    }
  });

  it('counts hinges by door height', () => {
    const tall = unitFromTemplate(TEMPLATES[3], []); // 2100 high, 1 door
    expect(hardwareCounts([tall]).hinges).toBe(4);
    expect(hardwareCounts([base]).hinges).toBe(2);
  });
});

describe('nest', () => {
  const part = (length: number, width: number, qty: number): Part => ({
    key: `p${length}x${width}`, unitId: 'u', unitCode: 'X', name: 'P', qty, length, width, thickness: 18, role: 'carcass', edges: [false, false, false, false],
  });
  const mat = S.materials.carcass;

  it('places pieces inside the trimmed sheet without overlap', () => {
    const res = nest([part(720, 560, 6), part(564, 100, 8), part(300, 300, 5)], 'carcass', mat, 4, 10);
    expect(res.oversize).toHaveLength(0);
    for (const sh of res.sheets) {
      for (const p of sh.placements) {
        expect(p.x).toBeGreaterThanOrEqual(10);
        expect(p.y).toBeGreaterThanOrEqual(10);
        expect(p.x + p.w).toBeLessThanOrEqual(mat.sheetLength - 10 + 1e-9);
        expect(p.y + p.h).toBeLessThanOrEqual(mat.sheetWidth - 10 + 1e-9);
      }
      const ps = sh.placements;
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        const overlap = a.x < b.x + b.w + 4 - 1e-9 && b.x < a.x + a.w + 4 - 1e-9 && a.y < b.y + b.h + 4 - 1e-9 && b.y < a.y + a.h + 4 - 1e-9;
        expect(overlap).toBe(false);
      }
    }
    const placed = res.sheets.reduce((a, s) => a + s.placements.length, 0);
    expect(placed).toBe(19);
  });

  it('fits a 900 base + 800 sink + 600 wall carcass on two sheets', () => {
    const units = [
      { ...unitFromTemplate(TEMPLATES[0], []), width: 900 },
      unitFromTemplate(TEMPLATES[1], []),
      unitFromTemplate(TEMPLATES[2], []),
    ];
    const parts = units.flatMap((u) => unitParts(u, S));
    expect(nest(parts, 'carcass', mat, 4, 10).sheets).toHaveLength(2);
  });

  it('reports parts larger than the sheet', () => {
    const res = nest([part(3000, 500, 1)], 'carcass', mat, 4, 10);
    expect(res.sheets).toHaveLength(0);
    expect(res.oversize).toHaveLength(1);
  });

  it('never rotates grained material', () => {
    const res = nest([part(1000, 1150, 3)], 'carcass', { ...mat, grain: true }, 4, 10);
    expect(res.sheets.flatMap((s) => s.placements).every((p) => !p.rotated)).toBe(true);
  });
});

describe('calculate', () => {
  it('prices a sample kitchen and applies overhead, margin and tax in order', () => {
    const p = newProject('Test', 'Client');
    p.units = [unitFromTemplate(TEMPLATES[0], []), unitFromTemplate(TEMPLATES[2], [])];
    const c = calculate(p, S);
    expect(c.pieces).toBeGreaterThan(10);
    const t = c.totals;
    expect(t.subtotal).toBeCloseTo(t.Materials + t.Hardware + t.Labour + t.Extras);
    expect(t.overhead).toBeCloseTo(t.subtotal * 0.1);
    expect(t.margin).toBeCloseTo((t.subtotal + t.overhead) * 0.25);
    expect(t.grand).toBeCloseTo((t.subtotal + t.overhead + t.margin) * 1.18);
  });

  it('uses per-project overrides', () => {
    const p = newProject('Test', '');
    p.units = [base];
    p.estimate.overrides['hw:hinge'] = { q: 10, r: 1 };
    const line = calculate(p, S).lines.find((l) => l.key === 'hw:hinge')!;
    expect(line).toMatchObject({ q: 10, r: 1, amount: 10, overridden: true, autoQ: 2 });
  });
});

describe('adding several units at once', () => {
  it('creates one unit per row with its own size and the next free codes', () => {
    const existing = [unitFromTemplate(TEMPLATES[0], [])]; // B1
    const rows = [
      { name: 'Base cabinet', width: 300, height: 720, depth: 560, qty: 1 },
      { name: 'Base cabinet', width: 450, height: 720, depth: 560, qty: 2 },
      { name: 'Corner base', width: 900, height: 720, depth: 600, qty: 1 },
    ];
    const units = unitsFromRows(TEMPLATES[0], rows, existing);
    expect(units.map((u) => u.code)).toEqual(['B2', 'B3', 'B4']);
    expect(units.map((u) => [u.width, u.depth, u.qty])).toEqual([[300, 560, 1], [450, 560, 2], [900, 600, 1]]);
    expect(units[2].name).toBe('Corner base');
    expect(new Set(units.map((u) => u.id)).size).toBe(3);
  });

  it('parses width lists and rejects bad entries', () => {
    expect(parseWidths('300, 450 600;900')).toEqual([300, 450, 600, 900]);
    expect(parseWidths('300, abc')).toBeNull();
    expect(parseWidths('')).toEqual([]);
  });

  it('flags out-of-range sizes', () => {
    expect(rowErrors({ name: 'X', width: 600, height: 720, depth: 560, qty: 1 })).toEqual({});
    expect(Object.keys(rowErrors({ name: ' ', width: 50, height: 720, depth: 5000, qty: 0 })).sort()).toEqual(['depth', 'name', 'qty', 'width']);
  });
});

describe('build from wall length', () => {
  const cfg = (patch: Partial<RunConfig> = {}): RunConfig => ({ ...DEFAULT_RUN, ...patch });

  it('splits the length into equal cabinets within the max width, exactly', () => {
    const r = resolveRun(cfg({ length: 3000, maxWidth: 600 }));
    expect(r.errors).toEqual([]);
    expect(r.slots.map((s) => s.width)).toEqual([600, 600, 600, 600, 600]);
    const odd = resolveRun(cfg({ length: 3203, maxWidth: 600 })); // 6 cabinets, 3 mm left over
    expect(odd.slots.map((s) => s.width)).toEqual([534, 534, 534, 534, 534, 533]);
    expect(odd.slots.reduce((a, s) => a + s.width, 0)).toBe(3203);
    expect(odd.slots.map((s) => s.x)).toEqual([0, 534, 1068, 1602, 2136, 2670]);
  });

  it('keeps fixed widths and shares the rest', () => {
    const r = resolveRun(cfg({ length: 3000, count: 5, slots: [{ width: 800, kind: 'doors' }, { width: null, kind: 'standard' }, { width: 450, kind: 'standard' }] }));
    expect(r.errors).toEqual([]);
    expect(r.slots.map((s) => s.width)).toEqual([800, 584, 450, 583, 583]);
    expect(r.slots[0]).toMatchObject({ fixed: true, kind: 'doors' });
  });

  it('explains impossible settings', () => {
    expect(resolveRun(cfg({ length: 1000, count: 2, slots: [{ width: 600, kind: 'standard' }, { width: 600, kind: 'standard' }] })).errors[0]).toMatch(/200 mm too long/);
    expect(resolveRun(cfg({ length: 900, count: 8 })).errors[0]).toMatch(/Not enough length/);
    expect(resolveRun(cfg({ length: 0 })).errors.length).toBeGreaterThan(0);
  });

  it('creates base and wall cabinets, replacing earlier Build cabinets but keeping manual ones', () => {
    const manual = { ...unitFromTemplate(TEMPLATES[3], []) }; // T1, added by hand
    const c = cfg({ length: 1800, maxWidth: 600 });
    const slots = resolveRun(c).slots;
    const first = applyRun([manual], c, slots);
    expect(first.map((u) => u.code)).toEqual(['T1', 'B1', 'B2', 'B3', 'W1', 'W2', 'W3']);
    expect(first.filter((u) => u.type === 'wall').every((u) => u.depth === 320 && u.height === 720)).toBe(true);
    expect(isApplied(first, c, slots)).toBe(true);

    const c2 = cfg({ length: 1200, maxWidth: 600, wall: false });
    const second = applyRun(first, c2, resolveRun(c2).slots);
    expect(second.map((u) => u.code)).toEqual(['T1', 'B1', 'B2']);
    expect(isApplied(second, c, slots)).toBe(false);
  });

  it('draws plan, elevation and section with the run dimensions', () => {
    const c = cfg({ length: 2400 });
    const slots = resolveRun(c).slots;
    const { base, wall } = runUnits(c, slots, []);
    const v = runDrawings(c, slots, base, wall, S, 1);
    const texts = (g: { labels: { text: string }[] }) => g.labels.map((l) => l.text);
    expect(texts(v.elevation)).toEqual(expect.arrayContaining(['2400', '600', '100', '720', '38', '2170']));
    expect(texts(v.plan)).toEqual(expect.arrayContaining(['2400', 'B1', 'B4', 'W1', '598', '320']));
    expect(texts(v.section)).toEqual(expect.arrayContaining(['560', '598', '2170']));
    for (const g of [v.plan, v.elevation, v.section]) expect(g.bounds.w).toBeGreaterThan(0);
  });
});

describe('exports', () => {
  it('writes a DXF with entities and EOF', () => {
    const dxf = geometryToDxf(buildGeometry(base, 'front', S));
    expect(dxf.startsWith('0\r\nSECTION')).toBe(true);
    expect(dxf).toContain('LINE');
    expect(dxf).toContain('\r\n600\r\n');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });

  it('quotes CSV cells that contain commas', () => {
    const csv = cuttingListCsv(unitParts({ ...base, code: 'B1, left' }, S), S);
    expect(csv).toContain('"B1, left"');
  });
});

describe('drawer units', () => {
  const unit = { ...base, drawers: 3, drawerHeight: 140, shelves: 1 };

  it('has only drawer fronts filling the height, with runners and handles per drawer', () => {
    const parts = unitParts(unit, S);
    const fronts = parts.filter((p) => p.role === 'front');
    expect(fronts).toHaveLength(1);
    expect(fronts[0]).toMatchObject({ name: 'Drawer front', qty: 3, length: 596, width: 236 });
    expect(parts.some((p) => p.name === 'Shelf' || p.name === 'Door')).toBe(false);
    expect(hardwareCounts([unit])).toMatchObject({ hinges: 0, runners: 3, handles: 3, drawers: 3 });
  });

  it('comes out of a Build run as a drawer unit', () => {
    const c: RunConfig = { ...DEFAULT_RUN, length: 1200, count: 2, slots: [{ width: 600, kind: 'drawers', drawers: 4 }, { width: null, kind: 'doors' }], wall: false };
    const { base: units } = runUnits(c, resolveRun(c).slots, []);
    expect(units[0]).toMatchObject({ name: '4-drawer base unit', drawers: 4, drawerHeight: 0 });
    expect(units[1].drawers).toBeUndefined();
    expect(buildGeometry(units[0], 'front', S).boxes.filter((b) => b.kind === 'front')).toHaveLength(4);
  });
});

describe('base unit types', () => {
  const make = (kind: Parameters<typeof baseSpec>[0]) => ({ ...base, ...baseSpec(kind), drawers: baseSpec(kind).drawers ?? 0 });

  it('builds each kind with the right fronts and hardware', () => {
    const fronts = (k: Parameters<typeof baseSpec>[0]) => unitParts(make(k), S).filter((p) => p.role === 'front').map((p) => `${p.qty} ${p.name}`);
    expect(fronts('standard')).toEqual(['1 Drawer front', '1 Door']);
    expect(fronts('drawers')).toEqual(['3 Drawer front']);
    expect(fronts('pullout')).toEqual(['1 Drawer front']);
    expect(fronts('bin')).toEqual(['1 Drawer front']);
    expect(fronts('sink')).toEqual(['2 Door']);
    expect(fronts('door1')).toEqual(['1 Door']);
    expect(fronts('door2')).toEqual(['2 Door']);
    expect(hardwareCounts([make('pullout')])).toMatchObject({ hinges: 0, runners: 1, handles: 1 });
    expect(hardwareCounts([make('sink')])).toMatchObject({ hinges: 4, runners: 0, pins: 0 });
    expect(make('bin').name).toBe('Bin pull-out base unit');
  });
});
