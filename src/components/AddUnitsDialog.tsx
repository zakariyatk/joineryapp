import { useEffect, useRef, useState } from 'react';
import { parseWidths, rowErrors, TEMPLATES, uid, unitsFromRows, type UnitRow } from '../lib/defaults';
import type { Unit } from '../types';
import { IconPlus, IconTrash, TemplateIcon } from './Icons';
import { NumberField } from './NumberField';

interface Props {
  open: boolean;
  existing: Unit[];
  onClose(): void;
  onAdd(units: Unit[]): void;
}

type Row = UnitRow & { key: string };

function rowFor(t: number, width?: number): Row {
  const tp = TEMPLATES[t];
  return { key: uid(), name: tp.name, width: width ?? tp.width, height: tp.height, depth: tp.depth, qty: 1 };
}

/**
 * Add several units of one template at once, each with its own size.
 * Rows can be added one by one or generated from a list of widths.
 */
export function AddUnitsDialog({ open, existing, onClose, onAdd }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tpl, setTpl] = useState(0);
  const [rows, setRows] = useState<Row[]>(() => [rowFor(0)]);
  const [widths, setWidths] = useState('');
  const [widthsError, setWidthsError] = useState('');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setTpl(0);
      setRows([rowFor(0)]);
      setWidths('');
      setWidthsError('');
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const chooseTemplate = (i: number) => {
    setTpl(i);
    // Keep the widths the user typed; take height, depth and name from the new template.
    const t = TEMPLATES[i];
    setRows((rs) => rs.map((r) => ({ ...r, name: t.name, height: t.height, depth: t.depth })));
  };

  const setRow = (key: string, patch: Partial<UnitRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => {
    const last = rs[rs.length - 1];
    return [...rs, last ? { ...last, key: uid() } : rowFor(tpl)];
  });
  const removeRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  const fillWidths = () => {
    const ws = parseWidths(widths);
    if (!ws || ws.length === 0) {
      setWidthsError('Enter widths in mm separated by commas, e.g. 300, 450, 600');
      return;
    }
    setWidthsError('');
    const t = TEMPLATES[tpl];
    // Replace the untouched starter row; otherwise append.
    setRows((rs) => {
      const pristine = rs.length === 1 && rs[0].width === t.width && rs[0].qty === 1;
      const base = pristine ? [] : rs;
      const ref = base[base.length - 1];
      return [...base, ...ws.map((w) => ({ ...rowFor(tpl, w), ...(ref ? { height: ref.height, depth: ref.depth, name: ref.name } : {}) }))];
    });
    setWidths('');
  };

  const errors = rows.map(rowErrors);
  const valid = rows.length > 0 && errors.every((e) => Object.keys(e).length === 0);
  const totalUnits = rows.reduce((a, r) => a + (Number.isFinite(r.qty) ? Math.round(r.qty) : 0), 0);

  const submit = () => {
    if (!valid) return;
    onAdd(unitsFromRows(TEMPLATES[tpl], rows, existing));
  };

  const cellErr = (i: number, k: keyof UnitRow) => errors[i][k];

  return (
    <dialog ref={ref} aria-labelledby="au-title" className="wide" onClose={onClose} onCancel={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div>
          <h2 id="au-title" style={{ fontSize: 20 }}>Add units</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Pick a template, then add one row per cabinet. Each row can have its own size.</p>
        </div>

        <div className="tpl-pick" role="radiogroup" aria-label="Template">
          {TEMPLATES.map((t, i) => (
            <button key={t.label} type="button" role="radio" aria-checked={tpl === i} className={tpl === i ? 'tpl on' : 'tpl'} onClick={() => chooseTemplate(i)}>
              <TemplateIcon label={t.label} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="quickfill">
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="lbl" htmlFor="au-widths">Quick add by widths (mm)</label>
            <input id="au-widths" className="inp" placeholder="e.g. 300, 450, 600, 900" value={widths}
              aria-invalid={Boolean(widthsError)} aria-describedby={widthsError ? 'au-widths-err' : undefined}
              onChange={(e) => setWidths(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fillWidths(); } }} />
          </div>
          <button type="button" className="btn2" onClick={fillWidths}>Create rows</button>
        </div>
        {widthsError && <div id="au-widths-err" className="warn" role="alert">{widthsError}</div>}

        <div className="tablewrap au-table">
          <table>
            <thead><tr><th>#</th><th>Name</th><th className="r">Width</th><th className="r">Height</th><th className="r">Depth</th><th className="r">Qty</th><th><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="muted">{i + 1}</td>
                  <td><input className="inp" style={{ minWidth: 150 }} aria-label={`Row ${i + 1} name`} aria-invalid={Boolean(cellErr(i, 'name'))} value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} /></td>
                  {(['width', 'height', 'depth', 'qty'] as const).map((k) => (
                    <td key={k} className="r">
                      <NumberField className={cellErr(i, k) ? 'inp cell invalid' : 'inp cell'} step={k === 'qty' ? 1 : 10} value={r[k]}
                        ariaLabel={`Row ${i + 1} ${k === 'qty' ? 'quantity' : k}`} onChange={(v) => setRow(r.key, { [k]: v })} />
                      {cellErr(i, k) && <div className="cell-err">{cellErr(i, k)}</div>}
                    </td>
                  ))}
                  <td className="r">
                    <button type="button" className="btn-ghost icon-btn danger" aria-label={`Remove row ${i + 1}`} disabled={rows.length === 1} onClick={() => removeRow(r.key)}><IconTrash /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <button type="button" className="btn2" onClick={addRow}><IconPlus />Add row</button>
        </div>

        <div className="actions" style={{ alignItems: 'center' }}>
          <span className="muted" style={{ marginRight: 'auto', fontSize: 13 }}>
            {rows.length} {rows.length === 1 ? 'size' : 'sizes'} · {totalUnits} {totalUnits === 1 ? 'cabinet' : 'cabinets'}
          </span>
          <button type="button" className="btn2" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={!valid}>Add {rows.length} {rows.length === 1 ? 'unit' : 'units'}</button>
        </div>
      </form>
    </dialog>
  );
}
