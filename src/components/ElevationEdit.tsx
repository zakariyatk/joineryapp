import { useRef, useState, type PointerEvent } from 'react';
import type { Geometry, Label } from '../lib/drawing';
import { offOf, placeMoved, snap, wallRun } from '../lib/layout';
import type { DrawnCabinet, DrawnLayout, Pt } from '../types';
import type { Selection } from './DrawPlan';
import { DimInput, FitButton, usePanZoom } from './PanZoom';
import { GeometryShapes } from './UnitDrawing';

interface Props {
  g: Geometry;
  layout: DrawnLayout;
  wall: number;
  wallHeight: number;
  label: string;
  sel: Selection;
  onSelect(s: Selection): void;
  /** A cabinet dragged in the elevation: new left edge along the wall and new levels. */
  onMove(id: string, x: number, bottom: number, top: number): void;
  /** A dimension double-clicked and given a new value. */
  onEditDim(l: Label, v: number): void;
}

const ACCENT = '#B45309';
const GUIDE = '#2563EB';

/**
 * Elevation of one wall where cabinets can be dragged sideways (along the wall)
 * and up or down (their levels), snapping to 10 mm and to other cabinets'
 * edges and levels. Shift keeps the drag straight; Alt turns snapping off.
 * Drag empty space or use the middle button to pan; the wheel zooms.
 */
export function ElevationEdit({ g, layout, wall, wallHeight, label, sel, onSelect, onMove, onEditDim }: Props) {
  const [editing, setEditing] = useState<Label | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const pz = usePanZoom(svg, g.bounds, true);
  const press = useRef<{ c: DrawnCabinet; p: Pt; clientX: number; clientY: number } | null>(null);
  const [mv, setMv] = useState<{ c: DrawnCabinet; x: number; bottom: number; top: number; clash: boolean; gy?: number } | null>(null);
  const run = wallRun(layout, wall);
  const kv = Math.max(pz.view.w, pz.view.h) / 520;

  const toMM = (e: { clientX: number; clientY: number }): Pt => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  /** Area of a cabinet in the elevation (its plinth included for floor units). */
  const rect = (c: DrawnCabinet) => ({ x: c.x, y: -c.top, w: c.width, h: c.top - (c.layer === 'wall' ? c.bottom : 0) });
  const hit = (p: Pt) => run.cabinets
    .filter((c) => { const r = rect(c); return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; })
    .sort((a, b) => (a.top - a.bottom) - (b.top - b.bottom))[0];

  /** Levels worth snapping to: the floor, the wall top and every other cabinet's bottom and top. */
  const levels = (except: string) => [0, wallHeight, ...run.cabinets.filter((c) => c.id !== except).flatMap((c) => [c.bottom, c.top])];

  const down = (e: PointerEvent) => {
    const p = e.button === 0 ? toMM(e) : null;
    const c = p ? hit(p) : undefined;
    if (!c || !p) { pz.down(e); return; }
    svg.current?.focus();
    press.current = { c, p, clientX: e.clientX, clientY: e.clientY };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const move = (e: PointerEvent) => {
    if (pz.move(e)) return;
    const s = press.current;
    if (!s || Math.hypot(e.clientX - s.clientX, e.clientY - s.clientY) < 4) return;
    const p = toMM(e);
    let dx = p.x - s.p.x, dy = p.y - s.p.y;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const tol = e.altKey ? 0 : 10 * pz.perPx();
    const h = s.c.top - s.c.bottom;
    // Up and down: the bottom or the top snaps to another level, whichever is nearer.
    let bottom = s.c.bottom - dy;
    let gy: number | undefined;
    if (!e.altKey) {
      const ls = levels(s.c.id);
      const b = snap(bottom, ls, tol), t = snap(bottom + h, ls, tol) - h;
      const nb = ls.some((v) => Math.abs(v - bottom) <= tol), nt = ls.some((v) => Math.abs(v - (bottom + h)) <= tol);
      bottom = nt && (!nb || Math.abs(t - bottom) < Math.abs(b - bottom)) ? t : b;
      if (nb || nt) gy = nt && bottom === t ? bottom + h : bottom;
    } else bottom = Math.round(bottom);
    bottom = Math.max(0, bottom);
    const moved = { ...s.c, bottom, top: bottom + h };
    const placed = placeMoved(layout, moved, wall, e.altKey ? Math.round(s.c.x + dx) : s.c.x + dx, tol, offOf(s.c));
    if (placed) setMv({ c: s.c, x: placed.x, bottom, top: bottom + h, clash: placed.clash, gy });
  };

  const up = (e: PointerEvent) => {
    if (pz.up(e)) return;
    const s = press.current, m = mv;
    press.current = null;
    setMv(null);
    if (!s) return;
    const add = e.ctrlKey || e.shiftKey || e.metaKey;
    if (!m) {
      onSelect(add ? { ...sel, cabs: sel.cabs.includes(s.c.id) ? sel.cabs.filter((x) => x !== s.c.id) : [...sel.cabs, s.c.id] } : { cabs: [s.c.id], walls: [] });
      return;
    }
    onMove(s.c.id, m.x, m.bottom, m.top);
    if (!sel.cabs.includes(s.c.id)) onSelect({ cabs: [s.c.id], walls: [] });
  };

  const text = (x: number, y: number, s: string, color = ACCENT) => (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontFamily="Segoe UI, sans-serif" fontSize={12 * kv} fontWeight={700}
      fill={color} stroke="#fff" strokeWidth={3 * kv} paintOrder="stroke" pointerEvents="none">{s}</text>
  );

  return (
    <div className="zoom-wrap">
      <svg ref={svg} viewBox={pz.viewBox} preserveAspectRatio="xMidYMid meet" className="zoom-view elev-edit" tabIndex={0}
        role="application" aria-label={`${label}. Drag a cabinet to move it sideways or up and down; Shift keeps it straight, Alt skips snapping. Drag empty space to pan, scroll to zoom, double-click to fit.`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onDoubleClick={(e) => { if (!hit(toMM(e))) pz.fit(); }}
        onPointerCancel={() => { press.current = null; setMv(null); }}>
        <rect x={pz.view.x - pz.view.w} y={pz.view.y - pz.view.h} width={pz.view.w * 3} height={pz.view.h * 3} fill="transparent" />
        <GeometryShapes g={g} onEditDim={setEditing} />
        {run.cabinets.filter((c) => sel.cabs.includes(c.id)).map((c) => {
          const r = rect(c);
          return <rect key={c.id} x={r.x} y={r.y} width={r.w} height={r.h} fill={ACCENT} fillOpacity={0.12} stroke={ACCENT} strokeWidth={2.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />;
        })}
        {mv && (() => {
          const r = rect({ ...mv.c, x: mv.x, bottom: mv.bottom, top: mv.top });
          const col = mv.clash ? '#B42318' : ACCENT;
          return (
            <g pointerEvents="none">
              {mv.gy !== undefined && <line x1={pz.view.x} y1={-mv.gy} x2={pz.view.x + pz.view.w} y2={-mv.gy} stroke={GUIDE} strokeWidth={1} strokeDasharray={`${8 * kv} ${5 * kv}`} vectorEffect="non-scaling-stroke" />}
              <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={col} fillOpacity={0.15} stroke={col} strokeWidth={2.5} strokeDasharray={`${6 * kv} ${4 * kv}`} vectorEffect="non-scaling-stroke" />
              {text(r.x + r.w / 2, r.y + r.h / 2 - 9 * kv, `${mv.x} – ${mv.x + mv.c.width}`)}
              {text(r.x + r.w / 2, r.y + r.h / 2 + 9 * kv, `${mv.bottom} – ${mv.top} high`, GUIDE)}
              {mv.clash && text(r.x + r.w / 2, r.y + r.h / 2 + 27 * kv, 'overlaps', col)}
            </g>
          );
        })()}
      </svg>
      {editing && <DimInput svg={svg} label={editing} onCommit={(v) => { onEditDim(editing, v); setEditing(null); }} onCancel={() => setEditing(null)} />}
      <FitButton show={pz.zoomed} onClick={pz.fit} />
    </div>
  );
}
