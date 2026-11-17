import { useMemo, useState, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api } from '../api';
import { IconCheck, IconDownload } from '../components/Icons';
import { NumberField } from '../components/NumberField';
import type { Screen } from '../components/Sidebar';
import { useExport, useNotify } from '../components/Toast';
import { GeometryView } from '../components/UnitDrawing';
import { buildSheetHtml, geometryToDxf } from '../lib/exporters';
import { slug } from '../lib/format';
import { applyRun, DEFAULT_RUN, isApplied, KIND_LABEL, resolveRun, runUnits, slotCount, slotsFor } from '../lib/run';
import { runDrawings, type RunViews } from '../lib/runDrawing';
import { useStore } from '../store';
import type { Project, RunConfig, RunSlot, SlotKind } from '../types';

interface Props { project: Project; go(s: Screen): void }

function Quad({ title, extra, form, children }: { title: string; extra?: ReactNode; form?: boolean; children: ReactNode }) {
  const id = `q-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section className="card quad-cell" aria-labelledby={id}>
      <div className="quad-head"><h2 id={id}>{title}</h2>{extra}</div>
      <div className={form ? 'quad-body form' : 'quad-body'}>{children}</div>
    </section>
  );
}

export function Build({ project, go }: Props) {
  const { data, updateProject } = useStore();
  const { settings } = data;
  const notify = useNotify();
  const runExport = useExport();
  const [sectionAt, setSectionAt] = useState(0);
  const cfg: RunConfig = project.run ?? DEFAULT_RUN;

  const setRun = (patch: Partial<RunConfig>) => updateProject(project.id, (p) => ({ ...p, run: { ...(p.run ?? DEFAULT_RUN), ...patch } }));
  const setSlot = (i: number, patch: Partial<RunSlot>) => {
    const slots = slotsFor(cfg).map((s) => ({ ...s }));
    slots[i] = { ...slots[i], ...patch };
    setRun({ slots });
  };

  const resolved = useMemo(() => resolveRun(cfg), [cfg]);
  const ok = resolved.errors.length === 0;
  const keep = useMemo(() => project.units.filter((u) => u.source !== 'build'), [project.units]);
  const preview = useMemo(() => runUnits(cfg, resolved.slots, keep), [cfg, resolved.slots, keep]);
  const section = Math.min(sectionAt, resolved.slots.length - 1);
  const views: RunViews | null = useMemo(
    () => (ok ? runDrawings(cfg, resolved.slots, preview.base, preview.wall, settings, section) : null),
    [ok, cfg, resolved.slots, preview, settings, section],
  );
  const applied = ok && isApplied(project.units, cfg, resolved.slots);
  const previousBuild = project.units.filter((u) => u.source === 'build').length;
  const cabinetCount = preview.base.length + preview.wall.length;

  const create = () => {
    if (!ok) return;
    if (previousBuild > 0 && !window.confirm(`Replace the ${previousBuild} cabinets created by Build earlier with these ${cabinetCount}? Units you added yourself in Drawings are kept.`)) return;
    updateProject(project.id, (p) => ({ ...p, units: applyRun(p.units, cfg, resolved.slots) }));
    notify(`${cabinetCount} cabinets added to ${project.name}`);
  };

  const label = (v: keyof RunViews) =>
    v === 'plan' ? `Plan of a ${cfg.length} mm run with ${resolved.slots.length} base cabinets`
      : v === 'elevation' ? `Elevation of the ${cfg.length} mm run`
        : `Section through ${preview.base[section]?.code ?? ''}`;

  const exportPdf = () => views && runExport('Build sheet PDF', () => api.savePdf({
    defaultName: `${slug(project.name)}-build.pdf`,
    landscape: true,
    html: buildSheetHtml(project, (['plan', 'elevation', 'section'] as const).map((v) => ({
      title: v === 'section' ? `SECTION THROUGH ${preview.base[section].code}` : v.toUpperCase(),
      svg: renderToStaticMarkup(<GeometryView g={views[v]} label={label(v)} />),
    })), [...preview.base, ...preview.wall].map((u) => ({ code: u.code, name: u.name, size: `${u.width} × ${u.height + u.plinth} × ${u.depth}` }))),
  }));
  const exportDxf = (v: keyof RunViews) => views && runExport(`${v} DXF`, () => api.saveText({
    defaultName: `${slug(project.name)}-${v}.dxf`,
    filters: [{ name: 'DXF drawing', extensions: ['dxf'] }],
    content: geometryToDxf(views[v]),
  }));

  const dxfButton = (v: keyof RunViews) => (
    <button type="button" className="btn-ghost" style={{ minHeight: 32, fontSize: 13 }} disabled={!views} onClick={() => exportDxf(v)} aria-label={`Export ${v} as DXF`}>
      <IconDownload />DXF
    </button>
  );
  const problem = <div className="warn" role="alert" style={{ maxWidth: 420 }}>{resolved.errors[0]}</div>;
  const field = (id: string, text: string, key: keyof RunConfig, step = 10) => (
    <div><label className="lbl" htmlFor={id}>{text}</label>
      <NumberField id={id} step={step} min={0} value={cfg[key] as number} onChange={(v) => setRun({ [key]: Math.round(v) } as Partial<RunConfig>)} /></div>
  );

  return (
    <>
      <div className="editor-top">
        <div>
          <div className="crumb">{project.name} / Build</div>
          <h1 style={{ fontSize: 20, marginTop: 2 }}>Build from wall length</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span role="status" className={applied ? 'status-ok' : 'muted'} style={{ fontSize: 13 }}>
            {!ok ? 'Fix the settings to continue' : applied ? <><IconCheck /> These cabinets are in the project</> : previousBuild ? 'Changed since cabinets were created' : 'Not added to the project yet'}
          </span>
          <button type="button" className="btn2" disabled={!views} onClick={exportPdf}>Save PDF</button>
          {applied
            ? <button type="button" className="btn" onClick={() => go('drawing')}>Open in Drawings</button>
            : <button type="button" className="btn" disabled={!ok} onClick={create}>Create {cabinetCount} cabinets</button>}
        </div>
      </div>

      <div className="quad">
        <Quad title="Plan" extra={dxfButton('plan')}>
          {views ? <GeometryView g={views.plan} label={label('plan')} /> : problem}
        </Quad>
        <Quad title="Elevation" extra={dxfButton('elevation')}>
          {views ? <GeometryView g={views.elevation} label={label('elevation')} /> : problem}
        </Quad>
        <Quad title="Section" extra={
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label htmlFor="sec-at" className="muted" style={{ fontSize: 13 }}>through</label>
            <select id="sec-at" className="inp" style={{ height: 32, width: 'auto' }} value={section} onChange={(e) => setSectionAt(Number(e.target.value))}>
              {preview.base.map((u, i) => <option key={u.id} value={i}>{u.code} · {resolved.slots[i].width}</option>)}
            </select>
            {dxfButton('section')}
          </span>
        }>
          {views ? <GeometryView g={views.section} label={label('section')} /> : problem}
        </Quad>

        <Quad title="Run settings" form>
          <div className="run-form">
            <div className="fields run-main">
              <div><label className="lbl" htmlFor="r-len">Total wall length (mm)</label>
                <NumberField id="r-len" className="inp big" step={10} min={0} value={cfg.length} onChange={(v) => setRun({ length: Math.round(v) })} /></div>
              <div><label className="lbl" htmlFor="r-max">Max cabinet width</label>
                <NumberField id="r-max" step={50} min={150} value={cfg.maxWidth} onChange={(v) => setRun({ maxWidth: Math.round(v) })} /></div>
              <div><label className="lbl" htmlFor="r-n">Number of cabinets</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <NumberField id="r-n" min={1} value={slotCount(cfg)} onChange={(v) => setRun({ count: Math.max(1, Math.round(v)) })} />
                  {cfg.count !== null && <button type="button" className="btn2" style={{ minHeight: 38 }} onClick={() => setRun({ count: null })}>Auto</button>}
                </div>
              </div>
            </div>

            <div className="tablewrap run-slots">
              <table>
                <thead><tr><th>Ref</th><th className="r">Width</th><th>Front</th><th className="r">From left</th></tr></thead>
                <tbody>
                  {slotsFor(cfg).map((s, i) => {
                    const r = resolved.slots[i];
                    return (
                      <tr key={i}>
                        <td><span className="code">{preview.base[i]?.code}</span>{cfg.wall && <span className="code light">{preview.wall[i]?.code}</span>}</td>
                        <td className="r">
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <input className="inp cell" type="number" step={10} aria-label={`Width of cabinet ${i + 1}, blank for auto`}
                              value={s.width ?? ''} placeholder={String(r.width)}
                              onChange={(e) => setSlot(i, { width: e.target.value === '' ? null : Math.round(Number(e.target.value)) })} />
                            {s.width !== null && <button type="button" className="btn-ghost" style={{ minHeight: 30, fontSize: 12, padding: '0 6px' }} onClick={() => setSlot(i, { width: null })}>auto</button>}
                          </span>
                        </td>
                        <td>
                          <select className="inp" style={{ height: 34 }} aria-label={`Front of cabinet ${i + 1}`} value={s.kind} onChange={(e) => setSlot(i, { kind: e.target.value as SlotKind })}>
                            {(Object.keys(KIND_LABEL) as SlotKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                          </select>
                        </td>
                        <td className="r muted">{r.x}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Leave a width blank (grey) to share the remaining length; type a width to fix it, e.g. an 800 sink.</p>
            {!ok && <div className="warn" role="alert">{resolved.errors.join(' ')}</div>}

            <p className="sec">Base cabinets</p>
            <div className="fields run-grid">
              {field('r-bh', 'Carcass height', 'baseHeight')}
              {field('r-bd', 'Depth', 'baseDepth')}
              {field('r-pl', 'Plinth', 'plinth')}
              {field('r-wt', 'Worktop thickness', 'worktop', 1)}
              {field('r-oh', 'Worktop overhang', 'overhang', 5)}
            </div>
            <label className="check" style={{ marginTop: 4 }}>
              <input type="checkbox" checked={cfg.wall} onChange={(e) => setRun({ wall: e.target.checked })} />
              <b>Wall cabinets above</b>
            </label>
            {cfg.wall && (
              <div className="fields run-grid">
                {field('r-wh', 'Height', 'wallHeight')}
                {field('r-wd', 'Depth', 'wallDepth')}
                {field('r-wb', 'Underside from floor', 'wallBottom')}
              </div>
            )}
          </div>
        </Quad>
      </div>
    </>
  );
}
