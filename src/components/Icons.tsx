import type { ReactNode } from 'react';

function Svg({ children, size = 18, sw = 1.8 }: { children: ReactNode; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconProjects = () => <Svg><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>;
export const IconDrawing = () => <Svg><path d="M3 21V3l18 18z" /><path d="M7 17v-5l5 5z" /></Svg>;
export const IconList = () => <Svg><path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1" /></Svg>;
export const IconCalc = () => <Svg><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2" /></Svg>;
export const IconSettings = () => <Svg><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></Svg>;
export const IconPlus = () => <Svg size={16} sw={2.2}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconDownload = () => <Svg size={16} sw={2}><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></Svg>;
export const IconCheck = () => <Svg size={14} sw={3}><path d="M5 12l5 5 9-10" /></Svg>;
export const IconTrash = () => <Svg size={16}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Svg>;
export const IconCopy = () => <Svg size={16}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></Svg>;
export const IconReset = () => <Svg size={14} sw={2}><path d="M4 4v6h6" /><path d="M4.5 15a8 8 0 1 0 1.9-8.3L4 10" /></Svg>;

export function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#B45309" />
      <path d="M8 22V10h5l-2 5h10l-2-5h5v12z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

/** Small line pictures of the unit templates. */
export function TemplateIcon({ label }: { label: string }) {
  const p = { width: 40, height: 40, viewBox: '0 0 40 40', fill: 'none', stroke: '#1C1B19', strokeWidth: 1.5, 'aria-hidden': true } as const;
  switch (label) {
    case 'Base cabinet': return <svg {...p}><rect x="6" y="5" width="28" height="25" /><path d="M6 12h28M17 8.5h6" /><rect x="9" y="30" width="22" height="5" /></svg>;
    case 'Sink base': return <svg {...p}><rect x="4" y="5" width="32" height="25" /><path d="M20 5v25M17 9v4M23 9v4" /><rect x="7" y="30" width="26" height="5" /></svg>;
    case 'Wall cabinet': return <svg {...p}><rect x="6" y="5" width="28" height="26" /><path d="M20 5v26M17 25v3M23 25v3" /></svg>;
    case 'Tall unit': return <svg {...p}><rect x="12" y="2" width="16" height="34" /><path d="M25 9v4" /></svg>;
    case 'Wardrobe': return <svg {...p}><rect x="4" y="2" width="32" height="34" /><path d="M20 2v34M17 15v5M23 15v5" /></svg>;
    default: return <svg {...p}><rect x="8" y="2" width="24" height="34" /><path d="M8 11h24M8 20h24M8 29h24" /></svg>;
  }
}
