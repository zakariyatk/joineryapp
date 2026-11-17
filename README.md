# JoineryApp

A Windows desktop app for joinery workshops: draw cabinets, get the cutting list and sheet layouts, and price the job as a quote.

Built with Electron, React and TypeScript.

## What it does

| Screen | |
| --- | --- |
| **Projects** | All jobs with status (Drafting → Quoted → In production → Installed), quote value, and a "continue" card showing where each job is. |
| **Drawings** | Parametric units (base, wall, tall) from templates. **Add units** creates several cabinets of one template at once, each with its own name, width, height, depth and quantity; typing a list of widths like `300, 450, 600` creates the rows for you. Change width, height, depth, plinth, drawer, shelves or doors and the front elevation and side section redraw with dimensions. Export **DXF** for CAD/CNC or a **PDF** drawing sheet. |
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

`npm run dev` starts Vite and opens the app in Electron:

- Changes in `src/` (screens, styles, logic) appear instantly through Vite hot reload.
- Changes in `electron/` (main process, preload) restart the app automatically (`scripts/dev-electron.mjs`).
- Closing the app window stops the dev session. `Ctrl+Shift+I` opens DevTools.
- Dev and installed copies share `%APPDATA%\JoineryApp`, so back up `joinery-data.json` before experimenting with real projects.

| Command | |
| --- | --- |
| `npm run dev` | Run the app in development |
| `npm test` | Unit tests for part generation, nesting, pricing and exports |
| `npm run build` | Type-check and build the renderer into `dist/` |
| `npm start` | Run Electron against the built `dist/` |
| `npm run dist` | Build the Windows installer, `release/JoineryApp-Setup-<version>.exe` |

## Installing on Windows

Run `npm run dist`, then copy `release/JoineryApp-Setup-<version>.exe` to the PC and run it.

- The installer asks where to install and adds Start menu and desktop shortcuts. It installs for the current user, so no admin rights are needed.
- Uninstall from **Settings → Apps**. Saved projects in `%APPDATA%\joineryapp` are kept, so reinstalling or upgrading doesn't lose work.
- The installer is not code-signed, so Windows SmartScreen will warn "Windows protected your PC" the first time. Choose **More info → Run anyway**. Signing it needs a code-signing certificate.

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
