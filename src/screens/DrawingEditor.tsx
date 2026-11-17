import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api } from '../api';
import { IconCopy, IconDownload, IconTrash } from '../components/Icons';
import { NumberField } from '../components/NumberField';
import type { Screen } from '../components/Sidebar';
import { useExport } from '../components/Toast';
import { UnitDrawing } from '../components/UnitDrawing';
import { doorCount, normalise, unitParts } from '../lib/cabinet';
import { nextCode, TEMPLATES, uid, unitFromTemplate } from '../lib/defaults';
import { buildGeometry, type View } from '../lib/drawing';
import { drawingSheetHtml, geometryToDxf } from '../lib/exporters';
import { slug } from '../lib/format';
import { useStore } from '../store';
import type { Project, Unit, UnitType } from '../types';

interface Props {
  project: Project;
  unitId: string | null;
  setUnitId(id: string | null): void;
  go(s: Screen): void;
}

export function DrawingEditor({ project, unitId, setUnitId, go }: Props) {
  const { data, updateProject, updateUnit } = useStore();
  const { settings } = data;
  const [view, setView] = useState<View>('front');
  const runExport = useExport();
  const unit = project.units.find((u) => u.id === unitId) ?? project.units[0] ?? null;

  const set = (patch: Partial<Unit>) => unit && updateUnit(project.id, unit.id, patch);

  const addUnit = (i: number) => {
    const u = unitFromTemplate(TEMPLATES[i], project.units);
    updateProject(project.id, (p) => ({ ...p, units: [...p.units, u] }));
    setUnitId(u.id);
  };
  const duplicate = () => {
    if (!unit) return;
    const u = { ...unit, id: uid(), code: nextCode(project.units, unit.type) };
    updateProject(project.id, (p) => ({ ...p, units: [...p.units, u] }));
    setUnitId(u.id);
  };
  const remove = () => {
    if (!unit || !window.confirm(`Delete unit ${unit.code} · ${unit.name}?`)) return;
    updateProject(project.id, (p) => ({ ...p, units: p.units.filter((u) => u.id !== unit.id) }));
    setUnitId(null);
  };

  const exportDxf = () => unit && runExport('DXF drawing', () => api.saveText({
    defaultName: `${slug(project.name)}-${unit.code}-${view}.dxf`,
    filters: [{ name: 'DXF drawing', extensions: ['dxf'] }],
    content: geometryToDxf(buildGeometry(unit, view, settings)),
  }));
  const exportPdf = () => unit && runExport('Drawing PDF', () => api.savePdf({
    defaultName: `${slug(project.name)}-${unit.code}.pdf`,
    landscape: true,
    html: drawingSheetHtml(project, unit, settings, [
      { title: 'FRONT ELEVATION', svg: renderToStaticMarkup(<UnitDrawing unit={unit} view="front" settings={settings} />) },
      { title: 'SIDE SECTION', svg: renderToStaticMarkup(<UnitDrawing unit={unit} view="side" settings={settings} />) },
    ]),
  }));

  const parts = unit ? unitParts(unit, settings) : [];
  const n = unit ? normalise(unit) : null;

  return (
    <>
      <div className="editor-top">
        <div>
          <div className="crumb">{project.name} / Drawings</div>
          <h1 style={{ fontSize: 20, marginTop: 2 }}>{unit ? `${unit.code} · ${unit.name}` : 'No units yet'}</h1>
        </div>
        <div className="seg" role="group" aria-label="Drawing view">
          <button type="button" className={view === 'front' ? 'on' : ''} aria-pressed={view === 'front'} onClick={() => setView('front')}>Front</button>
          <button type="button" className={view === 'side' ? 'on' : ''} aria-pressed={view === 'side'} onClick={() => setView('side')}>Side section</button>
        </div>
        <div className="actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn2" disabled={!unit} onClick={exportDxf}><IconDownload />Export DXF</button>
          <button type="button" className="btn2" disabled={!unit} onClick={exportPdf}>Save PDF</button>
          <button type="button" className="btn" disabled={!project.units.length} onClick={() => go('cutting')}>Cutting list</button>
        </div>
      </div>

      <div className="editor">
        <section className="panel units" aria-labelledby="ul">
          <h2 id="ul" className="sec" style={{ padding: '0 6px 6px' }}>Units · {project.units.length}</h2>
          {project.units.map((u) => (
            <button key={u.id} type="button" className={u.id === unit?.id ? 'unit on' : 'unit'} aria-current={u.id === unit?.id} onClick={() => setUnitId(u.id)}>
              <span className="badge">{u.code}</span>
              <span><span style={{ display: 'block', fontWeight: 600 }}>{u.name}{u.qty > 1 ? ` × ${u.qty}` : ''}</span><span className="s">{u.width} × {u.height} × {u.depth}</span></span>
            </button>
          ))}
          <label className="lbl" htmlFor="add-unit" style={{ marginTop: 10, padding: '0 4px' }}>Add unit</label>
          <select id="add-unit" className="inp" value="" onChange={(e) => e.target.value !== '' && addUnit(Number(e.target.value))}>
            <option value="">Choose a template…</option>
            {TEMPLATES.map((t, i) => <option key={t.label} value={i}>{t.label} ({t.width} × {t.height})</option>)}
          </select>
          <div className="note" style={{ marginTop: 12 }}>Change any size on the right — the drawing, dimensions and part sizes update together.</div>
        </section>

        <section className="canvas-wrap" aria-label="Drawing">
          {unit && n ? (
            <>
              <div className="canvas"><UnitDrawing unit={unit} view={view} settings={settings} /></div>
              <div className="titleblock">
                <div><span className="muted">Unit</span><b>{unit.code} · {unit.name}</b></div>
                <div><span className="muted">Overall W × H × D</span><b>{n.width} × {n.height + n.plinth} × {n.depth}</b></div>
                <div><span className="muted">Carcass</span><b>{settings.materials.carcass.name}</b></div>
                <div><span className="muted">Fronts</span><b>{settings.materials.front.name}</b></div>
                <div><span className="muted">Units</span><b>mm</b></div>
              </div>
            </>
          ) : (
            <div className="canvas"><div className="empty">Add a unit from a template to start drawing.</div></div>
          )}
        </section>

        {unit && (
          <section className="panel params" aria-labelledby="pp">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 id="pp" style={{ fontSize: 17 }}>Unit parameters</h2>
              <span>
                <button type="button" className="btn-ghost icon-btn" aria-label="Duplicate unit" title="Duplicate unit" onClick={duplicate}><IconCopy /></button>
                <button type="button" className="btn-ghost icon-btn danger" aria-label="Delete unit" title="Delete unit" onClick={remove}><IconTrash /></button>
              </span>
            </div>
            <div className="fields">
              <div><label className="lbl" htmlFor="u-code">Code</label><input id="u-code" className="inp" value={unit.code} onChange={(e) => set({ code: e.target.value })} /></div>
              <div><label className="lbl" htmlFor="u-qty">Quantity</label><NumberField id="u-qty" value={unit.qty} min={1} onChange={(v) => set({ qty: Math.round(v) })} /></div>
              <div className="span2"><label className="lbl" htmlFor="u-name">Name</label><input id="u-name" className="inp" value={unit.name} onChange={(e) => set({ name: e.target.value })} /></div>
              <div className="span2"><label className="lbl" htmlFor="u-type">Construction type</label>
                <select id="u-type" className="inp" value={unit.type} onChange={(e) => set({ type: e.target.value as UnitType })}>
                  <option value="base">Base – bottom + top rails, plinth</option>
                  <option value="wall">Wall – full top and bottom</option>
                  <option value="tall">Tall – full top and bottom, plinth</option>
                </select>
              </div>
            </div>
            <p className="sec">Dimensions (mm)</p>
            <div className="fields">
              <div><label className="lbl" htmlFor="u-w">Width</label><NumberField id="u-w" step={10} min={0} value={unit.width} onChange={(v) => set({ width: v })} /></div>
              <div><label className="lbl" htmlFor="u-h">Carcass height</label><NumberField id="u-h" step={10} min={0} value={unit.height} onChange={(v) => set({ height: v })} /></div>
              <div><label className="lbl" htmlFor="u-d">Depth</label><NumberField id="u-d" step={10} min={0} value={unit.depth} onChange={(v) => set({ depth: v })} /></div>
              <div><label className="lbl" htmlFor="u-p">Plinth height</label><NumberField id="u-p" step={10} min={0} value={unit.plinth} onChange={(v) => set({ plinth: v })} /></div>
            </div>
            <p className="sec">Fronts &amp; interior</p>
            <div className="fields">
              <div><label className="lbl" htmlFor="u-dh">Top drawer height</label><NumberField id="u-dh" step={10} min={0} value={unit.drawerHeight} onChange={(v) => set({ drawerHeight: v })} /></div>
              <div><label className="lbl" htmlFor="u-sh">Shelves</label><NumberField id="u-sh" min={0} value={unit.shelves} onChange={(v) => set({ shelves: Math.round(v) })} /></div>
              <div><label className="lbl" htmlFor="u-doors">Doors</label>
                <select id="u-doors" className="inp" value={unit.doors} onChange={(e) => set({ doors: Number(e.target.value) })}>
                  <option value={0}>Automatic ({doorCount({ ...unit, doors: 0 })})</option>
                  <option value={-1}>None (open)</option>
                  <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
                </select>
              </div>
              <div><label className="lbl" htmlFor="u-style">Door style</label>
                <select id="u-style" className="inp" value={unit.doorStyle} onChange={(e) => set({ doorStyle: e.target.value as Unit['doorStyle'] })}>
                  <option value="shaker">Shaker</option><option value="slab">Slab</option>
                </select>
              </div>
            </div>
            <div className="partlist">
              <div className="h"><span>Parts from this unit</span><span className="muted">{parts.reduce((a, p) => a + p.qty, 0)} pcs</span></div>
              {parts.map((p) => (
                <div key={p.key} className="i"><span>{p.qty} × {p.name}</span><span className="muted">{p.length} × {p.width} · {p.thickness} mm</span></div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
