import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Scene3, Solid, Tag } from '../lib/scene3d';
import type { Pt } from '../types';

export type View3 = 'iso' | 'top' | { wall: number; n: Pt };

export interface Scene3DHandle {
  /** A picture of the current view with its labels drawn in, as a PNG data URL. */
  snapshot(): string | null;
  /** Fit the drawing to the window again. */
  fit(): void;
}

interface Props {
  scene: Scene3;
  view: View3;
  /** Bumped to re-apply the view even when it is the same one. */
  viewKey: number;
  show: { dims: boolean; walls: boolean; wallUnits: boolean; labels: boolean };
  /** Cabinets that are wall units, so they can be hidden. */
  wallUnitIds: Set<string>;
  selected: string | null;
  onPick(id: string | null): void;
  handle?: Ref<Scene3DHandle>;
}

const COLORS: Record<Solid['kind'], number> = { carcass: 0xf8f6f1, front: 0xe9d8b9, plinth: 0x4a4744, worktop: 0xcbbb9d, handle: 0x2b2a28 };
const SELECTED = 0xf5c27a;
const EDGE = 0x3b3833;
const M = 1 / 1000; // millimetres to scene units (metres)
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x * M, z * M, y * M); // plan x, plan y, height

function solidMesh(s: Solid, selected: boolean): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(s.w * M, s.h * M, s.d * M);
  const mat = new THREE.MeshLambertMaterial({ color: selected && s.kind !== 'handle' && s.kind !== 'plinth' ? SELECTED : COLORS[s.kind] });
  const mesh = new THREE.Mesh(geo, mat);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: EDGE }));
  const X = new THREE.Vector3(s.u.x, 0, s.u.y), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(s.n.x, 0, s.n.y);
  const m = new THREE.Matrix4().makeBasis(X, Y, Z);
  const centre = v3(s.o.x, s.o.y, s.o.z)
    .add(X.clone().multiplyScalar((s.w * M) / 2)).add(Y.clone().multiplyScalar((s.h * M) / 2)).add(Z.clone().multiplyScalar((s.d * M) / 2));
  m.setPosition(centre);
  for (const o of [mesh, edges]) { o.matrixAutoUpdate = false; o.matrix.copy(m); }
  mesh.userData.id = s.id;
  g.add(mesh, edges);
  return g;
}

function tagObject(t: Tag, selected: boolean): CSS2DObject {
  const div = document.createElement('div');
  div.className = `tag3d tag-${t.kind}${selected ? ' on' : ''}`;
  t.lines.forEach((line, i) => {
    const row = document.createElement('div');
    row.textContent = line;
    if (i === 0 && t.kind === 'cabinet') row.className = 'code';
    div.appendChild(row);
  });
  const o = new CSS2DObject(div);
  o.position.copy(v3(t.at.x, t.at.y, t.at.z));
  return o;
}

/**
 * The drawing in 3D. Left-drag turns it, right-drag or middle-drag pans, the
 * wheel zooms; click a cabinet to select it. Labels stay the same size on screen.
 */
export function Scene3D({ scene, view, viewKey, show, wallUnitIds, selected, onPick, handle }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer; labels: CSS2DRenderer; camera: THREE.OrthographicCamera; controls: OrbitControls;
    root: THREE.Scene; content: THREE.Group; render(): void; fit(dir?: THREE.Vector3, up?: THREE.Vector3): void;
  } | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  // Set up the renderer once.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      el.textContent = 'This computer could not start the 3D view (WebGL is unavailable).';
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0xf4f2ee);
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'labels3d';
    el.appendChild(labels.domElement);

    const root = new THREE.Scene();
    root.add(new THREE.HemisphereLight(0xffffff, 0xb9b3a8, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(3, 6, 4);
    root.add(sun);
    const content = new THREE.Group();
    root.add(content);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // never go under the floor

    const render = () => { renderer.render(root, camera); labels.render(root, camera); };
    controls.addEventListener('change', render);

    const size = () => {
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h);
      labels.setSize(w, h);
      return { w, h };
    };

    /** Point the camera along `dir` (towards the drawing) and fit everything in. */
    const fit = (dir = camera.position.clone().sub(controls.target).normalize(), up = new THREE.Vector3(0, 1, 0)) => {
      const { w, h } = size();
      const box = new THREE.Box3().setFromObject(content);
      if (box.isEmpty()) box.set(new THREE.Vector3(-2, 0, -1), new THREE.Vector3(2, 2.4, 2));
      const centre = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length();
      camera.up.copy(up);
      camera.position.copy(centre).add(dir.clone().normalize().multiplyScalar(radius * 2));
      camera.lookAt(centre);
      camera.near = -radius * 10; camera.far = radius * 10;
      camera.updateMatrixWorld();
      // Fit the box's corners in the camera's own axes.
      const inv = camera.matrixWorldInverse;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).applyMatrix4(inv);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      let hw = ((maxX - minX) / 2) * 1.12, hh = ((maxY - minY) / 2) * 1.12;
      if (hw / hh > w / h) hh = hw / (w / h); else hw = hh * (w / h);
      camera.left = cx - hw; camera.right = cx + hw; camera.top = cy + hh; camera.bottom = cy - hh;
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.target.copy(centre);
      controls.update();
      render();
    };

    const ro = new ResizeObserver(() => {
      const before = { w: renderer.domElement.width, h: renderer.domElement.height };
      const { w, h } = size();
      if (before.w && before.h) {
        // Keep the same scale: widen or narrow the view with the window.
        const cx = (camera.left + camera.right) / 2, cy = (camera.top + camera.bottom) / 2;
        const hh = (camera.top - camera.bottom) / 2;
        camera.left = cx - hh * (w / h); camera.right = cx + hh * (w / h); camera.top = cy + hh; camera.bottom = cy - hh;
        camera.updateProjectionMatrix();
      }
      render();
    });
    ro.observe(el);

    // Click (not drag) picks a cabinet.
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4 || e.button !== 0) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(content.children, true).find((h) => h.object.visible && h.object.userData.id && (h.object as THREE.Mesh).isMesh);
      pick.current(hit ? (hit.object.userData.id as string) : null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    three.current = { renderer, labels, camera, controls, root, content, render, fit };
    return () => {
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      content.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
      });
      renderer.dispose();
      el.innerHTML = '';
      three.current = null;
    };
  }, []);

  // Rebuild the model whenever the drawing or the options change.
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const { content } = t;
    for (const child of [...content.children]) {
      content.remove(child);
      child.traverse((o) => {
        if (o instanceof CSS2DObject) o.element.remove();
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
    }
    // Floor.
    const fw = (scene.max.x - scene.min.x) * M, fd = (scene.max.y - scene.min.y) * M;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), new THREE.MeshLambertMaterial({ color: 0xeceae5 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(((scene.min.x + scene.max.x) / 2) * M, -0.001, ((scene.min.y + scene.max.y) / 2) * M);
    content.add(floor);

    if (show.walls) {
      for (const w of scene.walls) {
        const shape = new THREE.Shape(w.pts.map((p) => new THREE.Vector2(p.x * M, -p.y * M)));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: w.height * M, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xd8d4cc }));
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: 0x8a857c }));
        content.add(mesh, edges);
      }
    }
    for (const s of scene.solids) {
      if (!show.wallUnits && s.id && wallUnitIds.has(s.id)) continue;
      content.add(solidMesh(s, s.id !== undefined && s.id === selected));
    }
    if (show.labels) {
      for (const tg of scene.tags) {
        if (!show.wallUnits && tg.id && wallUnitIds.has(tg.id)) continue;
        content.add(tagObject(tg, tg.id !== undefined && tg.id === selected));
      }
    }
    if (show.dims) {
      const mat = new THREE.LineBasicMaterial({ color: 0x1d4ed8 });
      for (const d of scene.dims) {
        const a = v3(d.a.x, d.a.y, d.a.z), b = v3(d.b.x, d.b.y, d.b.z);
        const tick = new THREE.Vector3(d.tick.x, 0, d.tick.y).multiplyScalar(0.08);
        const pts = [a, b, a.clone().sub(tick), a.clone().add(tick), b.clone().sub(tick), b.clone().add(tick)];
        content.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat));
        content.add(tagObject({ at: { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2, z: 2 }, lines: [d.text], kind: 'dim' }, false));
      }
    }
    t.render();
  }, [scene, show.dims, show.walls, show.wallUnits, show.labels, selected, wallUnitIds]);

  // Apply the chosen view.
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    if (view === 'top') t.fit(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
    else if (view === 'iso') {
      // From the room side, above and a little to one side, so fronts and tops both show.
      const walls = scene.walls.length;
      let dir = new THREE.Vector3(0.55, 0.75, 1);
      if (walls) {
        const c = scene.solids.length ? scene.solids.reduce((a, s) => a.add(new THREE.Vector3(s.n.x, 0, s.n.y)), new THREE.Vector3()) : new THREE.Vector3(0, 0, 1);
        if (c.lengthSq() > 1e-6) { c.normalize(); dir = c.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.6).setY(0.75); }
      }
      t.fit(dir);
    } else t.fit(new THREE.Vector3(view.n.x, 0.12, view.n.y));
    // Only when the view is asked for, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  useImperativeHandle(handle, () => ({
    fit: () => three.current?.fit(),
    snapshot: () => {
      const t = three.current;
      if (!t) return null;
      t.render();
      const src = t.renderer.domElement;
      const out = document.createElement('canvas');
      out.width = src.width; out.height = src.height;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(src, 0, 0);
      // Draw the labels into the picture: they are HTML on screen, not part of the 3D canvas.
      const scale = src.width / Math.max(1, src.clientWidth);
      t.content.traverse((o) => {
        if (!(o instanceof CSS2DObject) || !o.element.isConnected) return;
        const p = o.getWorldPosition(new THREE.Vector3()).project(t.camera);
        if (p.z < -1 || p.z > 1) return;
        const x = (p.x + 1) / 2 * out.width, y = (1 - p.y) / 2 * out.height;
        const rows = [...o.element.children].map((c) => c.textContent ?? '');
        const dim = o.element.classList.contains('tag-dim');
        ctx.font = `600 ${(dim ? 13 : 12) * scale}px Segoe UI, sans-serif`;
        const lh = 15 * scale;
        const w = Math.max(...rows.map((r) => ctx.measureText(r).width)) + 10 * scale, h = rows.length * lh + 6 * scale;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.strokeStyle = dim ? '#1D4ED8' : '#8A857C';
        ctx.lineWidth = scale;
        ctx.fillRect(x - w / 2, y - h / 2, w, h);
        ctx.strokeRect(x - w / 2, y - h / 2, w, h);
        ctx.fillStyle = dim ? '#1D4ED8' : '#1C1B19';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        rows.forEach((r, i) => ctx.fillText(r, x, y - h / 2 + 3 * scale + lh * (i + 0.5)));
      });
      return out.toDataURL('image/png');
    },
  }), []);

  return <div ref={host} className="scene3d" />;
}
