import {
  detectPlatform,
  getHotkeyManager,
  getKeyStateTracker,
  normalizeRegisterableHotkey,
  type HotkeyCallback,
  type HotkeyOptions,
  type HotkeyRegistrationHandle,
  type RegisterableHotkey,
} from "@tanstack/hotkeys";
import { createEffect, createMemo, onCleanup, type Accessor } from "solid-js";
import { createStoreSignal } from "./store";

export * from "@tanstack/hotkeys";

/*
 * TanStack Hotkeys keeps one keyboard listener and a registry behind it; a
 * binding only has to register on the way in and unregister on the way out,
 * and keep the registration current when the key or its options change.
 * Solid 2's split effect is the right shape for that: the compute phase
 * resolves what to register, the effect phase does the registering.
 */

type MaybeAccessor<T> = T | (() => T);
const resolve = <T>(value: MaybeAccessor<T>): T =>
  typeof value === "function" ? (value as () => T)() : value;

/** Where a hotkey listens: the whole document, one element, or the window. */
export type HotkeyTarget = Document | HTMLElement | Window;

/** Registration options plus where to listen; `document` when unsaid. */
export type CreateHotkeyOptions = HotkeyOptions & {
  target?: HotkeyTarget | null;
};

interface Prepared {
  hotkey: RegisterableHotkey;
  target: HotkeyTarget | null;
  options: HotkeyOptions;
}

function prepare(hotkey: RegisterableHotkey, options: CreateHotkeyOptions): Prepared {
  const { target, ...rest } = options;
  return {
    hotkey: normalizeRegisterableHotkey(
      hotkey,
      rest.platform ?? detectPlatform(),
    ) as RegisterableHotkey,
    target:
      "target" in options ? (target ?? null) : typeof document !== "undefined" ? document : null,
    options: rest,
  };
}

/**
 * One key combination, bound while the owner lives.
 *
 * The callback is read fresh on every keypress, so it may close over signals
 * without going stale; the registration itself is only redone when the key
 * or the target changes - a toggle of `enabled` updates it in place.
 *
 * ```ts
 * createHotkey("Mod+K", () => focusSearch());
 * createHotkey(() => keyFor(tab()), () => go(tab()), { enabled: true });
 * ```
 */
export function createHotkey(
  hotkey: MaybeAccessor<RegisterableHotkey>,
  callback: HotkeyCallback,
  options: MaybeAccessor<CreateHotkeyOptions> = {},
): void {
  const manager = getHotkeyManager();
  let handle: HotkeyRegistrationHandle | null = null;
  let bound: { hotkey: RegisterableHotkey; target: HotkeyTarget } | null = null;

  const release = () => {
    if (handle?.isActive) handle.unregister();
    handle = null;
    bound = null;
  };

  createEffect(
    () => prepare(resolve(hotkey), resolve(options)),
    (next) => {
      if (!next.target) {
        release();
        return;
      }
      if (handle?.isActive && bound?.hotkey === next.hotkey && bound.target === next.target) {
        handle.callback = callback;
        handle.setOptions(next.options);
        return;
      }
      release();
      handle = manager.register(next.hotkey, callback, { ...next.options, target: next.target });
      bound = { hotkey: next.hotkey, target: next.target };
    },
  );

  onCleanup(release);
}

export interface HotkeyDefinition {
  hotkey: RegisterableHotkey;
  callback: HotkeyCallback;
  options?: CreateHotkeyOptions;
}

/**
 * A set of hotkeys that changes together - a screen's shortcuts, say.
 *
 * Each entry is keyed by its position and key, so reordering the list is a
 * re-registration and editing one entry touches only that entry.
 */
export function createHotkeys(
  hotkeys: MaybeAccessor<HotkeyDefinition[]>,
  common: MaybeAccessor<CreateHotkeyOptions> = {},
): void {
  const manager = getHotkeyManager();
  const registrations = new Map<
    string,
    { handle: HotkeyRegistrationHandle; target: HotkeyTarget }
  >();

  const releaseAll = () => {
    for (const { handle } of registrations.values()) if (handle.isActive) handle.unregister();
    registrations.clear();
  };

  createEffect(
    () => {
      const shared = resolve(common);
      return resolve(hotkeys).map((def, index) => {
        const prepared = prepare(def.hotkey, { ...shared, ...def.options });
        return { key: `${index}:${prepared.hotkey}`, def, ...prepared };
      });
    },
    (next) => {
      const keep = new Set(next.map((entry) => entry.key));
      for (const [key, record] of registrations) {
        if (keep.has(key)) continue;
        if (record.handle.isActive) record.handle.unregister();
        registrations.delete(key);
      }
      for (const entry of next) {
        if (!entry.target) continue;
        const existing = registrations.get(entry.key);
        if (existing?.handle.isActive && existing.target === entry.target) {
          existing.handle.callback = entry.def.callback;
          existing.handle.setOptions(entry.options);
          continue;
        }
        if (existing?.handle.isActive) existing.handle.unregister();
        registrations.set(entry.key, {
          handle: manager.register(entry.hotkey, entry.def.callback, {
            ...entry.options,
            target: entry.target,
          }),
          target: entry.target,
        });
      }
    },
  );

  onCleanup(releaseAll);
}

/** Every key held down right now, as the tracker names them. */
export function createHeldKeys(): Accessor<string[]> {
  return createStoreSignal(getKeyStateTracker().store, (state) => state.heldKeys);
}

/** Whether one particular key is held down right now. */
export function createKeyHold(key: MaybeAccessor<string>): Accessor<boolean> {
  const held = createHeldKeys();
  return createMemo(() => {
    const wanted = resolve(key).toLowerCase();
    return held().some((k) => k.toLowerCase() === wanted);
  });
}
