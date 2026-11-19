import { useEffect, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api } from '../api';
import { ModeSwitch, Quad } from '../components/BuildParts';
import { DrawPlan, NOTHING, type DrawTool, type Selection, type WallMode } from '../components/DrawPlan';
import { ElevationEdit } from '../components/ElevationEdit';
import { ZoomView } from '../components/PanZoom';
import { IconCheck, IconDownload } from '../components/Icons';
import { NumberField } from '../components/NumberField';
import type { Screen } from '../components/Sidebar';
import { useExport, useNotify } from '../components/Toast';
import { GeometryView } from '../components/UnitDrawing';
import { buildSheetHtml, geometryToDxf } from '../lib/exporters';
import { slug } from '../lib/format';
import {
  applyLayout, layoutOf, deleteWall, flipChain, hasWalls, isClosingWall, isLayoutApplied, LAYER_DEFAULTS, LAYER_LABEL, layoutDrawings, layoutErrors,
  applyDimEdit, isDimEdit, layoutUnits, LOCATION_LABEL, remapCabinets, roomOf, setWallAngle, setWallLength, sorted, WALL_HEIGHT, WALL_THICKNESSES, wallAngle, walls,
  type DimEdit, type WallLocation,
} from '../lib/layout';
import type { Label } from '../lib/drawing';
import { BASE_KINDS, DEFAULT_DRAWERS, KIND_LABEL, KIND_SHORT, KIND_WIDTH } from '../lib/run';
import type { RunViews } from '../lib/runDrawing';
import { useStore } from '../store';
import type { DrawnCabinet, DrawnLayer, DrawnLayout, Project, Room, SlotKind } from '../types';

interface Props { project: Project; go(s: Screen): void }

const LAYERS: DrawnLayer[] = ['base', 'wall', 'tall'];
const TOOLS: { t: DrawTool; label: string }[] = [
  { t: 'select', label: 'Select' }, { t: 'block', label: 'Block wall' }, ...LAYERS.map((l) => ({ t: l as DrawTool, label: LAYER_LABEL[l] })),
];
const HISTORY = 100;

export function BuildDraw({ project, go }: Props) {
  const { data, updateProject } = useStore();
  const { settings } = data;
  const notify = useNotify();
  const runExport = useExport();
  const layout: DrawnLayout = layoutOf(project);
  const [tool, setTool] = useState<DrawTool>(hasWalls(layout) ? 'select' : 'block');
  const [wallMode, setWallMode] = useState<WallMode>('line');
  const [location, setLocation] = useState<WallLocation>('inside');
  const [baseKind, setBaseKind] = useState<SlotKind>('standard');
  const [sel, setSel] = useState<Selection>(NOTHING);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [elevPick, setElevWall] = useState(0);
  const ws = walls(roomOf(layout));
  const many = ws.length > 1;
  const selected = sel.cabs.length === 1 && !sel.walls.length ? sel.cabs[0] : null;
  const selectedWall = sel.walls.length === 1 && !sel.cabs.length ? sel.walls[0] : null;
  const select = (s: Selection) => {
    setSel(s);
    const c = s.cabs.length === 1 && !s.walls.length ? layout.cabinets.find((x) => x.id === s.cabs[0]) : undefined;
    if (c) { setElevWall(c.wall ?? 0); setSectionId(null); }
    if (s.walls.length === 1 && !s.cabs.length) setElevWall(s.walls[0]);
  };
  const setSelected = (id: string | null) => select(id ? { cabs: [id], walls: [] } : NOTHING);

  // Undo / redo of everything drawn on this page.
  const past = useRef<DrawnLayout[]>([]);
  const future = useRef<DrawnLayout[]>([]);
  const [, bump] = useState(0);
  const setLayout = (fn: (l: DrawnLayout) => DrawnLayout) => {
    past.current = [...past.current.slice(-HISTORY + 1), layout];
    future.current = [];
    bump((n) => n + 1);
    updateProject(project.id, (p) => ({ ...p, layout: fn(layoutOf(p)) }));
  };
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(layout);
    setSel(NOTHING);
    bump((n) => n + 1);
    updateProject(project.id, (p) => ({ ...p, layout: prev }));
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(layout);
    setSel(NOTHING);
    bump((n) => n + 1);
    updateProject(project.id, (p) => ({ ...p, layout: next }));
  };
  const undoRef = useRef({ undo, redo });
  undoRef.current = { undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRef.current.undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); undoRef.current.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setCab = (id: string, patch: Partial<DrawnCabinet>) =>
    setLayout((l) => ({ ...l, cabinets: l.cabinets.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  /** A dimension typed in on a drawing: change the walls or cabinets it measures. */
  const editDim = (l: Label, v: number) => { if (isDimEdit(l.edit)) setLayout((x) => applyDimEdit(x, l.edit as DimEdit, v)); };

  /** Delete everything selected: cabinets, and walls along with the cabinets standing on them. */
  const deleteSelected = () => {
    if (!sel.cabs.length && !sel.walls.length) return;
    const room = roomOf(layout);
    const gone = sel.walls.map((i) => ws[i]).filter(Boolean);
    const onGone = layout.cabinets.filter((c) => !sel.cabs.includes(c.id) && sel.walls.includes(c.wall ?? 0)).length;
    if (onGone && !window.confirm(`Delete ${gone.length} wall${gone.length > 1 ? 's' : ''} and the ${onGone} cabinet${onGone > 1 ? 's' : ''} standing on ${gone.length > 1 ? 'them' : 'it'}?`)) return;
    let next = room;
    for (const w of gone) {
      // Find the wall again by its corners: earlier deletions renumber walls.
      const now = walls(next).find((v) => v.p0.x === w.p0.x && v.p0.y === w.p0.y && v.p1.x === w.p1.x && v.p1.y === w.p1.y);
      if (now) next = deleteWall(next, now.i);
    }
    setLayout((l) => {
      const cabs = l.cabinets.filter((c) => !sel.cabs.includes(c.id));
      return gone.length ? { ...l, room: next, cabinets: remapCabinets(room, next, cabs) } : { ...l, cabinets: cabs };
    });
    setSel(NOTHING);
  };

  const keep = useMemo(() => project.units.filter((u) => u.source !== 'build'), [project.units]);
  const units = useMemo(() => layoutUnits(layout, keep), [layout, keep]);
  const codes = useMemo(() => new Map([...units].map(([id, u]) => [id, u.code])), [units]);
  const errors = useMemo(() => layoutErrors(layout, codes), [layout, codes]);
  const ok = errors.length === 0 && layout.cabinets.length > 0;
  const list = sorted(layout);
  const cab = layout.cabinets.find((c) => c.id === selected) ?? null;
  const elevWall = Math.min(elevPick, Math.max(0, ws.length - 1));
  const secCab = layout.cabinets.find((c) => c.id === (sectionId ?? selected)) ?? list.find((c) => (c.wall ?? 0) === elevWall) ?? list[0];
  const views: RunViews = useMemo(() => layoutDrawings(layout, units, settings, elevWall, secCab), [layout, units, settings, elevWall, secCab]);

  const setRoom = (fn: (r: Room) => Room) => setLayout((l) => ({ ...l, room: fn(roomOf(l)) }));
  const newRoom = (room: Room, topology: boolean) => {
    setLayout((l) => ({ ...l, room, cabinets: topology ? remapCabinets(roomOf(l), room, l.cabinets) : l.cabinets }));
    if (topology) setSel(NOTHING);
  };
  const clearWalls = () => {
    if (!window.confirm('Remove all walls and the cabinets on them?')) return;
    setLayout((l) => ({ ...l, room: { ...roomOf(l), chains: [] }, cabinets: [] }));
    setSel(NOTHING);
  };
  const room = roomOf(layout);

  const applied = ok && isLayoutApplied(project.units, layout);
  const previousBuild = project.units.filter((u) => u.source === 'build').length;
  const create = () => {
    if (!ok) return;
    if (previousBuild > 0 && !window.confirm(`Replace the ${previousBuild} cabinets created by Build earlier with these ${list.length}? Units you added yourself in Drawings are kept.`)) return;
    updateProject(project.id, (p) => ({ ...p, units: applyLayout(p.units, layoutOf(p)) }));
    notify(`${list.length} cabinets added to ${project.name}`);
  };


  const label = (v: keyof RunViews) =>
    v === 'plan' ? `Plan of ${many ? `${ws.length} walls` : `the ${ws[0]?.len ?? 0} mm wall`} with ${list.length} cabinets`
      : v === 'elevation' ? `Elevation of ${many ? `wall ${elevWall + 1}` : 'the wall'}, ${ws[elevWall]?.len ?? 0} mm, drawn from the plan`
        : `Section through ${secCab ? codes.get(secCab.id) : 'the wall'}`;
  const exportPdf = () => runExport('Build sheet PDF', () => api.savePdf({
    defaultName: `${slug(project.name)}-build.pdf`,
    landscape: true,
    html: buildSheetHtml(project, (['plan', 'elevation', 'section'] as const).map((v) => ({
      title: v === 'section' ? `SECTION THROUGH ${secCab ? codes.get(secCab.id) : ''}` : v === 'elevation' && many ? `ELEVATION – WALL ${elevWall + 1}` : v.toUpperCase(),
      svg: renderToStaticMarkup(<GeometryView g={views[v]} label={label(v)} />),
    })), list.map((c) => {
      const u = units.get(c.id)!;
      return { code: u.code, name: u.name, size: `${u.width} × ${u.height + u.plinth} × ${u.depth}` };
    })),
  }));
  const dxfButton = (v: keyof RunViews) => (
    <button type="button" className="btn-ghost" style={{ minHeight: 32, fontSize: 13 }} aria-label={`Export ${v} as DXF`}
      onClick={() => runExport(`${v} DXF`, () => api.saveText({
        defaultName: `${slug(project.name)}-${v}.dxf`, filters: [{ name: 'DXF drawing', extensions: ['dxf'] }], content: geometryToDxf(views[v]),
      }))}>
      <IconDownload />DXF
    </button>
  );

  const num = (id: string, text: string, value: number, onChange: (v: number) => void, step = 10) => (
    <div><label className="lbl" htmlFor={id}>{text}</label>
      <NumberField id={id} step={step} min={0} value={value} onChange={(v) => onChange(Math.round(v))} /></div>
  );

  return (
    <>
      <div className="editor-top">
        <div>
          <div className="crumb">{project.name} / Build</div>
          <h1 style={{ fontSize: 20, marginTop: 2 }}>Draw plan</h1>
        </div>
        <ModeSwitch project={project} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span role="status" className={applied ? 'status-ok' : 'muted'} style={{ fontSize: 13 }}>
            {!hasWalls(layout) ? 'Start by drawing the walls' : !list.length ? 'Draw cabinets on the plan' : errors.length ? 'Fix the problems to continue' : applied ? <><IconCheck /> These cabinets are in the project</> : previousBuild ? 'Changed since cabinets were created' : 'Not added to the project yet'}
          </span>
          <button type="button" className="btn2" disabled={!list.length} onClick={exportPdf}>Save PDF</button>
          {applied
            ? <button type="button" className="btn" onClick={() => go('drawing')}>Open in Drawings</button>
            : <button type="button" className="btn" disabled={!ok} onClick={create}>Create {list.length} cabinets</button>}
        </div>
      </div>

      <div className="quad">
        <Quad title="Plan – draw here" extra={
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div className="seg" role="group" aria-label="What to draw">
              {TOOLS.map(({ t, label: text }) => (
                <button key={t} type="button" className={tool === t ? 'on' : ''} aria-pressed={tool === t} onClick={() => setTool(t)}>{text}</button>
              ))}
            </div>
            {tool === 'base' && (
              <select className="inp" style={{ height: 32, width: 'auto' }} aria-label="Base unit type to draw" value={baseKind}
                onChange={(e) => setBaseKind(e.target.value as SlotKind)}>
                {BASE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            )}
            <button type="button" className="btn-ghost" style={{ minHeight: 32, fontSize: 13 }} disabled={!past.current.length} onClick={undo} title="Undo (Ctrl+Z)">Undo</button>
            <button type="button" className="btn-ghost" style={{ minHeight: 32, fontSize: 13 }} disabled={!future.current.length} onClick={redo} title="Redo (Ctrl+Y)">Redo</button>
            {(sel.cabs.length > 0 || sel.walls.length > 0) && (
              <button type="button" className="btn-ghost danger" style={{ minHeight: 32, fontSize: 13 }} onClick={deleteSelected} title="Delete the selection (Delete key)">Delete</button>
            )}
            {dxfButton('plan')}
          </span>
        }>
          <DrawPlan layout={layout} g={views.plan} tool={tool} wallMode={wallMode} location={location} sel={sel} baseKind={baseKind}
            onSelect={select} onDeleteSelected={deleteSelected} onRoom={newRoom}
            onMoveCab={(id, wall, x, offset) => { setCab(id, { wall, x, offset }); setElevWall(wall); }} onEditDim={editDim}
            onAdd={(c) => { setLayout((l) => ({ ...l, cabinets: [...l.cabinets, c] })); setSelected(c.id); }} />
        </Quad>
        <Quad title="Elevation" extra={
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {many && (
              <select className="inp" style={{ height: 32, width: 'auto' }} aria-label="Wall to show in elevation" value={elevWall}
                onChange={(e) => { setElevWall(Number(e.target.value)); setSectionId(null); }}>
                {ws.map((w) => <option key={w.i} value={w.i}>Wall {w.i + 1} · {w.len}</option>)}
              </select>
            )}
            {dxfButton('elevation')}
          </span>
        }>
          <ElevationEdit g={views.elevation} layout={layout} wall={elevWall} wallHeight={room.height ?? WALL_HEIGHT} label={label('elevation')}
            sel={sel} onSelect={select} onMove={(id, x, bottom, top) => setCab(id, { x, bottom, top })} onEditDim={editDim} />
        </Quad>
        <Quad title="Section" extra={
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label htmlFor="sec-at" className="muted" style={{ fontSize: 13 }}>through</label>
            <select id="sec-at" className="inp" style={{ height: 32, width: 'auto' }} value={secCab?.id ?? ''} disabled={!list.length}
              onChange={(e) => setSectionId(e.target.value)}>
              {list.map((c) => <option key={c.id} value={c.id}>{codes.get(c.id)} · {c.width}</option>)}
            </select>
            {dxfButton('section')}
          </span>
        }>
          <ZoomView g={views.section} label={label('section')} onEditDim={editDim} />
        </Quad>

        <Quad title="Cabinets" form>
          <div className="run-form">
            {tool === 'block' && (
              <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div><span className="lbl">Draw</span>
                    <div className="seg" role="group" aria-label="Wall shape">
                      <button type="button" className={wallMode === 'line' ? 'on' : ''} aria-pressed={wallMode === 'line'} onClick={() => setWallMode('line')}>Line</button>
                      <button type="button" className={wallMode === 'rect' ? 'on' : ''} aria-pressed={wallMode === 'rect'} onClick={() => setWallMode('rect')}>Rectangle</button>
                    </div>
                  </div>
                  <div><label className="lbl" htmlFor="w-loc">Location line</label>
                    <select id="w-loc" className="inp" style={{ width: 'auto' }} value={location} onChange={(e) => setLocation(e.target.value as WallLocation)}>
                      {(Object.keys(LOCATION_LABEL) as WallLocation[]).map((k) => <option key={k} value={k}>{LOCATION_LABEL[k]}</option>)}
                    </select>
                  </div>
                  <div><label className="lbl" htmlFor="w-th">Wall thickness</label>
                    <select id="w-th" className="inp" style={{ width: 'auto' }} value={room.thickness} onChange={(e) => setRoom((r) => ({ ...r, thickness: Number(e.target.value) }))}>
                      {[...new Set([...WALL_THICKNESSES, room.thickness])].sort((a, b) => a - b).map((t) => <option key={t} value={t}>{t} mm block</option>)}
                    </select>
                  </div>
                  <div style={{ width: 110 }}>{num('w-h', 'Wall height', room.height ?? WALL_HEIGHT, (v) => setRoom((r) => ({ ...r, height: Math.max(300, v) })))}</div>
                </div>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  {wallMode === 'rect'
                    ? 'Click two opposite corners to draw four walls.'
                    : 'Click to place each corner. Lengths snap to 10 mm and angles to 15° (Shift for any angle); corners snap to wall ends, midpoints and alignment guides. Type a length and press Enter for an exact wall; Enter, Escape or double-click ends the run. Select a wall, then click its open end to carry on.'}
                  {' '}Scroll to zoom; drag with the middle button to pan.
                </p>
              </div>
            )}
            {tool === 'select' && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                <b>Select:</b> click a wall or cabinet; Ctrl or Shift-click adds more; drag a window to select several (left to right takes what is inside, right to left takes anything it touches).
                Press <b>Delete</b> to remove the selection. <b>Drag a cabinet to move it in any direction</b>: along its wall and away from it (it sticks to the wall within 100 mm; Shift keeps the gap), snapping to 10 mm
                and to the edges of walls and cabinets (Alt places it freely). Drop it against another wall to move it there. It turns red where it would overlap.
                Arrow keys nudge a selected cabinet (Shift: 100 mm). <b>Drag a wall</b> to move it; the walls joined to it stretch. Drag its square ends to move a corner.
                In the <b>elevation</b>, drag a cabinet sideways or up and down to change its position and levels.
                <b> Double-click any blue dimension</b> in the plan, elevation or section and type a new size (sums like 600+18 work): the walls and cabinets it measures adjust. Ctrl+Z undoes.
              </p>
            )}
            {(tool === 'base' || tool === 'wall' || tool === 'tall') && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Drag along a wall on the plan to draw a {tool === 'base' ? KIND_LABEL[baseKind].toLowerCase() : LAYER_LABEL[tool].toLowerCase()}, or click a wall to drop one in
                {' '}{tool === 'base' ? KIND_WIDTH[baseKind] : 600} mm wide. Ends snap to 10 mm, to other cabinets and to the cabinets round a corner.
                Click a cabinet to set its exact start, end and levels.
              </p>
            )}
            <div className="fields run-grid">
              {num('d-wt', 'Worktop thickness', layout.worktop, (v) => setLayout((l) => ({ ...l, worktop: v })), 1)}
              {num('d-oh', 'Worktop overhang', layout.overhang, (v) => setLayout((l) => ({ ...l, overhang: v })), 5)}
            </div>

            {(sel.cabs.length + sel.walls.length > 1) && (
              <div className="card card-pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span><b>{sel.walls.length ? `${sel.walls.length} wall${sel.walls.length > 1 ? 's' : ''}` : ''}{sel.walls.length && sel.cabs.length ? ' and ' : ''}{sel.cabs.length ? `${sel.cabs.length} cabinet${sel.cabs.length > 1 ? 's' : ''}` : ''}</b> selected</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn-ghost" onClick={() => setSel(NOTHING)}>Clear</button>
                  <button type="button" className="btn2" onClick={deleteSelected}>Delete</button>
                </span>
              </div>
            )}

            {selectedWall !== null && ws[selectedWall] && (() => {
              const w = ws[selectedWall];
              const closing = isClosingWall(room, w);
              return (
                <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <b>Wall {w.i + 1} · {room.thickness} mm block</b>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <button type="button" className="btn-ghost" onClick={() => setRoom((r) => flipChain(r, w.c))} title="Swap which side of this run is the room">Flip side</button>
                      <button type="button" className="btn-ghost danger" onClick={deleteSelected}>Delete</button>
                    </span>
                  </div>
                  {closing ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>This wall closes the room; change the other walls to move it. It is {w.len} mm at {wallAngle(w)}°.</p> : (
                    <div className="fields run-grid">
                      {num('w-len', 'Length (mm)', w.len, (v) => setRoom((r) => setWallLength(r, w.i, Math.max(10, v))))}
                      {num('w-ang', 'Angle (°, 0 = right, 90 = up)', wallAngle(w), (v) => setRoom((r) => setWallAngle(r, w.i, v)), 15)}
                    </div>
                  )}
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>Walls after this one in its run move with it. {layout.cabinets.filter((c) => (c.wall ?? 0) === w.i).length} cabinets stand on it.</p>
                </div>
              );
            })()}

            {cab ? (
              <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>{codes.get(cab.id)} · {LAYER_LABEL[cab.layer]} cabinet</b>
                  <button type="button" className="btn-ghost danger" onClick={deleteSelected}>Delete</button>
                </div>
                <div className="fields run-grid">
                  <div><label className="lbl" htmlFor="c-type">Type</label>
                    <select id="c-type" className="inp" value={cab.layer} onChange={(e) => {
                      const layer = e.target.value as DrawnLayer;
                      setCab(cab.id, { layer, ...LAYER_DEFAULTS[layer], kind: layer === 'base' ? cab.kind : 'doors' });
                    }}>
                      {LAYERS.map((l) => <option key={l} value={l}>{LAYER_LABEL[l]}</option>)}
                    </select>
                  </div>
                  {many && (
                    <div><label className="lbl" htmlFor="c-wall">On wall</label>
                      <select id="c-wall" className="inp" value={cab.wall ?? 0} onChange={(e) => setCab(cab.id, { wall: Number(e.target.value), x: 0 })}>
                        {ws.map((w) => <option key={w.i} value={w.i}>Wall {w.i + 1} · {w.len}</option>)}
                      </select>
                    </div>
                  )}
                  {num('c-x', 'Start (from left)', cab.x, (v) => setCab(cab.id, { x: v }))}
                  {num('c-end', 'End (from left)', cab.x + cab.width, (v) => setCab(cab.id, { width: Math.max(0, v - cab.x) }))}
                  {num('c-w', 'Width', cab.width, (v) => setCab(cab.id, { width: v }))}
                  {num('c-b', 'Bottom level (from floor)', cab.bottom, (v) => setCab(cab.id, { bottom: v }))}
                  {num('c-t', 'Top level (from floor)', cab.top, (v) => setCab(cab.id, { top: v }))}
                  {num('c-h', 'Carcass height', cab.top - cab.bottom, (v) => setCab(cab.id, { top: cab.bottom + v }))}
                  {num('c-d', 'Depth', cab.depth, (v) => setCab(cab.id, { depth: v }))}
                  {num('c-off', 'Gap from wall', cab.offset ?? 0, (v) => setCab(cab.id, { offset: Math.max(0, v) }))}
                  {cab.layer === 'base' && (
                    <div className="span2"><label className="lbl" htmlFor="c-k">Base unit type</label>
                      <span style={{ display: 'flex', gap: 4 }}>
                        <select id="c-k" className="inp" value={cab.kind} onChange={(e) => setCab(cab.id, { kind: e.target.value as SlotKind })}>
                          {[...BASE_KINDS, ...(BASE_KINDS.includes(cab.kind) ? [] : [cab.kind])].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                        </select>
                        {cab.kind === 'drawers' && (
                          <select className="inp" style={{ width: 'auto' }} aria-label="Number of drawers" value={cab.drawers ?? DEFAULT_DRAWERS}
                            onChange={(e) => setCab(cab.id, { drawers: Number(e.target.value) })}>
                            {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        )}
                      </span>
                    </div>
                  )}
                </div>
                {cab.layer !== 'wall' && <p className="muted" style={{ margin: 0, fontSize: 12 }}>For base and tall units the bottom level is the plinth height.</p>}
              </div>
            ) : (
              selectedWall === null && sel.cabs.length + sel.walls.length <= 1 && <div className="note">Select a wall or cabinet on the plan, or a cabinet in the list, to edit it.</div>
            )}

            {errors.length > 0 && <div className="warn" role="alert">{errors.join(' ')}</div>}

            <div className="tablewrap">
              <table>
                <thead><tr><th>Ref</th>{many && <th>Wall</th>}<th>Type</th><th className="r">Start – End</th><th className="r">Width</th><th className="r">Bottom – Top</th><th className="r">Depth</th></tr></thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id} onClick={() => setSelected(c.id)} style={{ cursor: 'pointer', background: sel.cabs.includes(c.id) ? 'var(--ground)' : undefined }}>
                      <td><button type="button" className="btn-ghost" style={{ minHeight: 28, padding: '0 4px' }} onClick={() => setSelected(c.id)}><span className="code">{codes.get(c.id)}</span></button></td>
                      {many && <td>{(c.wall ?? 0) + 1}</td>}
                      <td>{LAYER_LABEL[c.layer]}{c.layer === 'base' ? ` · ${c.kind === 'drawers' ? `${c.drawers ?? DEFAULT_DRAWERS} drawers` : KIND_SHORT[c.kind]}` : ''}</td>
                      <td className="r">{c.x} – {c.x + c.width}</td>
                      <td className="r">{c.width}</td>
                      <td className="r">{c.bottom} – {c.top}</td>
                      <td className="r">{c.depth}</td>
                    </tr>
                  ))}
                  {!list.length && <tr><td colSpan={many ? 7 : 6} className="muted">{tool === 'block' ? 'Draw the walls, then the cabinets.' : 'No cabinets yet.'}</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ws.length > 0 && <button type="button" className="btn-ghost danger" onClick={clearWalls}>Clear all walls</button>}
            </div>
          </div>
        </Quad>
      </div>
    </>
  );
}
