import type { Company } from "~/data/types";
import { plateStyle } from "~/lib/operators";

export type PlateSize = "sm" | "md" | "lg";

const SIZES: Record<PlateSize, { min: string; height: string; text: string }> = {
  sm: { min: "3rem", height: "1.9375rem", text: "1rem" },
  md: { min: "3.25rem", height: "2.25rem", text: "1.125rem" },
  lg: { min: "3.75rem", height: "2.625rem", text: "1.5rem" },
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
}) {
  const size = () => SIZES[props.size ?? "md"];
  const style = () => plateStyle(props.co, props.route);
  const joint = () => props.co.length > 1;

  return (
    <div
      class="flex shrink-0 items-center justify-center rounded-lg px-2"
      style={
        props.muted
          ? {
              "min-width": size().min,
              height: size().height,
              background: "var(--secondary)",
            }
          : { "min-width": size().min, height: size().height, background: style().background }
      }
    >
      <span
        class="font-extrabold tracking-[-0.03em]"
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
