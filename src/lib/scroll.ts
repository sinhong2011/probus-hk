/**
 * Bringing a row into view without dragging the rest of the page with it.
 *
 * `scrollIntoView` scrolls *every* scrollable ancestor on the way up, and to
 * script an `overflow: hidden` box is still scrollable - it just never scrolls
 * back. On a wide screen the stop list is a scroller inside a card inside a
 * clipped pane, so asking a row to centre itself scrolled all three: the card
 * shoved its own list up behind its rounded top and left a hole the height of
 * the shove underneath it. Only the box that is meant to scroll may move.
 */

/** The nearest ancestor that both may scroll and has somewhere to scroll to. */
function scroller(el: Element): Element | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) break;
    // A metre of slack: sub-pixel layout leaves most boxes a fraction taller
    // than their contents, which is not an offer to scroll.
    if (node.scrollHeight - node.clientHeight < 2) continue;
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return node;
  }
  return null;
}

/**
 * Put `el` in the middle of whatever is scrolling it - a pane on a wide screen,
 * the window on a phone. Both ends clamp themselves, so a row near either end
 * of the list lands as close to the middle as it can get.
 */
export function centerInView(el: Element, behavior: ScrollBehavior = "smooth") {
  const box = el.getBoundingClientRect();
  const pane = scroller(el);

  if (!pane) {
    window.scrollTo({
      top: window.scrollY + box.top - (window.innerHeight - box.height) / 2,
      behavior,
    });
    return;
  }

  const frame = pane.getBoundingClientRect();
  pane.scrollTo({
    top: pane.scrollTop + (box.top - frame.top) - (frame.height - box.height) / 2,
    behavior,
  });
}

/**
 * The same, held until the row stops changing shape.
 *
 * A jump lands on the stop it opens, and an open stop is still being written:
 * its arrivals, the panel under them and the ride controls all arrive after the
 * scroll that aimed at it, and a row that triples in height afterwards is a row
 * the scroll no longer points at - the last stop on a route ended up two pixels
 * below the fold. So the aim is corrected for as long as the row is moving, and
 * dropped the instant the rider takes over: nothing here outranks a hand on the
 * list.
 */
export function centerWhileItSettles(el: Element, settleMs = 1200) {
  centerInView(el);

  const observer = new ResizeObserver(() => centerInView(el));
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const event of TAKEOVER) window.removeEventListener(event, stop);
  };
  const timer = setTimeout(stop, settleMs);

  observer.observe(el);
  // On `window`, because every one of these reaches it whatever it started on.
  for (const event of TAKEOVER) window.addEventListener(event, stop, { passive: true });
}

/** A rider moving the list themselves; the aim is theirs from then on. */
const TAKEOVER = ["wheel", "touchstart", "keydown"] as const;
