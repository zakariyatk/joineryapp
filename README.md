# JoineryApp

A Windows desktop app for joinery workshops: draw cabinets, get the cutting list and sheet layouts, and price the job as a quote.

Built with Electron, React and TypeScript.

## What it does

| Screen | |
| --- | --- |
| **Projects** | All jobs with status (Drafting → Quoted → In production → Installed), quote value, and a "continue" card showing where each job is. |
| **Drawings** | Parametric units (base, wall, tall) from templates. Change width, height, depth, plinth, drawer, shelves or doors and the front elevation and side section redraw with dimensions. Export **DXF** for CAD/CNC or a **PDF** drawing sheet. |
| **Cutting list** | Every part with size, thickness, material and edge banding (L1 L2 W1 W2), generated from the drawings. Sheet layouts are optimised with guillotine cuts that can be made on a panel saw, honouring kerf, edge trim and grain. Export **CSV** or a **PDF** with layouts. |
| **Estimate & quote** | Materials (from the sheet count), edge banding, hardware and labour hours are calculated automatically. Any quantity or rate can be overridden per project, and you can add extra lines. Overhead, margin and tax are applied, and a **quote PDF** is generated. |
| **Materials & rates** | Board names, thickness, sheet size and price; hardware prices; labour rates; company name and currency. |

Projects save automatically to `%APPDATA%\joineryapp\joinery-data.json`. The previous version is kept as `.bak`.

## Getting started

Requires Node.js 20 or later.

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and opens the app in Electron with hot reload.

| Command | |
| --- | --- |
| `npm run dev` | Run the app in development |
| `npm test` | Unit tests for part generation, nesting, pricing and exports |
| `npm run build` | Type-check and build the renderer into `dist/` |
| `npm start` | Run Electron against the built `dist/` |
| `npm run dist` | Build a Windows installer into `release/` |

## How the numbers are worked out

All sizes are in millimetres. The rules live in `src/lib/` and are covered by tests.

- **Carcass:** sides run full height, and panels fit between them (width − 2 × board thickness). Base units get a bottom and two 100 mm top rails. Wall and tall units get a full top and bottom.
- **Back:** a grooved panel, (W − 24) × (H − 12).
- **Fronts:** 2 mm reveal all round. Units wider than 700 mm get two doors automatically. Hinges are 2 per door up to 900 mm high, 3 up to 1600 mm, then 4.
- **Edge banding:** front edges of carcass parts and all four edges of fronts, plus the waste % from settings.
- **Labour hours:** estimated from part count, sheets, banding length, units, drawers and front area, and rounded up to half hours. Treat them as a starting point and adjust per job.

The prices in a new install are placeholders. Set your own in **Materials & rates**.

## Project layout

```
electron/        main process (window, saving, DXF/CSV/PDF export) and preload bridge
src/lib/         cabinet rules, nesting, drawing geometry, estimate, exporters (+ tests)
src/screens/     Projects, DrawingEditor, CuttingList, Estimate, Settings
src/components/  sidebar, unit drawing, sheet view, inputs
```
