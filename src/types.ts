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
  /** Drawer unit: number of equal drawers filling the height (no doors, no top drawer). 0 or missing = not a drawer unit. */
  drawers?: number;
  /** 'build' when created by the Build page; those are replaced when the run is re-created. */
  source?: 'build';
}

/** Front layout of one cabinet in a run. */
/**
 * Kind of base unit. 'doors' (doors only, count automatic) is kept for drawings
 * made before the named door units existed.
 */
export type SlotKind = 'standard' | 'drawers' | 'pullout' | 'bin' | 'sink' | 'door1' | 'door2' | 'doors';

export interface RunSlot {
  /** Fixed width in mm, or null to share the remaining length equally. */
  width: number | null;
  kind: SlotKind;
  /** Drawers in a 'drawers' slot (default 3). */
  drawers?: number;
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

/** Which level a drawn cabinet sits at. */
export type DrawnLayer = 'base' | 'wall' | 'tall';

/** A cabinet drawn on the Build plan. Positions are exact millimetres. */
export interface DrawnCabinet {
  id: string;
  layer: DrawnLayer;
  /** Start: left edge, measured from the left end of the wall. End = x + width. */
  x: number;
  width: number;
  depth: number;
  /** Starting level: underside of the carcass above the floor (the plinth height for base and tall units). */
  bottom: number;
  /** Ending level: top of the carcass above the floor. */
  top: number;
  kind: SlotKind;
  drawers?: number;
  /** Index of the room wall it stands against (0 when there is only one wall). */
  wall?: number;
  /** Gap between the wall face and the back of the cabinet (0 = against the wall; larger for islands). */
  offset?: number;
}

export interface Pt { x: number; y: number }

/**
 * One run of connected block walls. Points trace the finished inside face that
 * cabinets stand against; the wall thickness is built outwards from it.
 */
export interface WallChain {
  points: Pt[];
  closed: boolean;
  /** Swap which side of this run is the room. */
  flip?: boolean;
}

/** Block walls drawn on the Build plan. */
export interface Room {
  chains: WallChain[];
  thickness: number;
  /** Wall height for elevations and sections (mm). */
  height?: number;
  /** Saved before walls could be drawn as several runs; read once by roomOf(). */
  points?: Pt[];
  closed?: boolean;
  flip?: boolean;
}

/** Cabinets drawn on the Build page, along one straight wall or the walls of a drawn room. */
export interface DrawnLayout {
  /** Length of the single straight wall used when no room has been drawn. */
  length: number;
  room?: Room;
  worktop: number;
  overhang: number;
  cabinets: DrawnCabinet[];
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
  /** Cabinets drawn in the Build page's Draw plan mode. */
  layout?: DrawnLayout;
  /** Which Build mode was used last. */
  buildMode?: 'length' | 'draw' | '3d';
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
