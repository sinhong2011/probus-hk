import type { Company } from "~/data/types";
import { plateStyle } from "~/lib/operators";

export type PlateSize = "xs" | "sm" | "md" | "lg";

const SIZES: Record<PlateSize, { min: string; width: string; height: string; text: string }> = {
  /* Four fifths of `sm`: for a dense list, where the plate is a marker in a
     row rather than the row's subject. */
  xs: { min: "2.8rem", width: "2.8rem", height: "1.55rem", text: "0.8rem" },
  sm: { min: "3rem", width: "4.5rem", height: "1.9375rem", text: "1rem" },
  md: { min: "3.25rem", width: "3.5rem", height: "2.25rem", text: "1.125rem" },
  lg: { min: "3.75rem", width: "3.75rem", height: "2.625rem", text: "1.5rem" },
};

/**
 * The route number on an operator-coloured plate. This is the only place
 * operator identity is expressed, which is why a joint route splits the plate
 * rather than tinting the surrounding card.
 */
export function RoutePlate(props: {
  route: string;
  co: Company[];
  size?: PlateSize;
  /** Dims the plate for a route that is not running. */
  muted?: boolean;
  /**
   * Same width for every plate in a column. Without it only a minimum is
   * set, so "1" and "269M" leave the destination starting at different places.
   */
  fixed?: boolean;
}) {
  const size = () => SIZES[props.size ?? "md"];
  const style = () => plateStyle(props.co, props.route);
  const joint = () => props.co.length > 1;
  const box = () => ({
    width: props.fixed ? size().width : undefined,
    "min-width": size().min,
    "max-width": props.fixed ? size().width : undefined,
    height: size().height,
  });

  return (
    <div
      class={[
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg",
        props.size === "lg" || props.size === "md" ? "px-2" : "px-1",
      ]}
      style={
        props.muted
          ? { ...box(), background: "var(--secondary)" }
          : { ...box(), background: style().background }
      }
    >
      <span
        class="max-w-full truncate font-extrabold tracking-[-0.03em]"
        style={{
          "font-size": size().text,
          "line-height": "1",
          color: props.muted ? "var(--faint-foreground)" : style().color,
          // A split plate puts white type over both halves; the shadow keeps it
          // legible where it crosses Citybus yellow.
          "text-shadow": joint() && !props.muted ? "0 1px 2px rgb(0 0 0 / 0.45)" : undefined,
        }}
      >
        {props.route}
      </span>
    </div>
  );
}
