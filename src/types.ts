// Domain model. All lengths are millimetres.

export type UnitType = 'base' | 'wall' | 'tall';
export type DoorStyle = 'shaker' | 'slab';
export type MaterialRole = 'carcass' | 'front' | 'back';
export type ProjectStatus = 'Drafting' | 'Quoted' | 'In production' | 'Installed';

export interface Unit {
  id: string;
  code: string; // e.g. "B1"
  name: string;
  type: UnitType;
  qty: number;
  width: number;
  height: number; // carcass height, excludes plinth
  depth: number;
  plinth: number; // 0 for wall units
  drawerHeight: number; // 0 = no top drawer
  shelves: number;
  doors: number; // 0 = automatic (1 door up to 700 wide, else 2)
  doorStyle: DoorStyle;
  /** 'build' when created by the Build page; those are replaced when the run is re-created. */
  source?: 'build';
}

/** Front layout of one cabinet in a run. */
export type SlotKind = 'standard' | 'doors';

export interface RunSlot {
  /** Fixed width in mm, or null to share the remaining length equally. */
  width: number | null;
  kind: SlotKind;
}

/** A straight run of cabinets along one wall, generated from its total length. */
export interface RunConfig {
  length: number;
  maxWidth: number;
  /** Number of base cabinets, or null to work it out from length ÷ max width. */
  count: number | null;
  slots: RunSlot[];
  baseHeight: number;
  baseDepth: number;
  plinth: number;
  worktop: number; // thickness
  overhang: number; // worktop past the doors
  wall: boolean;
  wallHeight: number;
  wallDepth: number;
  wallBottom: number; // underside of wall cabinets above the floor
}

/** Per-project override of an estimate line's quantity or rate. */
export interface LineOverride {
  q?: number;
  r?: number;
}

export interface CustomLine {
  id: string;
  name: string;
  unit: string;
  q: number;
  r: number;
}

export interface ProjectEstimate {
  overhead: number; // %
  margin: number; // %
  tax: number; // %
  overrides: Record<string, LineOverride>;
  extras: CustomLine[];
}

export interface Project {
  id: string;
  name: string;
  client: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  units: Unit[];
  run?: RunConfig;
  estimate: ProjectEstimate;
}

export interface Material {
  name: string;
  thickness: number;
  sheetLength: number;
  sheetWidth: number;
  price: number; // per sheet
  grain: boolean; // true = parts must not be rotated on the sheet
}

export interface Settings {
  company: string;
  currency: string; // symbol or prefix, e.g. "₹" or "AED "
  materials: Record<MaterialRole, Material>;
  edgeBandPrice: number; // per metre
  edgeWaste: number; // % added to banding length
  kerf: number;
  trim: number; // trimmed off each sheet edge
  hardware: {
    hinge: number;
    runner: number; // per pair
    handle: number;
    leg: number;
    shelfPin: number;
    fittings: number; // cam & dowel set per unit
    wallHanger: number; // per pair
  };
  labourRates: {
    cutting: number;
    edging: number;
    assembly: number;
    finishing: number;
    install: number;
  };
}

export interface AppData {
  version: 1;
  settings: Settings;
  projects: Project[];
}

/** One line of the cutting list (before multiplying out for nesting). */
export interface Part {
  key: string;
  unitId: string;
  unitCode: string;
  name: string;
  qty: number;
  length: number;
  width: number;
  thickness: number;
  role: MaterialRole;
  /** Banded edges: [L1, L2, W1, W2] */
  edges: [boolean, boolean, boolean, boolean];
}
