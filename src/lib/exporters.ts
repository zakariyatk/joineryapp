import type { Part, Project, Settings, Unit } from '../types';
import type { BoxKind, Geometry, SegKind } from './drawing';
import type { ProjectCalc } from './estimate';
import { escapeHtml as h, money, num } from './format';

const ROLE_LABEL = { carcass: 'Carcass', front: 'Fronts', back: 'Backs' } as const;

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function cuttingListCsv(parts: Part[], settings: Settings): string {
  const head = ['No', 'Unit', 'Part', 'Qty', 'Length', 'Width', 'Thickness', 'Material', 'Edge L1', 'Edge L2', 'Edge W1', 'Edge W2'];
  const rows = parts.map((p, i) => [
    i + 1, p.unitCode, p.name, p.qty, p.length, p.width, p.thickness, settings.materials[p.role].name,
    ...p.edges.map((e) => (e ? 'Y' : '')),
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** ASCII DXF (R12 entities only) of a unit drawing, in millimetres, y up. */
export function geometryToDxf(g: Geometry): string {
  const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  const f = (n: number) => n.toFixed(3);
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
    out.push('0', 'LINE', '8', layer, '10', f(x1), '20', f(-y1), '30', '0', '11', f(x2), '21', f(-y2), '31', '0');
  const layerOf: Record<BoxKind, string> = {
    carcass: 'CARCASS', front: 'FRONTS', inset: 'FRONTS', plinth: 'CARCASS', back: 'CARCASS',
    worktop: 'WORKTOP', wallmass: 'BUILDING', hidden: 'HIDDEN', poche: 'BUILDING',
  };
  for (const b of g.boxes) {
    const L = layerOf[b.kind];
    line(L, b.x, b.y, b.x + b.w, b.y);
    line(L, b.x + b.w, b.y, b.x + b.w, b.y + b.h);
    line(L, b.x + b.w, b.y + b.h, b.x, b.y + b.h);
    line(L, b.x, b.y + b.h, b.x, b.y);
  }
  for (const p of g.polys ?? []) {
    if (p.kind === 'poche') continue; // fill only; its outline is drawn as lines
    p.pts.forEach((a, i) => { const b = p.pts[(i + 1) % p.pts.length]; line(layerOf[p.kind], a.x, a.y, b.x, b.y); });
  }
  const segLayer: Record<SegKind, string> = {
    outline: 'CARCASS', thin: 'CARCASS', dim: 'DIMENSIONS', ext: 'DIMENSIONS', hidden: 'HIDDEN', handle: 'FRONTS', swing: 'HIDDEN', floor: 'BUILDING',
  };
  for (const s of g.segs) line(segLayer[s.kind], s.x1, s.y1, s.x2, s.y2);
  for (const t of g.labels) {
    const layer = t.tone === 'note' ? 'NOTES' : 'DIMENSIONS';
    out.push('0', 'TEXT', '8', layer, '10', f(t.x), '20', f(-t.y), '30', '0', '40', f((t.size ?? 11) * g.k), '1', t.text,
      '50', t.angle !== undefined ? f(-t.angle) : t.vertical ? '90' : '0', '72', '1', '11', f(t.x), '21', f(-t.y), '31', '0',
      ...(t.middle ? ['73', '2'] : []));
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\r\n') + '\r\n';
}

const PRINT_CSS = `
  *{box-sizing:border-box} body{margin:0;font-family:"Segoe UI",Arial,sans-serif;color:#1C1B19;font-size:11pt}
  h1{font-size:20pt;margin:0 0 4px} h2{font-size:13pt;margin:18px 0 6px}
  .muted{color:#5F5B54} table{border-collapse:collapse;width:100%;margin-top:6px}
  th,td{border-bottom:1px solid #DDD8CF;padding:5px 6px;text-align:left;font-size:9.5pt}
  th{background:#F4F2EE;font-weight:600} .r{text-align:right} .tot td{font-weight:700;border-top:2px solid #1C1B19}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #B45309;padding-bottom:10px;margin-bottom:12px}
  .page{page-break-after:always} .page:last-child{page-break-after:auto}
  .tb{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid #1C1B19;margin-top:8px}
  .tb div{padding:6px 8px;border-right:1px solid #1C1B19;font-size:9pt} .tb div:last-child{border-right:0}
  svg{display:block;width:100%;height:auto}
`;

function doc(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${h(title)}</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`;
}

export function quoteHtml(project: Project, settings: Settings, calc: ProjectCalc, quoteNo: string): string {
  const c = settings.currency;
  const e = project.estimate;
  const t = calc.totals;
  const unitRows = project.units
    .map((u) => `<tr><td>${h(u.code)}</td><td>${h(u.name)}</td><td class="r">${u.qty}</td><td>${u.width} × ${u.height + u.plinth} × ${u.depth} mm</td></tr>`)
    .join('');
  const sections = (['Materials', 'Hardware', 'Labour', 'Extras'] as const)
    .filter((s) => t[s] > 0)
    .map((s) => `<tr><td>${s}</td><td class="r">${money(t[s], c)}</td></tr>`)
    .join('');
  const today = new Date();
  const valid = new Date(today.getTime() + 30 * 86400000);
  const d = (x: Date) => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return doc(`Quote ${quoteNo}`, `
    <div class="head"><div><h1>${h(settings.company)}</h1><div class="muted">Joinery quotation</div></div>
      <div style="text-align:right"><div><b>Quote ${h(quoteNo)}</b></div><div class="muted">Date ${d(today)}<br>Valid until ${d(valid)}</div></div></div>
    <div><b>Client:</b> ${h(project.client || '—')}<br><b>Project:</b> ${h(project.name)}</div>
    <h2>Scope of work</h2>
    <table><thead><tr><th>Ref</th><th>Item</th><th class="r">Qty</th><th>Overall size (W × H × D)</th></tr></thead><tbody>${unitRows}</tbody></table>
    <h2>Price</h2>
    <table><tbody>${sections}
      <tr><td>Overheads, supervision and profit</td><td class="r">${money(t.overhead + t.margin, c)}</td></tr>
      <tr><td>Subtotal</td><td class="r">${money(t.subtotal + t.overhead + t.margin, c)}</td></tr>
      <tr><td>Tax (${e.tax}%)</td><td class="r">${money(t.tax, c)}</td></tr>
      <tr class="tot"><td>Total</td><td class="r">${money(t.grand, c)}</td></tr></tbody></table>
    <p class="muted" style="margin-top:18px;font-size:9pt">Materials: ${h(settings.materials.carcass.name)} carcass, ${h(settings.materials.front.name)} fronts, ${h(settings.materials.back.name)} backs. Includes manufacture, delivery and installation as listed.</p>`);
}

export function cuttingListHtml(project: Project, settings: Settings, calc: ProjectCalc, sheetSvgs: string[]): string {
  const rows = calc.parts
    .map((p, i) => `<tr><td>${i + 1}</td><td>${h(p.unitCode)}</td><td>${h(p.name)}</td><td class="r">${p.qty}</td><td class="r">${p.length}</td><td class="r">${p.width}</td><td class="r">${p.thickness}</td><td>${h(settings.materials[p.role].name)}</td><td>${['L1', 'L2', 'W1', 'W2'].filter((_, k) => p.edges[k]).join(' ')}</td></tr>`)
    .join('');
  const summary = calc.nests
    .filter((n) => n.sheets.length)
    .map((n) => `${ROLE_LABEL[n.role]}: ${n.sheets.length} × ${h(n.material.name)}`)
    .join(' · ');
  const layouts = sheetSvgs.map((s) => `<div class="page">${s}</div>`).join('');
  return doc(`Cutting list – ${project.name}`, `
    <div class="page"><div class="head"><div><h1>Cutting list</h1><div class="muted">${h(project.name)} · ${h(project.client)}</div></div>
      <div style="text-align:right" class="muted">${calc.pieces} parts · edge banding ${num(calc.edgeMetres)} m<br>${summary}</div></div>
    <table><thead><tr><th>#</th><th>Unit</th><th>Part</th><th class="r">Qty</th><th class="r">Length</th><th class="r">Width</th><th class="r">Thk</th><th>Material</th><th>Edges</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${layouts}`);
}

/** One landscape sheet: plan, elevation and section of a run plus its cabinet schedule. */
export function buildSheetHtml(project: Project, views: { title: string; svg: string }[], rows: { code: string; name: string; size: string }[]): string {
  const cells = views.map((v) => `<div class="cell"><div class="muted" style="font-size:9pt;margin-bottom:4px;font-weight:600">${h(v.title)}</div>${v.svg}</div>`).join('');
  const table = `<div class="cell"><div class="muted" style="font-size:9pt;margin-bottom:4px;font-weight:600">CABINET SCHEDULE</div>
    <table><thead><tr><th>Ref</th><th>Item</th><th>W × H × D (mm)</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${h(r.code)}</td><td>${h(r.name)}</td><td>${h(r.size)}</td></tr>`).join('')}</tbody></table></div>`;
  return doc(`Build – ${project.name}`, `
    <style>.grid{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:88mm 88mm;gap:6mm}.cell{border:1px solid #DDD8CF;padding:3mm;overflow:hidden}.cell svg{height:78mm}</style>
    <div class="head" style="margin-bottom:6px"><div><h1 style="font-size:15pt">${h(project.name)}</h1><div class="muted">${h(project.client || '')}</div></div>
      <div class="muted" style="text-align:right">Plan · Elevation · Section<br>${new Date().toLocaleDateString('en-GB')} · dimensions in mm</div></div>
    <div class="grid">${cells}${table}</div>`);
}

export function drawingSheetHtml(project: Project, unit: Unit, settings: Settings, svgs: { title: string; svg: string }[]): string {
  const views = svgs.map((v) => `<div style="flex:1"><div class="muted" style="font-size:9pt;margin-bottom:4px">${h(v.title)}</div>${v.svg}</div>`).join('');
  return doc(`${unit.code} – ${project.name}`, `
    <div style="display:flex;gap:24px;align-items:flex-start;min-height:150mm">${views}</div>
    <div class="tb">
      <div><span class="muted">Project</span><br><b>${h(project.name)}</b></div>
      <div><span class="muted">Unit</span><br><b>${h(unit.code)} · ${h(unit.name)} × ${unit.qty}</b></div>
      <div><span class="muted">Overall W × H × D</span><br><b>${unit.width} × ${unit.height + unit.plinth} × ${unit.depth}</b></div>
      <div><span class="muted">Carcass</span><br><b>${h(settings.materials.carcass.name)}</b></div>
      <div><span class="muted">Date · units</span><br><b>${new Date().toLocaleDateString('en-GB')} · mm</b></div>
    </div>`);
}

/** One row of the 3D view's cabinet schedule. */
export interface ScheduleRow { code: string; name: string; wall: string; size: string; from: string; gap: string }

/** Landscape sheet for the workshop: the 3D picture with its labels, then the cabinet schedule. */
export function view3dSheetHtml(project: Project, image: string, rows: ScheduleRow[]): string {
  const safeImage = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) ? image : '';
  return doc(`3D view – ${project.name}`, `
    <div class="head" style="margin-bottom:6px"><div><h1 style="font-size:15pt">${h(project.name)}</h1><div class="muted">${h(project.client || '')}</div></div>
      <div class="muted" style="text-align:right">3D view · cabinet schedule<br>${new Date().toLocaleDateString('en-GB')} · sizes in mm (width × height × depth)</div></div>
    <div class="page">${safeImage ? `<img src="${safeImage}" style="display:block;width:100%;max-height:150mm;object-fit:contain;border:1px solid #DDD8CF">` : ''}</div>
    <h2>Cabinet schedule</h2>
    <table><thead><tr><th>Ref</th><th>Cabinet</th><th>Wall</th><th class="r">W × H × D</th><th class="r">From floor</th><th class="r">Gap from wall</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><b>${h(r.code)}</b></td><td>${h(r.name)}</td><td>${h(r.wall)}</td><td class="r"><b>${h(r.size)}</b></td><td class="r">${h(r.from)}</td><td class="r">${h(r.gap)}</td></tr>`).join('')}
    </tbody></table>`);
}
