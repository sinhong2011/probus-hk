import { For } from "solid-js";
import { Card, Hairline } from "./Chrome";
import { CardColumnItem } from "./Layout";

/**
 * A placeholder in the shape of the thing that is coming.
 *
 * Sized to the real content rather than to a generic bar, so nothing jumps when
 * the value lands - a skeleton that is the wrong size is its own layout shift.
 */
export function Skeleton(props: { width: string; height: string; class?: string }) {
  return (
    <span
      class={`app-shimmer block rounded-md ${props.class ?? ""}`}
      style={{ width: props.width, height: props.height }}
      aria-hidden="true"
    />
  );
}

/** The countdown's shape: one wide numeral over a narrower unit. */
export function EtaSkeleton(props: { size?: "sm" | "md" | "lg"; class?: string }) {
  const height = () => ({ sm: "1.5rem", md: "1.85rem", lg: "2.15rem" })[props.size ?? "md"];
  return (
    <div class={["flex shrink-0 flex-col items-end gap-1.5", props.class ?? ""]} aria-hidden="true">
      <Skeleton width="2.6rem" height={height()} />
      <Skeleton width="1.6rem" height="0.5rem" />
    </div>
  );
}

/**
 * The wait before the nearby list lands, in the shape of the cards that replace
 * it: a stop's name over the routes calling there. Three of them, because that
 * is about a screenful on a phone - fewer read as a short list that then grew.
 */
export function StopListSkeleton() {
  return (
    <For each={[0, 1, 2]}>
      {() => (
        <CardColumnItem>
          <Card>
            <div class="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3">
              <Skeleton width="9rem" height="0.94rem" />
            </div>
            <Hairline />
            <For each={[0, 1]}>
              {(row) => (
                <>
                  {row > 0 ? <Hairline /> : null}
                  <div class="flex items-center gap-3 px-3.5 py-2.5">
                    <Skeleton width="2.6rem" height="1.6rem" />
                    <div class="flex grow flex-col gap-1.5">
                      <Skeleton width="7rem" height="0.88rem" />
                      <Skeleton width="4.5rem" height="0.75rem" />
                    </div>
                    <EtaSkeleton size="sm" />
                  </div>
                </>
              )}
            </For>
          </Card>
        </CardColumnItem>
      )}
    </For>
  );
}
