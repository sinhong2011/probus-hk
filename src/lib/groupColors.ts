import { settings } from "~/stores/settings";

/**
 * The colours a star group's tag can wear.
 *
 * A fixed palette rather than a free colour wheel: eight hues picked to stay
 * apart from each other and legible in both themes (each name is a CSS token
 * with a light and a dark value), which a wheel cannot promise. Every group
 * starts coloured - the name is hashed onto the palette - and the sheet lets
 * the rider move it to another swatch, stored by group name.
 */
export const GROUP_COLORS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

/** The same name always lands on the same swatch, on every device. */
export function defaultGroupColor(name: string): GroupColor {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return GROUP_COLORS[hash % GROUP_COLORS.length] ?? "indigo";
}

/** The swatch a group wears right now: the rider's pick, or the hashed one. */
export function groupColor(name: string): GroupColor {
  const chosen = settings.groupColors()[name] as GroupColor | undefined;
  return chosen && GROUP_COLORS.includes(chosen) ? chosen : defaultGroupColor(name);
}

/** The CSS colour behind a swatch name. */
export function groupColorVar(color: GroupColor): string {
  return `var(--group-${color})`;
}

/** Inline styles for a tag in the group's colour: tinted ground, full ink. */
export function groupTagStyle(name: string): Record<string, string> {
  const paint = groupColorVar(groupColor(name));
  return {
    color: paint,
    background: `color-mix(in srgb, ${paint} 15%, transparent)`,
  };
}
