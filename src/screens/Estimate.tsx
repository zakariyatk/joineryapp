import { api } from '../api';
import { IconPlus, IconReset, IconTrash } from '../components/Icons';
import { NumberField } from '../components/NumberField';
import type { Screen } from '../components/Sidebar';
import { useExport } from '../components/Toast';
import { uid } from '../lib/defaults';
import type { EstLine, ProjectCalc, Section } from '../lib/estimate';
import { quoteHtml } from '../lib/exporters';
import { money, slug } from '../lib/format';
import { useStore } from '../store';
import type { CustomLine, Project, ProjectEstimate } from '../types';

interface Props { project: Project; calc: ProjectCalc; go(s: Screen): void }

export function Estimate({ project, calc, go }: Props) {
  const { data, updateProject } = useStore();
  const { settings } = data;
  const cur = settings.currency;
  const e = project.estimate;
  const t = calc.totals;
  const runExport = useExport();

  const setEst = (fn: (x: ProjectEstimate) => ProjectEstimate) => updateProject(project.id, (p) => ({ ...p, estimate: fn(p.estimate) }));

  const override = (key: string, field: 'q' | 'r', v: number) =>
    setEst((x) => ({ ...x, overrides: { ...x.overrides, [key]: { ...x.overrides[key], [field]: v } } }));
  const reset = (key: string) => setEst((x) => {
    const o = { ...x.overrides };
    delete o[key];
    return { ...x, overrides: o };
  });
  const setExtra = (id: string, patch: Partial<CustomLine>) =>
    setEst((x) => ({ ...x, extras: x.extras.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const addExtra = () => setEst((x) => ({ ...x, extras: [...x.extras, { id: uid(), name: 'Worktop / other item', unit: 'item', q: 1, r: 0 }] }));
  const removeExtra = (id: string) => setEst((x) => ({ ...x, extras: x.extras.filter((c) => c.id !== id) }));

  const quoteNo = `Q-${new Date(project.createdAt).getFullYear()}-${project.id.slice(0, 4).toUpperCase()}`;
  const exportQuote = () => runExport('Quote PDF', async () => {
    const path = await api.savePdf({ defaultName: `${slug(project.name)}-quote.pdf`, html: quoteHtml(project, settings, calc, quoteNo) });
    if (path && project.status === 'Drafting') updateProject(project.id, (p) => ({ ...p, status: 'Quoted' }));
    return path;
  });

  const section = (name: Section, qtyHead = 'Qty', rateHead = 'Rate') => {
    const lines = calc.lines.filter((l) => l.section === name);
    if (name !== 'Extras' && lines.length === 0) return null;
    return (
      <section className="card" aria-labelledby={`s-${name}`}>
        <div className="card-head">
          <h2 id={`s-${name}`}>{name === 'Extras' ? 'Extras' : name}</h2>
          <span style={{ fontWeight: 600 }}>{money(t[name], cur)}</span>
        </div>
        {lines.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Item</th><th>Unit</th><th className="r">{qtyHead}</th><th className="r">{rateHead}</th><th className="r">Amount</th><th><span style={{ position: 'absolute', left: -9999 }}>Actions</span></th></tr></thead>
              <tbody>{lines.map((l) => (name === 'Extras' ? extraRow(l) : lineRow(l)))}</tbody>
            </table>
          </div>
        )}
        {name === 'Extras' && (
          <div style={{ padding: '10px 16px 14px' }}>
            <button type="button" className="btn2" onClick={addExtra}><IconPlus />Add item</button>
          </div>
        )}
      </section>
    );
  };

  const lineRow = (l: EstLine) => (
    <tr key={l.key}>
      <td style={{ fontWeight: 600 }}>{l.name}{l.overridden && <span className="over" title="Edited by you"> · edited</span>}</td>
      <td className="muted">{l.unit}</td>
      <td className="r"><NumberField className="inp cell" step={l.section === 'Labour' ? 0.5 : 1} min={0} value={l.q} ariaLabel={`Quantity, ${l.name}`} onChange={(v) => override(l.key, 'q', v)} /></td>
      <td className="r"><NumberField className="inp cell" step={0.5} min={0} value={l.r} ariaLabel={`Rate, ${l.name}`} onChange={(v) => override(l.key, 'r', v)} /></td>
      <td className="r" style={{ fontWeight: 600 }}>{money(l.amount, cur)}</td>
      <td className="r" style={{ width: 44 }}>
        {l.overridden && <button type="button" className="btn-ghost icon-btn" aria-label={`Reset ${l.name} to calculated values (qty ${l.autoQ}, rate ${l.autoR})`} title={`Reset to ${l.autoQ} × ${l.autoR}`} onClick={() => reset(l.key)}><IconReset /></button>}
      </td>
    </tr>
  );

  const extraRow = (l: EstLine) => {
    const id = l.key.slice('extra:'.length);
    const x = e.extras.find((c) => c.id === id)!;
    return (
      <tr key={l.key}>
        <td><input className="inp" aria-label="Item name" value={x.name} onChange={(ev) => setExtra(id, { name: ev.target.value })} /></td>
        <td><input className="inp" style={{ width: 80 }} aria-label="Unit" value={x.unit} onChange={(ev) => setExtra(id, { unit: ev.target.value })} /></td>
        <td className="r"><NumberField className="inp cell" min={0} value={x.q} ariaLabel={`Quantity, ${x.name}`} onChange={(v) => setExtra(id, { q: v })} /></td>
        <td className="r"><NumberField className="inp cell" min={0} step={0.5} value={x.r} ariaLabel={`Rate, ${x.name}`} onChange={(v) => setExtra(id, { r: v })} /></td>
        <td className="r" style={{ fontWeight: 600 }}>{money(l.amount, cur)}</td>
        <td className="r"><button type="button" className="btn-ghost icon-btn danger" aria-label={`Remove ${x.name}`} onClick={() => removeExtra(id)}><IconTrash /></button></td>
      </tr>
    );
  };

  return (
    <div className="page">
      <div className="toolbar">
        <div>
          <div className="crumb">{project.name} / Estimate</div>
          <h1 className="title">Cost estimate</h1>
        </div>
        <div className="actions">
          <button type="button" className="btn2" onClick={() => go('cutting')}>Back to cutting list</button>
          <button type="button" className="btn2" onClick={() => go('settings')}>Edit rates</button>
        </div>
      </div>
      <p className="muted" style={{ margin: '-8px 0 0', fontSize: 13 }}>
        Quantities are calculated from the cutting list and sheet layouts; prices come from Materials &amp; rates. Edit any number here to override it for this project only.
      </p>

      {calc.parts.length === 0 && <div className="card empty">No parts yet — add units in Drawings to price this project.</div>}

      <div className="row2">
        <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {section('Materials')}
          {section('Hardware')}
          {section('Labour', 'Hours', 'Rate / hr')}
          {section('Extras')}
        </div>

        <aside className="card card-pad aside" aria-labelledby="qs" style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'sticky', top: 0 }}>
          <h2 id="qs" style={{ fontSize: 18, marginBottom: 6 }}>Quote summary</h2>
          {(['Materials', 'Hardware', 'Labour', 'Extras'] as const).map((s) => (
            <div key={s} className="sumrow"><span>{s}</span><span>{money(t[s], cur)}</span></div>
          ))}
          <div className="sumrow b"><span>Cost subtotal</span><span>{money(t.subtotal, cur)}</span></div>
          <div className="fields" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', margin: '8px 0' }}>
            <div><label className="lbl" htmlFor="oh">Overhead %</label><NumberField id="oh" min={0} value={e.overhead} onChange={(v) => setEst((x) => ({ ...x, overhead: v }))} /></div>
            <div><label className="lbl" htmlFor="mg">Margin %</label><NumberField id="mg" min={0} value={e.margin} onChange={(v) => setEst((x) => ({ ...x, margin: v }))} /></div>
            <div><label className="lbl" htmlFor="tx">Tax %</label><NumberField id="tx" min={0} value={e.tax} onChange={(v) => setEst((x) => ({ ...x, tax: v }))} /></div>
          </div>
          <div className="sumrow"><span>Overhead</span><span>{money(t.overhead, cur)}</span></div>
          <div className="sumrow"><span>Margin</span><span>{money(t.margin, cur)}</span></div>
          <div className="sumrow"><span>Tax</span><span>{money(t.tax, cur)}</span></div>
          <div className="grand"><span style={{ fontWeight: 700 }}>Quote total</span><span className="v">{money(t.grand, cur)}</span></div>
          <div className="muted" style={{ fontSize: 13, paddingBottom: 10 }}>
            Profit {money(t.margin, cur)}{calc.unitCount > 0 && <> · per unit {money(t.grand / calc.unitCount, cur)} ({calc.unitCount} units)</>}
          </div>
          <button type="button" className="btn" disabled={!calc.parts.length} onClick={exportQuote}>Save quote PDF</button>
          <div className="note" style={{ marginTop: 10 }}>
            <b style={{ color: 'var(--ink)' }}>Quote {quoteNo}</b><br />
            {project.client || 'No client set'} · valid 30 days. Saving the PDF marks a draft project as Quoted.
          </div>
        </aside>
      </div>
    </div>
  );
}
