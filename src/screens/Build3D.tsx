import { useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { ModeSwitch } from '../components/BuildParts';
import type { Screen } from '../components/Sidebar';
import { Scene3D, type Scene3DHandle, type View3 } from '../components/Scene3D';
import { useExport } from '../components/Toast';
import { view3dSheetHtml, type ScheduleRow } from '../lib/exporters';
import { slug } from '../lib/format';
import { LAYER_LABEL, layoutOf, layoutUnits, offOf, roomOf, sorted, walls } from '../lib/layout';
import { KIND_LABEL } from '../lib/run';
import { buildScene, sizeText } from '../lib/scene3d';
import { useStore } from '../store';
import type { DrawnLayout, Project } from '../types';

interface Props { project: Project; go(s: Screen): void }

/**
 * Build › 3D view: the drawn kitchen as a model the workshop can read at a
 * glance, every cabinet labelled with its reference and size, floor
 * dimensions along each wall, and a cabinet schedule beside it.
 */
export function Build3D({ project }: Props) {
  const { updateProject } = useStore();
  const runExport = useExport();
  const layout: DrawnLayout = layoutOf(project);
  const keep = useMemo(() => project.units.filter((u) => u.source !== 'build'), [project.units]);
  const units = useMemo(() => layoutUnits(layout, keep), [layout, keep]);
  const scene = useMemo(() => buildScene(layout, units), [layout, units]);
  const ws = walls(roomOf(layout));
  const list = sorted(layout);
  const wallUnitIds = useMemo(() => new Set(layout.cabinets.filter((c) => c.layer === 'wall').map((c) => c.id)), [layout.cabinets]);
  const [view, setView] = useState<View3>('iso');
  const [viewKey, setViewKey] = useState(0);
  const [show, setShow] = useState({ dims: true, walls: true, wallUnits: true, labels: true });
  const [selected, setSelected] = useState<string | null>(null);
  const handle = useRef<Scene3DHandle>(null);
  const pickView = (v: View3) => { setView(v); setViewKey((k) => k + 1); };
  const sel = list.find((c) => c.id === selected);
  const many = ws.length > 1;

  const rows: ScheduleRow[] = list.map((c) => {
    const u = units.get(c.id)!;
    return {
      code: u.code,
      name: c.layer === 'base' ? KIND_LABEL[c.kind] : u.name,
      wall: many ? `Wall ${(c.wall ?? 0) + 1}` : '',
      size: sizeText(c),
      from: String(Math.round(c.bottom)),
      gap: offOf(c) ? String(offOf(c)) : '–',
    };
  });

  const savePdf = () => runExport('3D view PDF', async () => {
    const image = handle.current?.snapshot() ?? '';
    return api.savePdf({ defaultName: `${slug(project.name)}-3d.pdf`, landscape: true, html: view3dSheetHtml(project, image, rows) });
  });

  const toggle = (k: keyof typeof show, text: string) => (
    <label className="check" style={{ minHeight: 28, fontSize: 13 }}>
      <input type="checkbox" checked={show[k]} onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} />{text}
    </label>
  );

  return (
    <>
      <div className="editor-top">
        <div>
          <div className="crumb">{project.name} / Build</div>
          <h1 style={{ fontSize: 20, marginTop: 2 }}>3D view</h1>
        </div>
        <ModeSwitch project={project} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 13 }}>{list.length} cabinets · sizes in mm (W × H × D)</span>
          <button type="button" className="btn2" disabled={!list.length} onClick={savePdf}>Save PDF</button>
          {!list.length && <button type="button" className="btn" onClick={() => updateProject(project.id, (p) => ({ ...p, buildMode: 'draw' }))}>Draw the plan</button>}
        </div>
      </div>

      <div className="view3d-page">
        <section className="card view3d-main" aria-label="3D view">
          <div className="quad-head">
            <div className="seg" role="group" aria-label="View">
              <button type="button" className={view === 'iso' ? 'on' : ''} aria-pressed={view === 'iso'} onClick={() => pickView('iso')}>3D</button>
              {ws.map((w) => {
                const on = typeof view === 'object' && view.wall === w.i;
                return <button key={w.i} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => pickView({ wall: w.i, n: w.n })}>{many ? `Wall ${w.i + 1}` : 'Front'}</button>;
              })}
              <button type="button" className={view === 'top' ? 'on' : ''} aria-pressed={view === 'top'} onClick={() => pickView('top')}>Top</button>
            </div>
            <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {toggle('labels', 'Sizes')}
              {toggle('dims', 'Dimensions')}
              {toggle('wallUnits', 'Wall units')}
              {toggle('walls', 'Walls')}
              <button type="button" className="btn-ghost" style={{ minHeight: 30, fontSize: 13 }} onClick={() => handle.current?.fit()}>Fit</button>
            </span>
          </div>
          <div className="view3d-canvas">
            {list.length || ws.length
              ? <Scene3D scene={scene} view={view} viewKey={viewKey} show={show} wallUnitIds={wallUnitIds} selected={selected} onPick={setSelected} handle={handle} />
              : <div className="note" style={{ margin: 16 }}>Nothing drawn yet. Draw the walls and cabinets on <b>Draw plan</b>; the 3D view is made from them.</div>}
          </div>
          <p className="muted" style={{ margin: 0, padding: '6px 12px', fontSize: 12 }}>
            Drag to turn · right-drag to move · scroll to zoom · click a cabinet to see its details.
          </p>
        </section>

        <section className="card view3d-side" aria-labelledby="sched">
          {sel ? (() => {
            const u = units.get(sel.id)!;
            return (
              <div className="card-pad" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="code" style={{ fontSize: 22 }}>{u.code}</div>
                <div style={{ fontWeight: 600, marginTop: 2 }}>{sel.layer === 'base' ? KIND_LABEL[sel.kind] : LAYER_LABEL[sel.layer]}</div>
                <dl className="facts">
                  <dt>Width</dt><dd>{Math.round(sel.width)}</dd>
                  <dt>Height</dt><dd>{Math.round(sel.top - sel.bottom)}</dd>
                  <dt>Depth</dt><dd>{Math.round(sel.depth)}</dd>
                  <dt>From floor</dt><dd>{Math.round(sel.bottom)}</dd>
                  <dt>Top at</dt><dd>{Math.round(sel.top)}</dd>
                  {offOf(sel) > 0 && <><dt>Gap from wall</dt><dd>{offOf(sel)}</dd></>}
                  {many && <><dt>Wall</dt><dd>{(sel.wall ?? 0) + 1}</dd></>}
                  <dt>Position</dt><dd>{Math.round(sel.x)} – {Math.round(sel.x + sel.width)}</dd>
                </dl>
              </div>
            );
          })() : null}
          <div className="card-head"><h2 id="sched" style={{ fontSize: 15 }}>Cabinet schedule</h2></div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Ref</th><th>Cabinet</th><th className="r">W × H × D</th><th className="r">From floor</th></tr></thead>
              <tbody>
                {list.map((c, i) => (
                  <tr key={c.id} onClick={() => setSelected(c.id)} style={{ cursor: 'pointer', background: c.id === selected ? 'var(--ground)' : undefined }}>
                    <td><span className="code">{rows[i].code}</span></td>
                    <td>{rows[i].name}{many ? <span className="muted"> · {rows[i].wall}</span> : null}</td>
                    <td className="r" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{rows[i].size}</td>
                    <td className="r">{rows[i].from}</td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={4} className="muted">No cabinets yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
