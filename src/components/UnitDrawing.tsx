import { useId } from 'react';
import { buildGeometry, type BoxKind, type Geometry, type Label, type SegKind, type View } from '../lib/drawing';
import type { Settings, Unit } from '../types';

const BOX: Record<BoxKind, { fill: string; stroke: string; sw: number; dash?: number }> = {
  carcass: { fill: '#FFFFFF', stroke: '#1C1B19', sw: 1.5 },
  front: { fill: '#FBF5EC', stroke: '#1C1B19', sw: 1 },
  inset: { fill: 'none', stroke: '#1C1B19', sw: 0.75 },
  plinth: { fill: 'hatch', stroke: '#1C1B19', sw: 1 },
  back: { fill: '#E8EEFB', stroke: '#1C1B19', sw: 0.75 },
  worktop: { fill: '#E9E2D6', stroke: '#1C1B19', sw: 1.25 },
  wallmass: { fill: 'hatch', stroke: '#1C1B19', sw: 1.5 },
  hidden: { fill: 'none', stroke: '#1C1B19', sw: 1, dash: 6 },
  poche: { fill: 'hatch', stroke: 'none', sw: 0 },
};

const SEG: Record<SegKind, { stroke: string; sw: number; dash?: number }> = {
  outline: { stroke: '#1C1B19', sw: 1.5 },
  thin: { stroke: '#1C1B19', sw: 0.75 },
  dim: { stroke: '#1D4ED8', sw: 1 },
  ext: { stroke: '#9DB3EE', sw: 0.75 },
  hidden: { stroke: '#1C1B19', sw: 1, dash: 6 },
  handle: { stroke: '#1C1B19', sw: 3 },
  swing: { stroke: '#8A857C', sw: 0.8, dash: 6 },
  floor: { stroke: '#1C1B19', sw: 2.5 },
};

/** Renders drawing primitives. The viewBox is in millimetres; strokes stay a constant screen width. */
export function GeometryView({ g, label }: { g: Geometry; label: string }) {
  const { x, y, w, h } = g.bounds;
  return (
    <svg viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
      <GeometryShapes g={g} />
    </svg>
  );
}

/**
 * The shapes of a drawing, for use inside another <svg> in the same millimetre coordinates.
 * With `onEditDim`, dimensions that can be changed respond to a double-click.
 */
export function GeometryShapes({ g, onEditDim }: { g: Geometry; onEditDim?(l: Label): void }) {
  const hatch = 'h' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = g.k;
  const dash = (d?: number) => (d ? `${d * k} ${(d - 2) * k}` : undefined);
  return (
    <>
      <defs>
        <pattern id={hatch} width={6 * k} height={6 * k} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={6 * k} stroke="#8A857C" strokeWidth={k} />
        </pattern>
      </defs>
      {g.boxes.map((b, i) => {
        const s = BOX[b.kind];
        return <rect key={`b${i}`} x={b.x} y={b.y} width={Math.max(0, b.w)} height={Math.max(0, b.h)} fill={s.fill === 'hatch' ? `url(#${hatch})` : s.fill}
          stroke={s.stroke} strokeWidth={s.sw} strokeDasharray={dash(s.dash)} vectorEffect="non-scaling-stroke" />;
      })}
      {(g.polys ?? []).map((p, i) => {
        const s = BOX[p.kind];
        return <polygon key={`p${i}`} points={p.pts.map((q) => `${q.x},${q.y}`).join(' ')} fill={s.fill === 'hatch' ? `url(#${hatch})` : s.fill}
          stroke={s.stroke} strokeWidth={s.sw} strokeDasharray={dash(s.dash)} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />;
      })}
      {g.segs.map((sg, i) => {
        const s = SEG[sg.kind];
        return <line key={`s${i}`} x1={sg.x1} y1={sg.y1} x2={sg.x2} y2={sg.y2} stroke={s.stroke} strokeWidth={s.sw} strokeDasharray={dash(s.dash)} strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
      })}
      {g.labels.map((l, i) => (
        <text key={`t${i}`} x={l.x} y={l.y}
          {...(onEditDim && l.edit ? {
            className: 'dim-edit',
            onPointerDown: (e: { stopPropagation(): void }) => e.stopPropagation(),
            onDoubleClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); onEditDim(l); },
          } : {})} transform={l.angle ? `rotate(${l.angle} ${l.x} ${l.y})` : l.vertical ? `rotate(-90 ${l.x} ${l.y})` : undefined} textAnchor="middle"
          dominantBaseline={l.tone === 'note' || l.middle ? 'central' : undefined}
          stroke={l.tone === 'note' ? undefined : '#FFFFFF'} strokeWidth={l.tone === 'note' ? undefined : 3 * k} strokeLinejoin="round" paintOrder="stroke" fontFamily="Segoe UI, sans-serif" fontSize={(l.size ?? 12) * k}
          fontWeight={l.tone === 'note' ? 700 : 600} fill={l.tone === 'note' ? '#1C1B19' : '#1D4ED8'}>{l.text}</text>
      ))}
    </>
  );
}

interface Props {
  unit: Unit;
  view: View;
  settings: Settings;
}

/** Dimensioned orthographic drawing of one unit. */
export function UnitDrawing({ unit, view, settings }: Props) {
  return (
    <GeometryView g={buildGeometry(unit, view, settings)}
      label={`${view === 'front' ? 'Front elevation' : 'Side section'} of ${unit.code} ${unit.name}, ${unit.width} wide, ${unit.height} high, ${unit.depth} deep`} />
  );
}
