import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api } from '../api';
import { IconDownload } from '../components/Icons';
import { NumberField } from '../components/NumberField';
import { SheetView } from '../components/SheetView';
import type { Screen } from '../components/Sidebar';
import { useExport } from '../components/Toast';
import { partArea } from '../lib/cabinet';
import type { ProjectCalc } from '../lib/estimate';
import { cuttingListCsv, cuttingListHtml } from '../lib/exporters';
import { num, slug } from '../lib/format';
import { useStore } from '../store';
import type { MaterialRole, Project } from '../types';

const ROLE_LABEL: Record<MaterialRole, string> = { carcass: 'Carcass', front: 'Fronts', back: 'Backs' };

interface Props { project: Project; calc: ProjectCalc; go(s: Screen): void }

export function CuttingList({ project, calc, go }: Props) {
  const { data, setSettings } = useStore();
  const { settings } = data;
  const [filter, setFilter] = useState<MaterialRole | 'all'>('all');
  const [sheetIdx, setSheetIdx] = useState(0);
  const runExport = useExport();

  const sheets = calc.nests.flatMap((n) => n.sheets.map((s) => ({ sheet: s, nest: n })));
  const current = sheets[Math.min(sheetIdx, sheets.length - 1)];
  const rows = calc.parts.filter((p) => filter === 'all' || p.role === filter);
  const oversize = calc.nests.flatMap((n) => n.oversize);

  const exportCsv = () => runExport('Cutting list CSV', () => api.saveText({
    defaultName: `${slug(project.name)}-cutting-list.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    content: cuttingListCsv(calc.parts, settings),
  }));
  const exportPdf = () => runExport('Cutting list PDF', () => api.savePdf({
    defaultName: `${slug(project.name)}-cutting-list.pdf`,
    landscape: true,
    html: cuttingListHtml(project, settings, calc, sheets.map(({ sheet, nest }) =>
      renderToStaticMarkup(<SheetView sheet={sheet} material={nest.material} title={`${ROLE_LABEL[nest.role]} – ${nest.material.name} – sheet ${sheet.index} of ${nest.sheets.length}`} />))),
  }));

  return (
    <div className="page">
      <div className="toolbar">
        <div>
          <div className="crumb">{project.name} / Cutting list</div>
          <h1 className="title">Cutting list</h1>
        </div>
        <div className="actions">
          <button type="button" className="btn2" disabled={!calc.parts.length} onClick={exportCsv}><IconDownload />Export CSV</button>
          <button type="button" className="btn2" disabled={!calc.parts.length} onClick={exportPdf}>Save PDF with layouts</button>
          <button type="button" className="btn" onClick={() => go('estimate')}>Create estimate</button>
        </div>
      </div>

      {calc.parts.length === 0 ? (
        <div className="card empty">No parts yet. <button type="button" className="link" style={{ color: 'var(--accent)' }} onClick={() => go('drawing')}>Add units in Drawings</button> and the cutting list builds itself.</div>
      ) : (
        <>
          <div className="kpis">
            <div className="card kpi"><div className="k">Parts</div><div className="v">{calc.pieces}</div><div className="s">{calc.parts.length} lines · {calc.unitCount} units</div></div>
            {calc.nests.map((n) => {
              const area = calc.parts.filter((p) => p.role === n.role).reduce((a, p) => a + partArea(p), 0) / 1e6;
              return (
                <div key={n.role} className="card kpi"><div className="k">{n.material.name}</div><div className="v">{n.sheets.length} {n.sheets.length === 1 ? 'sheet' : 'sheets'}</div><div className="s">{num(area, 2)} m² of parts</div></div>
              );
            })}
            <div className="card kpi"><div className="k">Edge banding</div><div className="v">{num(calc.edgeMetresRaw, 1)} m</div><div className="s">+{settings.edgeWaste}% waste = {calc.edgeMetres} m</div></div>
          </div>

          {oversize.length > 0 && (
            <div className="warn" role="alert">
              {oversize.length} part{oversize.length > 1 ? 's are' : ' is'} larger than the stock sheet and not nested: {oversize.map((o) => `${o.label} ${o.length} × ${o.width}`).join(', ')}. Use a larger sheet in Materials &amp; rates or split the part.
            </div>
          )}

          <section className="card" aria-labelledby="pl">
            <div className="card-head">
              <h2 id="pl">Parts</h2>
              <div className="chips" role="group" aria-label="Filter by material">
                {(['all', 'carcass', 'front', 'back'] as const).map((r) => (
                  <button key={r} type="button" className={filter === r ? 'chip on' : 'chip'} aria-pressed={filter === r} onClick={() => setFilter(r)}>
                    {r === 'all' ? 'All materials' : `${ROLE_LABEL[r]} · ${settings.materials[r].name}`}
                  </button>
                ))}
              </div>
            </div>
            <div className="tablewrap">
              <table>
                <thead><tr><th>#</th><th>Unit</th><th>Part</th><th className="r">Qty</th><th className="r">Length</th><th className="r">Width</th><th className="r">Thk</th><th>Material</th><th>Edges L1 L2 W1 W2</th></tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.key}>
                      <td className="muted">{calc.parts.indexOf(p) + 1}</td>
                      <td><span className="code">{p.unitCode}</span></td>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td className="r">{p.qty}</td>
                      <td className="r">{p.length}</td>
                      <td className="r">{p.width}</td>
                      <td className="r">{p.thickness}</td>
                      <td className="muted">{settings.materials[p.role].name}</td>
                      <td>
                        {p.edges.map((e, i) => <span key={i} className={e ? 'eb on' : 'eb'} />)}
                        <span style={{ position: 'absolute', left: -9999 }}>{p.edges.some(Boolean) ? `Banded ${['L1', 'L2', 'W1', 'W2'].filter((_, i) => p.edges[i]).join(', ')}` : 'No banding'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="row2">
            <section className="card card-pad grow" aria-labelledby="sl" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 id="sl" style={{ fontSize: 17 }}>Sheet layouts</h2>
              <div className="tabs" role="tablist">
                {sheets.map(({ sheet, nest }, i) => (
                  <button key={`${nest.role}${sheet.index}`} type="button" role="tab" aria-selected={current === sheets[i]} className={current === sheets[i] ? 'on' : ''} onClick={() => setSheetIdx(i)}>
                    {ROLE_LABEL[nest.role]} · {sheet.index} <span className="muted">({Math.round(sheet.yield * 100)}%)</span>
                  </button>
                ))}
              </div>
              {current && <SheetView sheet={current.sheet} material={current.nest.material} />}
              {current && current.sheet.offcuts.length > 0 && (
                <div className="muted" style={{ fontSize: 13 }}>Usable offcuts: {current.sheet.offcuts.map((o) => `${Math.round(o.w)} × ${Math.round(o.h)}`).join(', ')}</div>
              )}
            </section>

            <section className="card card-pad aside" aria-labelledby="os" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h2 id="os" style={{ fontSize: 17 }}>Optimiser settings</h2>
              <div className="fields">
                <div><label className="lbl" htmlFor="kerf">Saw kerf (mm)</label><NumberField id="kerf" min={0} value={settings.kerf} onChange={(v) => setSettings((s) => ({ ...s, kerf: v }))} /></div>
                <div><label className="lbl" htmlFor="trim">Edge trim (mm)</label><NumberField id="trim" min={0} value={settings.trim} onChange={(v) => setSettings((s) => ({ ...s, trim: v }))} /></div>
              </div>
              {(['carcass', 'front', 'back'] as const).map((r) => (
                <label key={r} className="check">
                  <input type="checkbox" checked={settings.materials[r].grain}
                    onChange={(e) => setSettings((s) => ({ ...s, materials: { ...s.materials, [r]: { ...s.materials[r], grain: e.target.checked } } }))} />
                  {ROLE_LABEL[r]}: keep grain direction
                </label>
              ))}
              <div className="note">Layouts use guillotine cuts (edge-to-edge), so they can be cut on a panel saw. Sheet sizes and prices are in Materials &amp; rates.</div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
