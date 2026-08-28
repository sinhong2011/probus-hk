/**
 * A placeholder in the shape of the thing that is coming.
 *
 * Sized to the real content rather than to a generic bar, so nothing jumps when
 * the value lands - a skeleton that is the wrong size is its own layout shift.
 */
export function Skeleton(props: { width: string; height: string; class?: string }) {
  return (
    <span
      class={`mb-shimmer block rounded-md ${props.class ?? ""}`}
      style={{ width: props.width, height: props.height }}
      aria-hidden="true"
    />
  );
}

/** The countdown's shape: one wide numeral over a narrower unit. */
export function EtaSkeleton(props: { size?: "sm" | "md" | "lg" }) {
  const height = () => ({ sm: "1.5rem", md: "1.85rem", lg: "2.15rem" })[props.size ?? "md"];
  return (
    <div class="flex shrink-0 flex-col items-end gap-1.5" aria-hidden="true">
      <Skeleton width="2.6rem" height={height()} />
      <Skeleton width="1.6rem" height="0.5rem" />
    </div>
  );
}
