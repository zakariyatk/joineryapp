import { useEffect, useState } from 'react';
import { api } from '../api';
import { NumberField } from '../components/NumberField';
import { useStore } from '../store';
import type { Material, MaterialRole, Settings } from '../types';

const ROLES: { role: MaterialRole; label: string }[] = [
  { role: 'carcass', label: 'Carcass' },
  { role: 'front', label: 'Doors & drawer fronts' },
  { role: 'back', label: 'Back panels' },
];

const HARDWARE: { key: keyof Settings['hardware']; label: string }[] = [
  { key: 'hinge', label: 'Hinge (each)' },
  { key: 'runner', label: 'Drawer runners (pair)' },
  { key: 'handle', label: 'Handle (each)' },
  { key: 'leg', label: 'Adjustable leg (each)' },
  { key: 'shelfPin', label: 'Shelf pin (each)' },
  { key: 'fittings', label: 'Cam & dowel set (per unit)' },
  { key: 'wallHanger', label: 'Wall hangers (pair)' },
];

const LABOUR: { key: keyof Settings['labourRates']; label: string }[] = [
  { key: 'cutting', label: 'Panel cutting' },
  { key: 'edging', label: 'Edge banding' },
  { key: 'assembly', label: 'Assembly' },
  { key: 'finishing', label: 'Finishing' },
  { key: 'install', label: 'Delivery & installation' },
];

export function SettingsScreen() {
  const { data, setSettings } = useStore();
  const s = data.settings;
  const [location, setLocation] = useState('');
  useEffect(() => { api.dataLocation().then(setLocation).catch(() => {}); }, []);

  const setMat = (role: MaterialRole, patch: Partial<Material>) =>
    setSettings((x) => ({ ...x, materials: { ...x.materials, [role]: { ...x.materials[role], ...patch } } }));

  return (
    <div className="page">
      <div className="toolbar">
        <div>
          <div className="crumb">Setup</div>
          <h1 className="title">Materials &amp; rates</h1>
        </div>
      </div>
      <p className="muted" style={{ margin: '-8px 0 0', fontSize: 13 }}>These prices feed every estimate. Changes save automatically.</p>

      <section className="card card-pad" aria-labelledby="co" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 id="co" style={{ fontSize: 17 }}>Company</h2>
        <div className="fields" style={{ maxWidth: 560 }}>
          <div><label className="lbl" htmlFor="company">Company name on quotes</label><input id="company" className="inp" value={s.company} onChange={(e) => setSettings((x) => ({ ...x, company: e.target.value }))} /></div>
          <div><label className="lbl" htmlFor="currency">Currency</label>
            <select id="currency" className="inp" value={s.currency} onChange={(e) => setSettings((x) => ({ ...x, currency: e.target.value }))}>
              <option value="₹">INR ₹</option><option value="AED ">AED</option><option value="SAR ">SAR</option><option value="QAR ">QAR</option>
              <option value="$">USD $</option><option value="£">GBP £</option><option value="€">EUR €</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="mt">
        <div className="card-head"><h2 id="mt">Sheet materials</h2></div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Used for</th><th>Name</th><th className="r">Thickness</th><th className="r">Sheet length</th><th className="r">Sheet width</th><th className="r">Price / sheet</th><th>Grain</th></tr></thead>
            <tbody>
              {ROLES.map(({ role, label }) => {
                const m = s.materials[role];
                return (
                  <tr key={role}>
                    <td style={{ fontWeight: 600 }}>{label}</td>
                    <td><input className="inp" style={{ minWidth: 200 }} aria-label={`${label} material name`} value={m.name} onChange={(e) => setMat(role, { name: e.target.value })} /></td>
                    <td className="r"><NumberField className="inp cell" min={1} value={m.thickness} ariaLabel={`${label} thickness`} onChange={(v) => setMat(role, { thickness: v })} /></td>
                    <td className="r"><NumberField className="inp cell" min={100} value={m.sheetLength} ariaLabel={`${label} sheet length`} onChange={(v) => setMat(role, { sheetLength: v })} /></td>
                    <td className="r"><NumberField className="inp cell" min={100} value={m.sheetWidth} ariaLabel={`${label} sheet width`} onChange={(v) => setMat(role, { sheetWidth: v })} /></td>
                    <td className="r"><NumberField className="inp cell" min={0} value={m.price} ariaLabel={`${label} price per sheet`} onChange={(v) => setMat(role, { price: v })} /></td>
                    <td><label className="check"><input type="checkbox" checked={m.grain} onChange={(e) => setMat(role, { grain: e.target.checked })} />Keep direction</label></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="row2">
        <section className="card card-pad grow" aria-labelledby="hw" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 id="hw" style={{ fontSize: 17 }}>Hardware &amp; banding prices</h2>
          <div className="fields">
            {HARDWARE.map(({ key, label }) => (
              <div key={key}><label className="lbl" htmlFor={`hw-${key}`}>{label}</label>
                <NumberField id={`hw-${key}`} min={0} value={s.hardware[key]} onChange={(v) => setSettings((x) => ({ ...x, hardware: { ...x.hardware, [key]: v } }))} /></div>
            ))}
            <div><label className="lbl" htmlFor="eb">Edge banding (per metre)</label><NumberField id="eb" min={0} step={0.5} value={s.edgeBandPrice} onChange={(v) => setSettings((x) => ({ ...x, edgeBandPrice: v }))} /></div>
            <div><label className="lbl" htmlFor="ebw">Edge banding waste %</label><NumberField id="ebw" min={0} value={s.edgeWaste} onChange={(v) => setSettings((x) => ({ ...x, edgeWaste: v }))} /></div>
          </div>
        </section>
        <section className="card card-pad aside" aria-labelledby="lr" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 id="lr" style={{ fontSize: 17 }}>Labour rates (per hour)</h2>
          <div className="fields">
            {LABOUR.map(({ key, label }) => (
              <div key={key}><label className="lbl" htmlFor={`lr-${key}`}>{label}</label>
                <NumberField id={`lr-${key}`} min={0} value={s.labourRates[key]} onChange={(v) => setSettings((x) => ({ ...x, labourRates: { ...x.labourRates, [key]: v } }))} /></div>
            ))}
          </div>
          <div className="note">Hours are estimated from part count, banding length, units and front area; adjust them per project on the Estimate screen.</div>
        </section>
      </div>

      <p className="muted" style={{ fontSize: 12 }}>Data file: {location}</p>
    </div>
  );
}
