import { createSignal, onCleanup } from "solid-js";

/**
 * Whether the window is wide - Tailwind's `lg`, where the app puts up its
 * desktop shell - as something a component can branch on, for the cases CSS
 * cannot decide: which edge a sheet comes from, what a field's placeholder
 * says, where a drawer lives. Call it inside a component; it follows the
 * window as it is resized and lets go when the component does.
 */
export function createWide(): () => boolean {
  const [wide, setWide] = createSignal(false, { ownedWrite: true });
  if (typeof window === "undefined") return wide;
  const media = window.matchMedia("(min-width: 64rem)");
  const read = () => setWide(media.matches);
  read();
  media.addEventListener("change", read);
  onCleanup(() => media.removeEventListener("change", read));
  return wide;
}
