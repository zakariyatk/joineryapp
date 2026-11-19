import { describe, expect, it } from 'vitest';
import { EMPTY_LAYOUT, layoutUnits, newCabinet, layoutOf } from './layout';
import { buildScene, sizeText } from './scene3d';
import { DEFAULT_RUN } from './run';
import type { DrawnLayout, Project } from '../types';

describe('3D view', () => {
  const base = newCabinet('base', 0, 600, 0, 'standard');
  const drawers = newCabinet('base', 600, 1200, 0, 'drawers');
  const sink = newCabinet('base', 1200, 2100, 0, 'sink');
  const up = newCabinet('wall', 0, 600, 0);
  const l: DrawnLayout = { ...EMPTY_LAYOUT, length: 3000, cabinets: [base, drawers, sink, up] };
  const scene = buildScene(l, layoutUnits(l, []));

  it('models every cabinet with carcass, fronts and handles', () => {
    const of = (id: string, kind: string) => scene.solids.filter((s) => s.id === id && s.kind === kind).length;
    expect(of(base.id, 'carcass')).toBe(1);
    expect(of(base.id, 'front')).toBe(2); // drawer + door
    expect(of(base.id, 'plinth')).toBe(1);
    expect(of(drawers.id, 'front')).toBe(3);
    expect(of(sink.id, 'front')).toBe(2);
    expect(of(up.id, 'plinth')).toBe(0);
    expect(of(up.id, 'handle')).toBe(1);
    // Fronts stand in front of the carcass: carcass depth 560 from the wall.
    const f = scene.solids.find((s) => s.id === base.id && s.kind === 'front')!;
    expect(f.o.y).toBe(560);
  });

  it('labels each cabinet with its reference and W × H × D, and the worktop level', () => {
    const tag = scene.tags.find((t) => t.id === base.id)!;
    expect(tag.lines).toEqual(['B1', '600 × 720 × 560', 'Normal']);
    expect(scene.tags.find((t) => t.id === up.id)!.lines[2]).toBe('from floor 1450');
    expect(scene.tags.some((t) => t.kind === 'level' && t.lines[0] === 'Worktop 858')).toBe(true);
    expect(sizeText(sink)).toBe('900 × 720 × 560');
  });

  it('puts floor dimensions in front: each width, then the whole wall', () => {
    expect(scene.dims.map((d) => d.text)).toEqual(['600', '600', '900', '3000']);
    expect(scene.dims.every((d) => d.a.y > 560)).toBe(true);
    expect(scene.solids.filter((s) => s.kind === 'worktop')).toHaveLength(1);
  });

  it('keeps an old wall-length project as its drawing', () => {
    const old = { run: DEFAULT_RUN } as unknown as Project;
    expect(layoutOf(old).cabinets.length).toBeGreaterThan(0);
    expect(layoutOf({} as Project).cabinets).toEqual([]);
  });
});
