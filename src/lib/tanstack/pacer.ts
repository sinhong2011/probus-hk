import {
  AsyncBatcher,
  AsyncDebouncer,
  AsyncQueuer,
  AsyncRateLimiter,
  AsyncThrottler,
  Batcher,
  Debouncer,
  Queuer,
  RateLimiter,
  Throttler,
  type AnyAsyncFunction,
  type AnyFunction,
  type AsyncBatcherOptions,
  type AsyncBatcherState,
  type AsyncDebouncerOptions,
  type AsyncDebouncerState,
  type AsyncQueuerOptions,
  type AsyncQueuerState,
  type AsyncRateLimiterOptions,
  type AsyncRateLimiterState,
  type AsyncThrottlerOptions,
  type AsyncThrottlerState,
  type BatcherOptions,
  type BatcherState,
  type DebouncerOptions,
  type DebouncerState,
  type QueuerOptions,
  type QueuerState,
  type RateLimiterOptions,
  type RateLimiterState,
  type ThrottlerOptions,
  type ThrottlerState,
} from "@tanstack/pacer";
import type { Store } from "@tanstack/store";
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { createStoreSignal } from "./store";

export * from "@tanstack/pacer";

/*
 * TanStack Pacer is a set of plain classes - a debouncer, a throttler, a
 * queue with a concurrency limit - each keeping its state in a TanStack
 * Store. Binding one to Solid is the same three moves every time: build it,
 * read its store as a signal, and put it away when the owner is disposed.
 * The official Solid adapter does this for Solid 1; this is the same for
 * Solid 2, where `createEffect` needs a compute function and `onCleanup`
 * registers directly under the owner.
 */

/** An instance with its selected state readable as a signal. */
export type Paced<TInstance, TState, TSelected> = TInstance & {
  /** The slice of state the selector chose, tracked. */
  state: Accessor<TSelected>;
  /** What was selected is a snapshot; this is the whole store, for the rest. */
  store: Store<Readonly<TState>>;
};

interface Unmountable<TInstance> {
  /** What to do with pending work when the owner goes away. */
  onUnmount?: (instance: TInstance) => void;
}

function bind<TInstance extends { store: Store<Readonly<TState>> }, TState, TSelected>(
  instance: TInstance,
  options: Unmountable<TInstance>,
  selector: (state: TState) => TSelected,
  putAway: (instance: TInstance) => void,
): Paced<TInstance, TState, TSelected> {
  const state = createStoreSignal(instance.store, selector);
  onCleanup(() => (options.onUnmount ? options.onUnmount(instance) : putAway(instance)));
  return Object.assign(instance, { state });
}

/** Nothing selected by default: state is opt-in, so an idle instance costs no re-renders. */
const nothing = () => ({});

/**
 * Wait for the calls to stop, then make one.
 *
 * Pending work is cancelled on unmount; pass `onUnmount: (d) => d.flush()` to
 * make it instead.
 */
export function createDebouncer<TFn extends AnyFunction, TSelected = {}>(
  fn: TFn,
  options: DebouncerOptions<TFn> & Unmountable<Debouncer<TFn>>,
  selector: (state: DebouncerState<TFn>) => TSelected = nothing as never,
) {
  return bind(new Debouncer(fn, options), options, selector, (d) => d.cancel());
}

export function createAsyncDebouncer<TFn extends AnyAsyncFunction, TSelected = {}>(
  fn: TFn,
  options: AsyncDebouncerOptions<TFn> & Unmountable<AsyncDebouncer<TFn>>,
  selector: (state: AsyncDebouncerState<TFn>) => TSelected = nothing as never,
) {
  return bind(new AsyncDebouncer(fn, options), options, selector, (d) => {
    d.cancel();
    d.abort();
  });
}

/** Make the call at most once per window, with the latest arguments. */
export function createThrottler<TFn extends AnyFunction, TSelected = {}>(
  fn: TFn,
  options: ThrottlerOptions<TFn> & Unmountable<Throttler<TFn>>,
  selector: (state: ThrottlerState<TFn>) => TSelected = nothing as never,
) {
  return bind(new Throttler(fn, options), options, selector, (t) => t.cancel());
}

export function createAsyncThrottler<TFn extends AnyAsyncFunction, TSelected = {}>(
  fn: TFn,
  options: AsyncThrottlerOptions<TFn> & Unmountable<AsyncThrottler<TFn>>,
  selector: (state: AsyncThrottlerState<TFn>) => TSelected = nothing as never,
) {
  return bind(new AsyncThrottler(fn, options), options, selector, (t) => {
    t.cancel();
    t.abort();
  });
}

/** Refuse calls past a quota per window. */
export function createRateLimiter<TFn extends AnyFunction, TSelected = {}>(
  fn: TFn,
  options: RateLimiterOptions<TFn> & Unmountable<RateLimiter<TFn>>,
  selector: (state: RateLimiterState) => TSelected = nothing as never,
) {
  return bind(new RateLimiter(fn, options), options, selector, (r) => r.reset());
}

export function createAsyncRateLimiter<TFn extends AnyAsyncFunction, TSelected = {}>(
  fn: TFn,
  options: AsyncRateLimiterOptions<TFn> & Unmountable<AsyncRateLimiter<TFn>>,
  selector: (state: AsyncRateLimiterState<TFn>) => TSelected = nothing as never,
) {
  return bind(new AsyncRateLimiter(fn, options), options, selector, (r) => r.reset());
}

/** Collect items and hand them over together. */
export function createBatcher<TValue, TSelected = {}>(
  fn: (items: TValue[]) => void,
  options: BatcherOptions<TValue> & Unmountable<Batcher<TValue>>,
  selector: (state: BatcherState<TValue>) => TSelected = nothing as never,
) {
  return bind(new Batcher(fn, options), options, selector, (b) => b.cancel());
}

export function createAsyncBatcher<TValue, TSelected = {}>(
  fn: (items: TValue[]) => Promise<unknown>,
  options: AsyncBatcherOptions<TValue> & Unmountable<AsyncBatcher<TValue>>,
  selector: (state: AsyncBatcherState<TValue>) => TSelected = nothing as never,
) {
  return bind(new AsyncBatcher(fn, options), options, selector, (b) => {
    b.cancel();
    b.abort();
  });
}

/** Process items one after another, in order or by priority. */
export function createQueuer<TValue, TSelected = {}>(
  fn: (item: TValue) => void,
  options: QueuerOptions<TValue> & Unmountable<Queuer<TValue>> = {},
  selector: (state: QueuerState<TValue>) => TSelected = nothing as never,
) {
  return bind(new Queuer(fn, options), options, selector, (q) => q.stop());
}

/**
 * Process items with a cap on how many run at once.
 *
 * This is the one the app has a use for: every row on screen asks an operator
 * for arrivals at the same moment, and a phone on a bad connection does
 * better sending six requests and then six more than forty in a burst.
 */
export function createAsyncQueuer<TValue, TSelected = {}>(
  fn: (item: TValue) => Promise<unknown>,
  options: AsyncQueuerOptions<TValue> & Unmountable<AsyncQueuer<TValue>> = {},
  selector: (state: AsyncQueuerState<TValue>) => TSelected = nothing as never,
) {
  return bind(new AsyncQueuer(fn, options), options, selector, (q) => {
    q.stop();
    q.abort();
  });
}

/* ---- signals and values ------------------------------------------------ */

/**
 * A signal whose writes are debounced: `set` is called on every keystroke,
 * the signal moves once the keystrokes stop.
 */
export function createDebouncedSignal<T>(
  value: T,
  options: DebouncerOptions<(next: T) => void>,
): [Accessor<T>, (next: T) => void, Debouncer<(next: T) => void>] {
  const [read, write] = createSignal(value as Exclude<T, Function>, { ownedWrite: true });
  const debouncer = createDebouncer(
    (next: T) => write(() => next as Exclude<T, Function>),
    options,
  );
  return [read, (next) => debouncer.maybeExecute(next), debouncer];
}

/** A signal whose writes are throttled. */
export function createThrottledSignal<T>(
  value: T,
  options: ThrottlerOptions<(next: T) => void>,
): [Accessor<T>, (next: T) => void, Throttler<(next: T) => void>] {
  const [read, write] = createSignal(value as Exclude<T, Function>, { ownedWrite: true });
  const throttler = createThrottler(
    (next: T) => write(() => next as Exclude<T, Function>),
    options,
  );
  return [read, (next) => throttler.maybeExecute(next), throttler];
}

/** A reactive value, followed at a debounced distance. */
export function createDebouncedValue<T>(
  source: Accessor<T>,
  options: DebouncerOptions<(next: T) => void>,
): [Accessor<T>, Debouncer<(next: T) => void>] {
  const [value, set, debouncer] = createDebouncedSignal(source(), options);
  createEffect(source, (next) => {
    set(next);
  });
  return [value, debouncer];
}

/** A reactive value, followed at a throttled distance. */
export function createThrottledValue<T>(
  source: Accessor<T>,
  options: ThrottlerOptions<(next: T) => void>,
): [Accessor<T>, Throttler<(next: T) => void>] {
  const [value, set, throttler] = createThrottledSignal(source(), options);
  createEffect(source, (next) => {
    set(next);
  });
  return [value, throttler];
}
