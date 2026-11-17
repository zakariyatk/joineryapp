import { useMemo, useRef, useState } from 'react';
import { IconCheck, IconCopy, IconPlus, IconTrash, TemplateIcon } from '../components/Icons';
import { newProject, TEMPLATES, uid, unitFromTemplate } from '../lib/defaults';
import { calculate } from '../lib/estimate';
import { money, relativeDate } from '../lib/format';
import { useStore } from '../store';
import type { Project, ProjectStatus } from '../types';

const STATUSES: ProjectStatus[] = ['Drafting', 'Quoted', 'In production', 'Installed'];
export const statusClass = (s: ProjectStatus) => ({ Drafting: 't-Drafting', Quoted: 't-Quoted', 'In production': 't-prod', Installed: 't-Installed' })[s];

interface Props {
  activeId: string | null;
  open(id: string, to?: 'drawing' | 'cutting' | 'estimate'): void;
  openUnit(projectId: string, unitId: string): void;
}

export function Projects({ activeId, open, openUnit }: Props) {
  const { data, addProject, deleteProject, updateProject } = useStore();
  const { settings } = data;
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState({ name: '', client: '' });

  const calcs = useMemo(() => new Map(data.projects.map((p) => [p.id, calculate(p, settings)])), [data.projects, settings]);
  const active = data.projects.filter((p) => p.status !== 'Installed');
  const sheetsToCut = data.projects
    .filter((p) => p.status === 'In production')
    .reduce((a, p) => a + calcs.get(p.id)!.nests.reduce((b, n) => b + n.sheets.length, 0), 0);
  const allSheets = active.flatMap((p) => calcs.get(p.id)!.nests.flatMap((n) => n.sheets));
  const avgYield = allSheets.length ? allSheets.reduce((a, s) => a + s.yield, 0) / allSheets.length : 0;
  const quotedValue = data.projects.filter((p) => p.status === 'Quoted').reduce((a, p) => a + calcs.get(p.id)!.totals.grand, 0);

  const q = query.trim().toLowerCase();
  const list = [...data.projects]
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.client.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const current = data.projects.find((p) => p.id === activeId) ?? list[0];
  const cc = current ? calcs.get(current.id)! : null;

  const create = () => {
    const p = newProject(form.name.trim() || 'Untitled project', form.client.trim());
    addProject(p);
    dialog.current?.close();
    setForm({ name: '', client: '' });
    open(p.id);
  };

  const duplicate = (p: Project) => {
    const copy: Project = {
      ...structuredClone(p),
      id: uid(),
      name: `${p.name} (copy)`,
      status: 'Drafting',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    copy.units = copy.units.map((u) => ({ ...u, id: uid() }));
    addProject(copy);
  };

  const remove = (p: Project) => {
    if (window.confirm(`Delete "${p.name}" and all its drawings? This cannot be undone.`)) deleteProject(p.id);
  };

  const addFromTemplate = (i: number) => {
    let target = current;
    if (!target) {
      target = newProject('Untitled project', '');
      addProject(target);
    }
    const unit = unitFromTemplate(TEMPLATES[i], target.units);
    updateProject(target.id, (p) => ({ ...p, units: [...p.units, unit] }));
    openUnit(target.id, unit.id);
  };

  return (
    <div className="page">
      <div className="toolbar">
        <div>
          <div className="crumb">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1 className="title">Projects</h1>
        </div>
        <div className="actions">
          <label htmlFor="q" className="lbl" style={{ position: 'absolute', left: -9999 }}>Search projects</label>
          <input id="q" className="inp" type="search" placeholder="Search projects or clients" style={{ width: 260, height: 40 }} value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="button" className="btn" onClick={() => dialog.current?.showModal()}><IconPlus />New project</button>
        </div>
      </div>

      <div className="kpis">
        <div className="card kpi"><div className="k">Active projects</div><div className="v">{active.length}</div><div className="s">{data.projects.filter((p) => p.status === 'In production').length} in production</div></div>
        <div className="card kpi"><div className="k">Quotes awaiting approval</div><div className="v">{data.projects.filter((p) => p.status === 'Quoted').length}</div><div className="s">{money(quotedValue, settings.currency)} total</div></div>
        <div className="card kpi"><div className="k">Sheets to cut</div><div className="v">{sheetsToCut}</div><div className="s">projects in production</div></div>
        <div className="card kpi"><div className="k">Average sheet yield</div><div className="v">{allSheets.length ? `${Math.round(avgYield * 100)}%` : '—'}</div><div className="s">active projects</div></div>
      </div>

      {current && cc && (
        <section className="card card-pad" aria-labelledby="cont" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent-dark)' }}>Continue where you left off</div>
              <h2 id="cont" style={{ fontSize: 22, marginTop: 4 }}>{current.name}</h2>
            </div>
            <span className="muted" style={{ fontSize: 13 }}>{current.client || 'No client'} · {current.units.length} unit types · updated {relativeDate(current.updatedAt).toLowerCase()}</span>
          </div>
          <div className="steps">
            <button type="button" className={current.units.length ? 'step done' : 'step'} onClick={() => open(current.id, 'drawing')}>
              <span className="n">{current.units.length ? <IconCheck /> : 1}</span>
              <span><b>1 · Drawings</b><span className="s">{current.units.length ? `${cc.unitCount} units drawn` : 'Add your first unit'}</span></span>
            </button>
            <button type="button" className={cc.pieces ? 'step done' : 'step'} onClick={() => open(current.id, 'cutting')}>
              <span className="n">{cc.pieces ? <IconCheck /> : 2}</span>
              <span><b>2 · Cutting list</b><span className="s">{cc.pieces ? `${cc.pieces} parts · ${cc.nests.reduce((a, n) => a + n.sheets.length, 0)} sheets` : 'Generated from drawings'}</span></span>
            </button>
            <button type="button" className={cc.totals.grand ? 'step done' : 'step'} onClick={() => open(current.id, 'estimate')}>
              <span className="n">{cc.totals.grand ? <IconCheck /> : 3}</span>
              <span><b>3 · Estimate</b><span className="s">{cc.totals.grand ? money(cc.totals.grand, settings.currency) : 'Priced from cutting list'}</span></span>
            </button>
            <button type="button" className={current.status !== 'Drafting' ? 'step done' : 'step'} onClick={() => open(current.id, 'estimate')}>
              <span className="n">{current.status !== 'Drafting' ? <IconCheck /> : 4}</span>
              <span><b>4 · Quote</b><span className="s">{current.status === 'Drafting' ? 'Not sent yet' : current.status}</span></span>
            </button>
          </div>
        </section>
      )}

      <div className="row2">
        <section className="card grow" aria-labelledby="allp">
          <div className="card-head"><h2 id="allp">All projects</h2><span className="muted" style={{ fontSize: 13 }}>Sorted by last updated</span></div>
          {list.length === 0 ? (
            <div className="empty">{q ? 'No projects match your search.' : 'No projects yet. Create one to start drawing.'}</div>
          ) : (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Project</th><th>Client</th><th className="r">Units</th><th className="r">Quote</th><th>Status</th><th>Updated</th><th><span style={{ position: 'absolute', left: -9999 }}>Actions</span></th></tr></thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id}>
                      <td><button type="button" className="link" onClick={() => open(p.id)}>{p.name}</button></td>
                      <td className="muted">{p.client || '—'}</td>
                      <td className="r">{calcs.get(p.id)!.unitCount}</td>
                      <td className="r">{money(calcs.get(p.id)!.totals.grand, settings.currency)}</td>
                      <td>
                        <select aria-label={`Status of ${p.name}`} className={`pill-select ${statusClass(p.status)}`} value={p.status} onChange={(e) => updateProject(p.id, (x) => ({ ...x, status: e.target.value as ProjectStatus }))}>
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="muted">{relativeDate(p.updatedAt)}</td>
                      <td className="r">
                        <button type="button" className="btn-ghost icon-btn" aria-label={`Duplicate ${p.name}`} title="Duplicate" onClick={() => duplicate(p)}><IconCopy /></button>
                        <button type="button" className="btn-ghost icon-btn danger" aria-label={`Delete ${p.name}`} title="Delete" onClick={() => remove(p)}><IconTrash /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="aside" aria-labelledby="tpl" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 id="tpl" style={{ fontSize: 17 }}>Add a unit from a template</h2>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>{current ? `Adds to ${current.name}.` : 'Creates a new project.'}</p>
          <div className="tiles">
            {TEMPLATES.map((t, i) => (
              <button key={t.label} type="button" className="tile" onClick={() => addFromTemplate(i)}>
                <TemplateIcon label={t.label} />
                <b style={{ fontSize: 14 }}>{t.label}</b>
                <span className="s">{t.width} × {t.height} × {t.depth}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <dialog ref={dialog} aria-labelledby="np">
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <h2 id="np" style={{ fontSize: 20 }}>New project</h2>
          <div><label className="lbl" htmlFor="np-name">Project name</label><input id="np-name" className="inp" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kitchen – Villa 12" /></div>
          <div><label className="lbl" htmlFor="np-client">Client</label><input id="np-client" className="inp" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} /></div>
          <div className="actions">
            <button type="button" className="btn2" onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="submit" className="btn">Create project</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
