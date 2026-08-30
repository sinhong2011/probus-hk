import { useLinkProps } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { SearchIcon } from "~/components/Icons";
import { Page } from "~/components/Layout";
import { t, type MessageKey } from "~/lib/i18n";
import { settings } from "~/stores/settings";

/** What was asked for and is not there: a whole page, or one thing on one. */
type Missing = "page" | "route" | "stop" | "line";

const TITLE: Record<Missing, MessageKey> = {
  page: "notFoundTitle",
  route: "notFoundRoute",
  stop: "notFoundStop",
  line: "notFoundLine",
};

/**
 * The screen for an address that names nothing.
 *
 * Says so in one line, guesses why in another, and offers the two ways out a
 * rider actually takes: back to the screen the app opens on, or to search for
 * what they were after by name. The same words serve a route, a stop or a
 * line that does not exist, drawn inside the page that would have shown it,
 * so the trail above still says where they came from.
 */
export function NotFound(props: { kind?: Missing }) {
  const lang = () => settings.lang();
  const kind = () => props.kind ?? "page";

  const body = (
    <div class="flex w-full max-w-sm flex-col items-center text-center lg:max-w-md">
      <div class="flex size-14 items-center justify-center rounded-2xl bg-secondary text-subtle-foreground lg:size-16">
        <SearchIcon size={24} />
      </div>

      <span class="mt-4 text-[1rem] font-bold text-foreground lg:text-[1.13rem]">
        {t(TITLE[kind()], lang())}
      </span>
      <span class="mt-1.5 text-[0.88rem] font-medium leading-relaxed text-subtle-foreground">
        {t("notFoundHint", lang())}
      </span>

      <div class="mt-6 flex items-center gap-2">
        <a
          {...useLinkProps({ to: "/" })}
          class="mb-press flex h-10 items-center rounded-xl bg-primary px-5 text-[0.88rem] font-bold text-primary-foreground"
        >
          {t("goHome", lang())}
        </a>
        <a
          {...useLinkProps({ to: "/search" })}
          class="mb-press flex h-10 items-center gap-2 rounded-xl bg-secondary px-4 text-[0.88rem] font-bold text-foreground"
        >
          <SearchIcon size={14} />
          {t("search", lang())}
        </a>
      </div>
    </div>
  );

  return (
    <Show
      when={kind() === "page"}
      fallback={<div class="flex flex-col items-center py-16">{body}</div>}
    >
      <Page>
        <div class="flex min-h-[60dvh] flex-col items-center justify-center">{body}</div>
      </Page>
    </Show>
  );
}
