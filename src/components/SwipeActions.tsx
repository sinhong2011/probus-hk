import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";

export type SwipeSide = "leading" | "trailing";

/**
 * The face of a row that slides aside to show the deeds behind it.
 *
 * Swipe left for the trailing deeds (pin, restop, group, delete). Swipe
 * right for the leading deed (the reorder grip). A vertical pan is left
 * to the page (`touch-action: pan-y`). The parent says which row is open,
 * so opening one closes the rest. A pointing device gets hover chevrons
 * instead of a peek: the trailing rightmost deed is Delete, and a sliver
 * of that red reads as a broken row, not as a handle.
 */
export function SwipeActions(props: {
  open: SwipeSide | false;
  onOpen: (side: SwipeSide) => void;
  onClose: () => void;
  /** Fires as the finger lands, so a sibling that is already open can close. */
  onEngage?: () => void;
  /** Spoken name of the trailing hover chevron; omit it and that chevron stays off. */
  hintLabel?: string;
  /** Spoken name of the leading hover chevron. */
  leadingHintLabel?: string;
  /** Revealed by a swipe right: the reorder grip, when the list can be dragged. */
  leading?: JSX.Element;
  actions: JSX.Element;
  children: JSX.Element;
  class?: string;
}) {
  const [offset, setOffset] = createSignal(0, { ownedWrite: true });
  const [dragging, setDragging] = createSignal(false, { ownedWrite: true });
  const [trailingW, setTrailingW] = createSignal(0, { ownedWrite: true });
  const [leadingW, setLeadingW] = createSignal(0, { ownedWrite: true });

  const watch = (set: (n: number) => void) => (el: HTMLElement) => {
    const measure = () => set(el.offsetWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    onCleanup(() => {
      observer.disconnect();
      set(0);
    });
  };

  createEffect(
    () => [props.open, trailingW(), leadingW(), dragging()] as const,
    ([open, trail, lead, drag]) => {
      if (drag) return;
      if (open === "trailing") setOffset(trail);
      else if (open === "leading") setOffset(-lead);
      else setOffset(0);
    },
  );

  let tracking = false;
  let startX = 0;
  let startY = 0;
  let startOffset = 0;
  let axis: "x" | "y" | null = null;
  let moved = false;
  let suppressClick = false;
  let face: HTMLElement | undefined;

  const clamp = (value: number) => {
    const max = trailingW();
    const min = -leadingW();
    if (value < min) return min + (value - min) * 0.2;
    if (value > max) return max + (value - max) * 0.2;
    return value;
  };

  const release = (pointerId: number) => {
    if (!face) return;
    try {
      face.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
  };

  const snap = () => {
    const next = offset();
    const trail = trailingW();
    const lead = leadingW();
    const side = props.open;

    if (next > 0 && trail > 0) {
      const open = next > trail * 0.35 || (side === "trailing" && next > trail * 0.65);
      if (open) {
        setOffset(trail);
        props.onOpen("trailing");
        return;
      }
    }
    if (next < 0 && lead > 0) {
      const open = next < -lead * 0.35 || (side === "leading" && next < -lead * 0.65);
      if (open) {
        setOffset(-lead);
        props.onOpen("leading");
        return;
      }
    }
    setOffset(0);
    props.onClose();
  };

  const reset = () => {
    tracking = false;
    axis = null;
    setDragging(false);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-drag-handle]")) return;
    if (target?.closest("[data-swipe-hint]")) return;
    props.onEngage?.();
    tracking = true;
    startX = event.clientX;
    startY = event.clientY;
    startOffset = offset();
    axis = null;
    moved = false;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!tracking) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (axis === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis = Math.abs(dx) > Math.abs(dy) * 1.1 ? "x" : "y";
      if (axis !== "x") return;
      moved = true;
      setDragging(true);
      face?.setPointerCapture(event.pointerId);
    }
    if (axis !== "x") return;
    moved = true;
    setOffset(clamp(startOffset - dx));
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!tracking) return;
    const wasX = axis === "x";
    const didMove = moved;
    const wasOpen = Boolean(props.open);
    release(event.pointerId);
    reset();
    if (wasX) {
      suppressClick = true;
      snap();
      return;
    }
    if (wasOpen && !didMove) {
      suppressClick = true;
      props.onClose();
    }
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (!tracking) return;
    release(event.pointerId);
    reset();
    suppressClick = false;
    if (props.open === "trailing") setOffset(trailingW());
    else if (props.open === "leading") setOffset(-leadingW());
    else setOffset(0);
  };

  const onClick = (event: MouseEvent) => {
    if (!suppressClick && !props.open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClick = false;
  };

  const watchFace = (el: HTMLElement) => {
    face = el;
    // Capture, because the row's own link navigates in the target phase -
    // a bubble listener would close the swipe and still follow the route.
    el.addEventListener("click", onClick, true);
    onCleanup(() => el.removeEventListener("click", onClick, true));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (props.open === "leading") props.onClose();
      else props.onOpen("trailing");
    }
    if (event.key === "ArrowRight") {
      if (props.open === "trailing") {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (leadingW() > 0) {
        event.preventDefault();
        props.onOpen("leading");
        return;
      }
    }
    if (event.key === "Escape") {
      if (!props.open) return;
      event.preventDefault();
      props.onClose();
    }
  };

  const open = () => props.open;

  return (
    <div
      class={["app-swipe relative overflow-hidden", props.class ?? ""]}
      data-swipe-open={open() ? open() : undefined}
      onKeyDown={onKeyDown}
    >
      <Show when={props.leading}>
        <div
          ref={watch(setLeadingW)}
          class="absolute inset-y-0 left-0 flex"
          aria-hidden={open() === "leading" ? undefined : "true"}
          style={{ "pointer-events": open() === "leading" ? "auto" : "none" }}
        >
          {props.leading}
        </div>
      </Show>
      <div
        ref={watch(setTrailingW)}
        class="absolute inset-y-0 right-0 flex"
        aria-hidden={open() === "trailing" ? undefined : "true"}
        style={{ "pointer-events": open() === "trailing" ? "auto" : "none" }}
      >
        {props.actions}
      </div>
      <div
        ref={watchFace}
        class="app-swipe-face relative bg-card"
        data-dragging={dragging() ? "" : undefined}
        style={{
          translate: `${-offset()}px 0`,
          "pointer-events": open() ? "auto" : undefined,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div style={{ "pointer-events": open() ? "none" : undefined }}>{props.children}</div>
        <Show when={props.leadingHintLabel && props.leading && !open()}>
          <button
            type="button"
            data-swipe-hint
            tabIndex={-1}
            aria-label={props.leadingHintLabel}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onOpen("leading");
            }}
            class="app-swipe-hint absolute inset-y-0 left-0 z-10 items-center justify-center bg-card px-2 text-faint-foreground"
          >
            <ChevronRightIcon size={14} />
          </button>
        </Show>
        <Show when={props.hintLabel && !open()}>
          <button
            type="button"
            data-swipe-hint
            tabIndex={-1}
            aria-label={props.hintLabel}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onOpen("trailing");
            }}
            class="app-swipe-hint absolute inset-y-0 right-0 z-10 items-center justify-center bg-card px-2 text-faint-foreground"
          >
            <ChevronLeftIcon size={14} />
          </button>
        </Show>
      </div>
    </div>
  );
}

/** One deed behind a swipe, the full height of the row. */
export function SwipeDeed(props: {
  label: string;
  /** Drawn under the icon; the aria label stays `label` if they differ. */
  caption?: string;
  onPress: () => void;
  kind?: "primary" | "muted" | "danger";
  pressed?: boolean;
  children: JSX.Element;
}) {
  const kind = () => props.kind ?? "muted";
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.pressed === undefined ? undefined : props.pressed ? "true" : "false"}
      onClick={props.onPress}
      class={[
        "flex min-w-14 shrink-0 flex-col items-center justify-center gap-0.5 px-1.5",
        {
          "bg-primary text-primary-foreground": kind() === "primary",
          "bg-muted-foreground text-background": kind() === "muted",
          "bg-destructive text-white": kind() === "danger",
        },
      ]}
    >
      {props.children}
      <span
        aria-hidden="true"
        class="max-w-[4.25rem] text-center text-[0.625rem] leading-[1.15] font-bold break-words"
      >
        {props.caption ?? props.label}
      </span>
    </button>
  );
}
