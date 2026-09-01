import type { Bilingual, Company } from "~/data/types";

export interface OperatorStyle {
  name: Bilingual;
  /** Short form used on dense rows. */
  short: Bilingual;
  /** Brand colour of the route plate. */
  color: string;
  /** Text colour that sits legibly on `color`. */
  ink: string;
}

export const OPERATORS: Record<Company, OperatorStyle> = {
  kmb: {
    name: { zh: "九巴", en: "KMB" },
    short: { zh: "九巴", en: "KMB" },
    color: "#d71920",
    ink: "#ffffff",
  },
  ctb: {
    name: { zh: "城巴", en: "Citybus" },
    short: { zh: "城巴", en: "CTB" },
    color: "#ffdd00",
    ink: "#161200",
  },
  nlb: {
    name: { zh: "嶼巴", en: "NLB" },
    short: { zh: "嶼巴", en: "NLB" },
    color: "#009fe3",
    ink: "#ffffff",
  },
  gmb: {
    name: { zh: "專線小巴", en: "Minibus" },
    short: { zh: "小巴", en: "GMB" },
    color: "#00843d",
    ink: "#ffffff",
  },
  mtr: {
    name: { zh: "港鐵", en: "MTR" },
    short: { zh: "港鐵", en: "MTR" },
    color: "#a32638",
    ink: "#ffffff",
  },
  lightRail: {
    name: { zh: "輕鐵", en: "Light Rail" },
    short: { zh: "輕鐵", en: "LR" },
    // The railway's own gold, not a green: on the network map the light rail
    // runs beside the Kwun Tong line's green, and they have to read apart.
    color: "#d3a809",
    ink: "#231c02",
  },
  lrtfeeder: {
    name: { zh: "港鐵巴士", en: "MTR Bus" },
    short: { zh: "港鐵巴士", en: "MTR Bus" },
    color: "#b4472e",
    ink: "#ffffff",
  },
  sunferry: {
    name: { zh: "新渡輪", en: "Sun Ferry" },
    short: { zh: "渡輪", en: "Ferry" },
    color: "#1d6fa3",
    ink: "#ffffff",
  },
  hkkf: {
    name: { zh: "港九小輪", en: "HKKF" },
    short: { zh: "渡輪", en: "Ferry" },
    color: "#1d6fa3",
    ink: "#ffffff",
  },
  fortuneferry: {
    name: { zh: "富裕小輪", en: "Fortune Ferry" },
    short: { zh: "渡輪", en: "Ferry" },
    color: "#1d6fa3",
    ink: "#ffffff",
  },
};

/**
 * Search results for a shared route number are ordered by how likely a rider is
 * to mean that operator - franchised buses first, then minibus and rail, then
 * ferries. Sorting by the internal company code instead would be alphabetical
 * and arbitrary, putting Citybus ahead of KMB for no reason.
 */
const PRECEDENCE: Company[] = [
  "kmb",
  "ctb",
  "nlb",
  "gmb",
  "lrtfeeder",
  "mtr",
  "lightRail",
  "sunferry",
  "hkkf",
  "fortuneferry",
];

/**
 * The kinds a rider sorts routes into. "1" is a KMB bus, a Citybus bus, a
 * Lantau bus and a green minibus, and someone typing it knows which of those
 * they are waiting for; this is the axis the results can be narrowed on.
 */
export type Kind = "bus" | "minibus" | "rail" | "ferry";

const KINDS: Record<Company, Kind> = {
  kmb: "bus",
  ctb: "bus",
  nlb: "bus",
  lrtfeeder: "bus",
  gmb: "minibus",
  mtr: "rail",
  lightRail: "rail",
  sunferry: "ferry",
  hkkf: "ferry",
  fortuneferry: "ferry",
};

export function kindOf(co: Company): Kind {
  return KINDS[co];
}

/**
 * Which of the three vehicles a route runs, for anything that draws one.
 *
 * Narrower than `Kind`: a drawn vehicle is a picture, and there are three
 * pictures - a bus, a minibus, a train. It lives here rather than beside
 * either drawing because the marker creeping along the map and the glyph
 * creeping up the rail in the stop list are the same vehicle at two scales,
 * and a route running a train on one and a bus on the other is two answers to
 * one question. A joint route takes the largest thing on it.
 */
export type VehicleKind = "bus" | "minibus" | "rail";

export function vehicleKind(cos: Company[]): VehicleKind {
  if (cos.some((co) => kindOf(co) === "rail")) return "rail";
  if (cos.some((co) => kindOf(co) === "minibus")) return "minibus";
  return "bus";
}

export function operatorRank(co: Company): number {
  const index = PRECEDENCE.indexOf(co);
  return index < 0 ? PRECEDENCE.length : index;
}

/**
 * Every MTR line has its own colour, and riders navigate by them - "take the
 * red line" is how the network is actually described. One maroon plate for all
 * ten lines threw that away.
 *
 * Values are the ones hkbus/hk-independent-bus-eta publishes, so a route looks
 * the same here as in the dataset this app's route logic comes from.
 */
const MTR_LINES: Record<string, string> = {
  AEL: "#03828B",
  TCL: "#F3982D",
  TML: "#9C2E00",
  TKL: "#7E3C93",
  EAL: "#5EB7E8",
  SIL: "#CBD300",
  TWL: "#E60012",
  ISL: "#0075C2",
  KTL: "#00A040",
  DRL: "#EB6EA5",
};

/** The light rail routes carry their own colours too, from the same source. */
const LIGHT_RAIL_LINES: Record<string, string> = {
  "505": "#DA2127",
  "507": "#00A652",
  "610": "#551C15",
  "614": "#00BFF3",
  "614P": "#F4858E",
  "615": "#FFDD00",
  "615P": "#016682",
  "705": "#73BF43",
  "706": "#B47AB5",
  "751": "#F48221",
  "761P": "#6F2D91",
};

const INK_DARK = "#101012";
const INK_LIGHT = "#ffffff";

/**
 * Ink that can actually be read on this background.
 *
 * White by default, because that is how the operators print their own route
 * numbers - but only while white clears 3:1, the threshold for large text.
 * Below that it flips to dark: white on Tung Chung orange or on light rail 614
 * measures about 2.2:1, which is unreadable however conventional it looks.
 *
 * Measured rather than listed, because there are twenty-one of these and
 * judging each by eye is twenty-one chances to get one wrong.
 */
function readableInk(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  const whiteContrast = 1.05 / (luminance + 0.05);
  return whiteContrast >= 3 ? INK_LIGHT : INK_DARK;
}

export function plateStyle(co: Company[], route: string): { background: string; color: string } {
  const primary = co[0] ?? "kmb";

  const line =
    primary === "mtr"
      ? MTR_LINES[route]
      : primary === "lightRail"
        ? LIGHT_RAIL_LINES[route]
        : undefined;
  if (line) return { background: line, color: readableInk(line) };

  const a = OPERATORS[primary];
  const second = co[1];
  if (second) {
    // 聯營 joint route: split the plate so both operators are visible at a glance.
    const b = OPERATORS[second];
    return {
      background: `linear-gradient(100deg, ${a.color} 0%, ${a.color} 50%, ${b.color} 50%, ${b.color} 100%)`,
      color: "#ffffff",
    };
  }
  return { background: a.color, color: a.ink };
}

/** The short form, for the line under a route number: "九巴", "KMB · CTB". */
export function operatorShort(co: Company[], lang: "zh" | "en"): string {
  return co.map((c) => OPERATORS[c].short[lang]).join(" · ");
}

/** Label such as "九巴 KMB" or "聯營 KMB · Citybus". */
export function operatorLabel(co: Company[], lang: "zh" | "en"): string {
  if (co.length > 1) {
    const joined = co.map((c) => OPERATORS[c].short.en).join(" · ");
    return lang === "zh" ? `聯營 ${joined}` : `Joint · ${joined}`;
  }
  const only = co[0];
  return only ? OPERATORS[only].name[lang] : "";
}
