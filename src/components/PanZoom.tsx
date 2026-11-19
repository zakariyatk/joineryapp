import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from 'react';
import type { Geometry, Label } from '../lib/drawing';
import { GeometryShapes } from './UnitDrawing';

export interface ViewBox { x: number; y: number; w: number; h: number }

const ZOOM = 1.2;

/**
 * Mouse pan and zoom for an SVG drawn in millimetres: the wheel zooms about the
 * cursor, the middle button (or the left one, with `leftPan`) drags the view.
 * `frame` is the fitted view; zooming or panning holds a view until `fit()`.
 */
export function usePanZoom(svg: RefObject<SVGSVGElement | null>, frame: ViewBox, leftPan = false) {
  const [vb, setVb] = useState<ViewBox | null>(null);
  const view = vb ?? frame;
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<{ x: number; y: number; v: ViewBox; id: number } | null>(null);

  /** Millimetres per screen pixel for the current view (the SVG fits the view inside its box). */
  const perPx = (v: ViewBox) => {
    const el = svg.current;
    if (!el) return 1;
    return Math.max(v.w / Math.max(1, el.clientWidth), v.h / Math.max(1, el.clientHeight));
  };

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const pt = el.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const ctm = el.getScreenCTM();
      if (!ctm) return;
      const p = pt.matrixTransform(ctm.inverse());
      const f = e.deltaY > 0 ? ZOOM : 1 / ZOOM;
      const w = Math.min(Math.max(v.w * f, frame.w / 200), frame.w * 20);
      const s = w / v.w;
      setVb({ x: p.x - (p.x - v.x) * s, y: p.y - (p.y - v.y) * s, w, h: v.h * s });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [svg, frame.w]);

  /** Start a pan if this press is a pan press; returns true when it was. */
  const down = (e: PointerEvent) => {
    if (!(e.button === 1 || (leftPan && e.button === 0))) return false;
    e.preventDefault();
    drag.current = { x: e.clientX, y: e.clientY, v: view, id: e.pointerId };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    return true;
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return false;
    const s = perPx(d.v);
    setVb({ ...d.v, x: d.v.x - (e.clientX - d.x) * s, y: d.v.y - (e.clientY - d.y) * s });
    return true;
  };
  const up = (e: PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return false;
    drag.current = null;
    return true;
  };

  return {
    view,
    viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`,
    zoomed: vb !== null,
    fit: () => setVb(null),
    down, move, up,
    /** Millimetres per screen pixel right now. */
    perPx: () => perPx(view),
  };
}

/** Small "Fit" button shown over a zoomed view. */
export function FitButton({ show, onClick }: { show: boolean; onClick(): void }) {
  if (!show) return null;
  return (
    <button type="button" className="btn2 fit-btn" onClick={onClick} title="Fit the drawing to the view (or double-click the drawing)">Fit</button>
  );
}

/**
 * Revit-style editing of a dimension: an input box over the dimension's text.
 * Enter or clicking away applies the value; Escape cancels. Simple sums like
 * "600+18" or "2400/4" are worked out.
 */
export function DimInput({ svg, label, onCommit, onCancel }: { svg: RefObject<SVGSVGElement | null>; label: Label; onCommit(v: number): void; onCancel(): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(label.text);
  const done = useRef(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const el = svg.current, wrap = el?.parentElement;
    const ctm = el?.getScreenCTM();
    if (!el || !wrap || !ctm) return;
    const pt = el.createSVGPoint();
    pt.x = label.x; pt.y = label.y;
    const p = pt.matrixTransform(ctm);
    const r = wrap.getBoundingClientRect();
    setPos({ left: p.x - r.left, top: p.y - r.top });
  }, [svg, label]);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [pos]);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const v = evalLength(text);
    if (v !== null && String(Math.round(v)) !== label.text) onCommit(v);
    else onCancel();
  };
  if (!pos) return null;
  return (
    <input ref={input} className="dim-input" style={{ left: pos.left, top: pos.top }} value={text} aria-label="New dimension in millimetres"
      inputMode="decimal" onChange={(e) => setText(e.target.value)} onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { done.current = true; onCancel(); }
      }} />
  );
}

/** A typed length: a number or a simple sum like "600+18" or "2400/4" (+ - * /). Null if it is not one. */
export function evalLength(s: string): number | null {
  const t = s.replace(/\s+/g, '').replace(/mm$/i, '');
  const parts = t.match(/^-?\d*\.?\d+|[+\-*/]-?\d*\.?\d+/g);
  if (!t || !parts || parts.join('') !== t) return null;
  // Multiply and divide first, then add and subtract.
  const terms: number[] = [];
  for (const p of parts) {
    const op = /^[+\-*/]/.test(p) && terms.length ? p[0] : '+';
    const n = Number(op === p[0] && terms.length ? p.slice(1) : p);
    if (!Number.isFinite(n)) return null;
    if (op === '*') terms[terms.length - 1] *= n;
    else if (op === '/') { if (n === 0) return null; terms[terms.length - 1] /= n; }
    else terms.push(op === '-' ? -n : n);
  }
  const v = terms.reduce((a, b) => a + b, 0);
  return Number.isFinite(v) ? v : null;
}

/** A drawing you can zoom with the wheel and pan by dragging; double-click to fit it again. Double-click a dimension to change it. */
export function ZoomView({ g, label, children, onEditDim }: { g: Geometry; label: string; children?: ReactNode; onEditDim?(l: Label, v: number): void }) {
  const svg = useRef<SVGSVGElement>(null);
  const pz = usePanZoom(svg, g.bounds, true);
  const [editing, setEditing] = useState<Label | null>(null);
  return (
    <div className="zoom-wrap">
      <svg ref={svg} viewBox={pz.viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${label}. Scroll to zoom, drag to pan, double-click to fit${onEditDim ? '; double-click a dimension to change it' : ''}.`}
        className="zoom-view" onPointerDown={pz.down} onPointerMove={pz.move} onPointerUp={pz.up} onDoubleClick={pz.fit}>
        <GeometryShapes g={g} onEditDim={onEditDim ? setEditing : undefined} />
        {children}
      </svg>
      {editing && onEditDim && <DimInput svg={svg} label={editing} onCommit={(v) => { onEditDim(editing, v); setEditing(null); }} onCancel={() => setEditing(null)} />}
      <FitButton show={pz.zoomed} onClick={pz.fit} />
    </div>
  );
}
