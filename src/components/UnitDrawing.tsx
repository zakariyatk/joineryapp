import { useId } from 'react';
import { buildGeometry, type BoxKind, type SegKind, type View } from '../lib/drawing';
import type { Settings, Unit } from '../types';

const BOX: Record<BoxKind, { fill: string; sw: number }> = {
  carcass: { fill: '#FFFFFF', sw: 1.5 },
  front: { fill: '#FBF5EC', sw: 1 },
  inset: { fill: 'none', sw: 0.75 },
  plinth: { fill: 'hatch', sw: 1 },
  back: { fill: '#E8EEFB', sw: 0.75 },
};

const SEG: Record<SegKind, { stroke: string; sw: number; dash?: number }> = {
  outline: { stroke: '#1C1B19', sw: 1.5 },
  thin: { stroke: '#1C1B19', sw: 0.75 },
  dim: { stroke: '#1D4ED8', sw: 1 },
  ext: { stroke: '#9DB3EE', sw: 0.75 },
  hidden: { stroke: '#1C1B19', sw: 1, dash: 6 },
  handle: { stroke: '#1C1B19', sw: 3 },
  swing: { stroke: '#8A857C', sw: 0.8, dash: 6 },
};

interface Props {
  unit: Unit;
  view: View;
  settings: Settings;
}

/** Dimensioned orthographic drawing. The viewBox is in millimetres. */
export function UnitDrawing({ unit, view, settings }: Props) {
  const g = buildGeometry(unit, view, settings);
  const hatch = 'h' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const { x, y, w, h } = g.bounds;
  const k = g.k;
  return (
    <svg viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img"
      aria-label={`${view === 'front' ? 'Front elevation' : 'Side section'} of ${unit.code} ${unit.name}, ${unit.width} wide, ${unit.height} high, ${unit.depth} deep`}>
      <defs>
        <pattern id={hatch} width={6 * k} height={6 * k} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={6 * k} stroke="#8A857C" strokeWidth={k} />
        </pattern>
      </defs>
      {g.boxes.map((b, i) => {
        const s = BOX[b.kind];
        return <rect key={`b${i}`} x={b.x} y={b.y} width={Math.max(0, b.w)} height={Math.max(0, b.h)} fill={s.fill === 'hatch' ? `url(#${hatch})` : s.fill} stroke="#1C1B19" strokeWidth={s.sw} vectorEffect="non-scaling-stroke" />;
      })}
      {g.segs.map((sg, i) => {
        const s = SEG[sg.kind];
        return <line key={`s${i}`} x1={sg.x1} y1={sg.y1} x2={sg.x2} y2={sg.y2} stroke={s.stroke} strokeWidth={s.sw} strokeDasharray={s.dash ? `${s.dash * k} ${(s.dash - 2) * k}` : undefined} strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
      })}
      {g.labels.map((l, i) => (
        <text key={`t${i}`} x={l.x} y={l.y} transform={l.vertical ? `rotate(-90 ${l.x} ${l.y})` : undefined} textAnchor="middle" dominantBaseline={l.vertical ? 'auto' : 'auto'}
          fontFamily="Segoe UI, sans-serif" fontSize={12 * k} fontWeight={600} fill="#1D4ED8">{l.text}</text>
      ))}
    </svg>
  );
}
