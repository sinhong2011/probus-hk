/**
 * The app's one tooltip, spoken by whatever labelled control the mouse is on.
 *
 * Every icon-only control already tells a screen reader its name through
 * `aria-label`; this layer tells the same name to a mouse. It is a single
 * document-level listener rather than a wrapper around ninety buttons, so a
 * control earns its tooltip by being labelled: the accessible name and the
 * hover name can never drift apart, and a button added next month is covered
 * the day it lands.
 *
 * Hover only ever means a mouse. A finger produces no hover worth waiting
 * for - a touch tooltip is a thing no one ever sees - so touch and pen
 * pointers are ignored per event instead of sniffing the device once, which
 * keeps a convertible honest when the mouse comes out. A keyboard traveller
 * gets the same name on `:focus-visible`.
 */

/** Labelled things a pointer can rest on. */
const SELECTOR = 'button[aria-label], a[aria-label], [role="button"][aria-label]';

/** How long a mouse must settle on a control before it is named. */
const SETTLE_MS = 500;

/** After one tooltip hides, the next within this window opens at once - a
    reader working along a toolbar should not pay the settle price per icon. */
const WARM_MS = 450;

export function installTooltips() {
  if (typeof document === "undefined" || document.getElementById("app-tip")) return;

  // Repeats what the control already says accessibly, so it is noise to a
  // screen reader; positioned by `place`, animated by `.app-tip` in app.css.
  const tip = document.createElement("div");
  tip.id = "app-tip";
  tip.className = "app-tip";
  tip.setAttribute("aria-hidden", "true");
  document.body.appendChild(tip);

  let anchor: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = false;
  let hiddenAt = -Infinity;

  /** The label worth showing: what the control tells a screen reader that it
      does not already show on screen. A chip whose text *is* its name gets
      nothing - a tooltip that repeats the button it points at is noise. */
  const labelFor = (el: HTMLElement): string | null => {
    const label = el.getAttribute("aria-label")?.trim();
    if (!label || label === el.innerText.trim()) return null;
    return label;
  };

  const place = (el: HTMLElement) => {
    const target = el.getBoundingClientRect();
    const self = tip.getBoundingClientRect();
    // Above the control, out from under the cursor; below only when the
    // control is already against the top of the window.
    const above = target.top - self.height - 7;
    tip.dataset.side = above >= 6 ? "top" : "bottom";
    const top = above >= 6 ? above : target.bottom + 7;
    const left = Math.min(
      Math.max(8, target.left + target.width / 2 - self.width / 2),
      window.innerWidth - self.width - 8,
    );
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  };

  const reveal = () => {
    if (!anchor) return;
    const label = labelFor(anchor);
    if (!label) return;
    tip.textContent = label;
    place(anchor);
    tip.dataset.show = "";
    shown = true;
  };

  const hide = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    anchor = null;
    if (!shown) return;
    shown = false;
    hiddenAt = performance.now();
    delete tip.dataset.show;
  };

  /** A control is under the pointer (or keyboard); name it after the settle,
      or at once while a tooltip is up or only just went down. */
  const aim = (el: HTMLElement, settle: boolean) => {
    if (el === anchor) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    anchor = el;
    if (!settle || shown || performance.now() - hiddenAt < WARM_MS) reveal();
    else timer = setTimeout(reveal, SETTLE_MS);
  };

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse") return;
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>(SELECTOR) : null;
    if (el && labelFor(el)) aim(el, true);
    else hide();
  });

  // Leaving the anchor for nowhere - the window's edge, browser chrome -
  // never fires a pointerover to catch it, so the exit hides too.
  document.addEventListener("pointerout", (event) => {
    if (!anchor) return;
    const to = event.relatedTarget;
    if (!(to instanceof Node && anchor.contains(to))) hide();
  });

  document.addEventListener("focusin", (event) => {
    const el = event.target;
    if (
      el instanceof HTMLElement &&
      el.matches(SELECTOR) &&
      el.matches(":focus-visible") &&
      labelFor(el)
    )
      aim(el, false);
  });
  document.addEventListener("focusout", (event) => {
    if (event.target === anchor) hide();
  });

  // Pressing answers the question the tooltip was holding open - and often
  // flips the label ("star" becomes "starred"), which would leave
  // a stale name floating. `click` as well as `pointerdown`, for the keyboard.
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("click", hide, true);
  document.addEventListener("scroll", hide, { capture: true, passive: true });
  window.addEventListener("blur", hide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
}
