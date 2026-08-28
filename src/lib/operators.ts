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
    color: "#7baf3c",
    ink: "#0d1806",
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

export function operatorRank(co: Company): number {
  const index = PRECEDENCE.indexOf(co);
  return index < 0 ? PRECEDENCE.length : index;
}

/** Airport Express is styled apart from the rest of the MTR. */
const AEL_COLOR = "#00888a";

export function plateStyle(co: Company[], route: string): { background: string; color: string } {
  const primary = co[0] ?? "kmb";
  if (primary === "mtr" && route === "AEL") return { background: AEL_COLOR, color: "#ffffff" };

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

/** Label such as "九巴 KMB" or "聯營 KMB · Citybus". */
export function operatorLabel(co: Company[], lang: "zh" | "en"): string {
  if (co.length > 1) {
    const joined = co.map((c) => OPERATORS[c].short.en).join(" · ");
    return lang === "zh" ? `聯營 ${joined}` : `Joint · ${joined}`;
  }
  const only = co[0];
  return only ? OPERATORS[only].name[lang] : "";
}
