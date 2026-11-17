import { describe, expect, it } from 'vitest';
import { hardwareCounts, unitParts } from './cabinet';
import { DEFAULT_SETTINGS, newProject, TEMPLATES, unitFromTemplate } from './defaults';
import { buildGeometry } from './drawing';
import { calculate } from './estimate';
import { geometryToDxf, cuttingListCsv } from './exporters';
import { nest } from './nesting';
import type { Part } from '../types';

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
