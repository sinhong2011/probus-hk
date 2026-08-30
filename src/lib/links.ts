import { linkOptions } from "@tanstack/solid-router";

/**
 * The four screens you can only reach by naming something.
 *
 * A route key, a stop id and a line code all arrive from the database with
 * characters a URL will not take literally - `+` between a route and its
 * direction, the odd slash in a stop id. The router encodes a `params` value on
 * the way out and decodes it on the way back in, so these are the one place
 * that has to know the shape of each path, and no screen has to remember to
 * call `encodeURIComponent` before building an href or after reading one.
 *
 * `linkOptions` is a no-op at runtime; it is here so a wrong path or a missing
 * param is a type error at the call site rather than a dead link in the app.
 */

/** A route, optionally scrolled to one stop along it. */
export const routeLink = (key: string, stop?: number) =>
  stop === undefined
    ? linkOptions({ to: "/route/$key", params: { key } })
    : linkOptions({ to: "/route/$key", params: { key }, search: { stop } });

/** Everything calling at one stop. */
export const stopLink = (id: string) => linkOptions({ to: "/stop/$id", params: { id } });

/** One railway line, end to end. */
export const railLink = (code: string) => linkOptions({ to: "/rail/$code", params: { code } });

/** The routes filed under one category. */
export const browseLink = (id: string) => linkOptions({ to: "/browse/$id", params: { id } });

/**
 * A link to a path the app worked out at runtime.
 *
 * The breadcrumb trail is built from pathnames the rider has actually been to,
 * so there is no string literal for the type checker to match against a route.
 * The cast lives here, once, rather than at the call site: the paths come back
 * out of the router itself, so they were real when they went in.
 */
export const pathLink = (path: string) => linkOptions({ to: path as "/" });
