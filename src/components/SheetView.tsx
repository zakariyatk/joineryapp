import { useId } from 'react';
import type { Material } from '../types';
import type { Sheet } from '../lib/nesting';

/** One nested sheet, drawn to scale in millimetres. */
export function SheetView({ sheet, material, title }: { sheet: Sheet; material: Material; title?: string }) {
  const L = material.sheetLength, W = material.sheetWidth;
  const k = L / 640; // mm per nominal pixel
  const pad = 30 * k;
  const off = 'o' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg viewBox={`${-pad} ${-pad - (title ? 16 * k : 0)} ${L + 2 * pad} ${W + 2 * pad + (title ? 16 * k : 0)}`} role="img"
      aria-label={`Sheet ${sheet.index} of ${material.name}: ${sheet.placements.length} parts, ${Math.round(sheet.yield * 100)}% yield`}>
      <defs>
        <pattern id={off} width={7 * k} height={7 * k} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={7 * k} stroke="#C9C3B8" strokeWidth={1.2 * k} />
        </pattern>
      </defs>
      {title && <text x={0} y={-pad + 2 * k} fontSize={13 * k} fontWeight={700} fontFamily="Segoe UI, sans-serif" fill="#1C1B19">{title}</text>}
      <rect x={0} y={0} width={L} height={W} fill={`url(#${off})`} stroke="#1C1B19" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {sheet.placements.map((p, i) => {
        const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
        const vertical = p.h > p.w * 1.6;
        const room = vertical ? p.h : p.w;
        const fs = Math.min(11 * k, room / 9, (vertical ? p.w : p.h) / 2.6);
        const size = p.rotated ? `${p.h} × ${p.w}` : `${p.w} × ${p.h}`;
        return (
          <g key={i}>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={p.rotated ? '#F5E2CC' : '#FDF1E4'} stroke="#92400E" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <g transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}>
              <text x={cx} y={cy - fs * 0.15} textAnchor="middle" fontSize={fs} fontWeight={600} fontFamily="Segoe UI, sans-serif" fill="#1C1B19">{p.label}</text>
              <text x={cx} y={cy + fs * 1.1} textAnchor="middle" fontSize={fs * 0.9} fontFamily="Segoe UI, sans-serif" fill="#4A4741">{size}</text>
            </g>
          </g>
        );
      })}
      <text x={L / 2} y={W + pad * 0.75} textAnchor="middle" fontSize={10 * k} fontFamily="Segoe UI, sans-serif" fill="#5F5B54">
        {L} × {W} mm · {material.grain ? 'grain along length' : 'no grain – parts may rotate'} · yield {(sheet.yield * 100).toFixed(1)}%
      </text>
    </svg>
  );
}
