import type { ReactNode } from 'react';
import { layoutOf } from '../lib/layout';
import { useStore } from '../store';
import type { Project } from '../types';

export function Quad({ title, extra, form, children }: { title: string; extra?: ReactNode; form?: boolean; children: ReactNode }) {
  const id = `q-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section className="card quad-cell" aria-labelledby={id}>
      <div className="quad-head"><h2 id={id}>{title}</h2>{extra}</div>
      <div className={form ? 'quad-body form' : 'quad-body'}>{children}</div>
    </section>
  );
}

/** Switch between drawing the plan and its 3D view. */
export function ModeSwitch({ project }: { project: Project }) {
  const { updateProject } = useStore();
  const mode = project.buildMode === '3d' ? '3d' : 'draw';
  const set = (m: 'draw' | '3d') => updateProject(project.id, (p) => {
    // A project from before the plan could be drawn keeps its wall-length run as its drawing.
    return { ...p, buildMode: m, layout: layoutOf(p) };
  });
  return (
    <div className="seg" role="group" aria-label="Build view">
      <button type="button" className={mode === 'draw' ? 'on' : ''} aria-pressed={mode === 'draw'} onClick={() => set('draw')}>Draw plan</button>
      <button type="button" className={mode === '3d' ? 'on' : ''} aria-pressed={mode === '3d'} onClick={() => set('3d')}>3D view</button>
    </div>
  );
}
