import type { Project, Settings } from '../types';
import { edgeLength, hardwareCounts, normalise, partArea, projectParts } from './cabinet';
import { nestAll, type NestResult } from './nesting';

export type Section = 'Materials' | 'Hardware' | 'Labour' | 'Extras';

export interface EstLine {
  key: string;
  section: Section;
  name: string;
  unit: string;
  autoQ: number;
  autoR: number;
  q: number;
  r: number;
  amount: number;
  overridden: boolean;
}

export interface Totals {
  Materials: number;
  Hardware: number;
  Labour: number;
  Extras: number;
  subtotal: number;
  overhead: number;
  margin: number;
  tax: number;
  grand: number;
}

export interface ProjectCalc {
  parts: ReturnType<typeof projectParts>;
  nests: NestResult[];
  pieces: number;
  edgeMetres: number; // banded length incl. waste, rounded up
  edgeMetresRaw: number;
  lines: EstLine[];
  totals: Totals;
  unitCount: number;
}

const halfHours = (h: number) => (h <= 0 ? 0 : Math.max(0.5, Math.ceil(h * 2) / 2));

/** Everything derived from a project: parts, sheet layouts and the priced estimate. */
export function calculate(project: Project, settings: Settings): ProjectCalc {
  const parts = projectParts(project.units, settings);
  const nests = nestAll(parts, settings.materials, settings.kerf, settings.trim);
  const pieces = parts.reduce((a, p) => a + p.qty, 0);
  const edgeMetresRaw = parts.reduce((a, p) => a + edgeLength(p), 0) / 1000;
  const edgeMetres = Math.ceil(edgeMetresRaw * (1 + settings.edgeWaste / 100));
  const hw = hardwareCounts(project.units);
  const unitCount = project.units.reduce((a, u) => a + normalise(u).qty, 0);
  const frontArea = parts.filter((p) => p.role === 'front').reduce((a, p) => a + partArea(p), 0) / 1e6;
  const totalSheets = nests.reduce((a, n) => a + n.sheets.length, 0);

  const base: Omit<EstLine, 'q' | 'r' | 'amount' | 'overridden'>[] = [];
  for (const n of nests) {
    if (n.sheets.length === 0) continue;
    const m = n.material;
    base.push({ key: `mat:${n.role}`, section: 'Materials', name: `${m.name} ${m.sheetLength} × ${m.sheetWidth}`, unit: 'sheet', autoQ: n.sheets.length, autoR: m.price });
  }
  if (edgeMetres > 0) base.push({ key: 'mat:edge', section: 'Materials', name: 'Edge banding', unit: 'metre', autoQ: edgeMetres, autoR: settings.edgeBandPrice });

  const h = settings.hardware;
  const hwLines: [string, string, string, number, number][] = [
    ['hinge', 'Soft-close hinges', 'pc', hw.hinges, h.hinge],
    ['runner', 'Drawer runners', 'pair', hw.runners, h.runner],
    ['handle', 'Handles', 'pc', hw.handles, h.handle],
    ['leg', 'Adjustable legs', 'pc', hw.legs, h.leg],
    ['pin', 'Shelf pins', 'pc', hw.pins, h.shelfPin],
    ['fittings', 'Cam & dowel fittings', 'set', hw.fittings, h.fittings],
    ['hanger', 'Wall hanging brackets', 'pair', hw.hangers, h.wallHanger],
  ];
  for (const [k, name, unit, q, r] of hwLines) if (q > 0) base.push({ key: `hw:${k}`, section: 'Hardware', name, unit, autoQ: q, autoR: r });

  const lr = settings.labourRates;
  const labour: [string, string, number, number][] = [
    ['cutting', 'Panel cutting', halfHours(pieces * 0.08 + totalSheets * 0.25), lr.cutting],
    ['edging', 'Edge banding', halfHours(edgeMetresRaw * 0.05), lr.edging],
    ['assembly', 'Assembly', halfHours(unitCount * 1.5 + hw.drawers * 0.5), lr.assembly],
    ['finishing', 'Finishing (fronts)', halfHours(frontArea * 0.8), lr.finishing],
    ['install', 'Delivery & installation', halfHours(unitCount * 0.75), lr.install],
  ];
  for (const [k, name, q, r] of labour) if (q > 0) base.push({ key: `lab:${k}`, section: 'Labour', name, unit: 'hr', autoQ: q, autoR: r });

  const ov = project.estimate.overrides;
  const lines: EstLine[] = base.map((l) => {
    const o = ov[l.key] ?? {};
    const q = o.q ?? l.autoQ;
    const r = o.r ?? l.autoR;
    return { ...l, q, r, amount: q * r, overridden: o.q !== undefined || o.r !== undefined };
  });
  for (const x of project.estimate.extras) {
    lines.push({ key: `extra:${x.id}`, section: 'Extras', name: x.name, unit: x.unit, autoQ: x.q, autoR: x.r, q: x.q, r: x.r, amount: x.q * x.r, overridden: false });
  }

  const sum = (s: Section) => lines.filter((l) => l.section === s).reduce((a, l) => a + l.amount, 0);
  const t = { Materials: sum('Materials'), Hardware: sum('Hardware'), Labour: sum('Labour'), Extras: sum('Extras') };
  const subtotal = t.Materials + t.Hardware + t.Labour + t.Extras;
  const e = project.estimate;
  const overhead = (subtotal * e.overhead) / 100;
  const margin = ((subtotal + overhead) * e.margin) / 100;
  const tax = ((subtotal + overhead + margin) * e.tax) / 100;

  return {
    parts, nests, pieces, edgeMetres, edgeMetresRaw, lines, unitCount,
    totals: { ...t, subtotal, overhead, margin, tax, grand: subtotal + overhead + margin + tax },
  };
}
