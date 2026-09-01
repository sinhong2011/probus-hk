import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ChevronLeftIcon } from "./Icons";

/** A mouse or trackpad that can hover: swipe is not the obvious gesture there. */
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

const finePointer = () =>
  typeof matchMedia === "function" && matchMedia(FINE_POINTER).matches;

/**
 * The face of a row that slides aside to show the deeds behind it.
 *
 * iOS Mail's gesture: a horizontal pan reveals the actions, a vertical pan
 * is left to the page (`touch-action: pan-y` on the face). The parent says
 * which row is open, so opening one closes the rest. On a pointing device
 * the face peeks a sliver of colour and a chevron, because a mouse-drag
 * swipe is not something anyone looks for.
 */
export function SwipeActions(props: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Fires as the finger lands, so a sibling that is already open can close. */
  onEngage?: () => void;
  /** Spoken name of the hover chevron; omit it and the chevron stays off. */
  hintLabel?: string;
  actions: JSX.Element;
  children: JSX.Element;
  class?: string;
}) {
  const [offset, setOffset] = createSignal(0, { ownedWrite: true });
  const [dragging, setDragging] = createSignal(false, { ownedWrite: true });
  const [width, setWidth] = createSignal(0, { ownedWrite: true });
  const [peeking, setPeeking] = createSignal(false, { ownedWrite: true });

  const PEEK = 16;

  const shift = () => {
    if (dragging()) return offset();
    if (props.open) return width();
    return peeking() ? Math.min(PEEK, width() || PEEK) : offset();
  };

  const watchActions = (el: HTMLElement) => {
    const measure = () => setWidth(el.offsetWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };

  createEffect(
    () => [props.open, width(), dragging()] as const,
    ([open, max, drag]) => {
      if (drag) return;
      setOffset(open ? max : 0);
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

  const clamp = (value: number, max: number) => {
    if (value < 0) return value * 0.2;
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
    const max = width();
    const next = offset();
    const open = next > max * 0.35 || (props.open && next > max * 0.65);
    setOffset(open ? max : 0);
    if (open) props.onOpen();
    else props.onClose();
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
    startOffset = shift();
    axis = null;
    moved = false;
  };

  const onMouseEnter = () => {
    if (!finePointer() || props.open) return;
    setPeeking(true);
  };

  const onMouseLeave = () => setPeeking(false);

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
    setOffset(clamp(startOffset - dx, width()));
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!tracking) return;
    const wasX = axis === "x";
    const didMove = moved;
    const wasOpen = props.open;
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
    setOffset(props.open ? width() : 0);
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
      props.onOpen();
    }
    if (event.key === "Escape" || event.key === "ArrowRight") {
      if (!props.open) return;
      event.preventDefault();
      props.onClose();
    }
  };

  return (
    <div
      class={["app-swipe relative overflow-hidden", props.class ?? ""]}
      data-swipe-open={props.open ? "" : undefined}
      onKeyDown={onKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        ref={watchActions}
        class="absolute inset-y-0 right-0 flex"
        aria-hidden={props.open ? undefined : "true"}
        style={{ "pointer-events": props.open ? "auto" : "none" }}
      >
        {props.actions}
      </div>
      <div
        ref={watchFace}
        class="app-swipe-face relative bg-card"
        data-dragging={dragging() ? "" : undefined}
        style={{
          translate: `-${shift()}px 0`,
          "pointer-events": props.open ? "auto" : undefined,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div style={{ "pointer-events": props.open ? "none" : undefined }}>{props.children}</div>
        <Show when={props.hintLabel && !props.open}>
          <button
            type="button"
            data-swipe-hint
            tabIndex={-1}
            aria-label={props.hintLabel}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onOpen();
            }}
            class="app-swipe-hint absolute inset-y-0 right-0 z-10 items-center justify-center px-1.5 text-faint-foreground"
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
