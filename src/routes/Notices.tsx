import { For, Show, createSignal } from "solid-js";
import { Card, EmptyState, ScreenTitle, SectionLabel } from "~/components/Chrome";
import { CardColumns, CardColumnItem, Page, Section } from "~/components/Layout";
import { RefreshIcon } from "~/components/Icons";
import { fetchNotices, routesMentioned, type Notice } from "~/data/notices";
import { createAsyncMemo } from "~/lib/async";
import { pick, t } from "~/lib/i18n";
import { settings } from "~/stores/settings";

/**
 * Service disruptions, straight from the Transport Department's feed.
 *
 * Nothing here is summarised or reworded: a diversion notice is the kind of
 * thing where a paraphrase can mislead, so the department's own wording is
 * shown, with only the first line pulled out as a heading.
 */
export default function Notices() {
  const lang = settings.lang;
  const [reloads, setReloads] = createSignal(0);

  const notices = createAsyncMemo<{ ok: boolean; list: Notice[] }>(async () => {
    reloads();
    try {
      return { ok: true, list: await fetchNotices() };
    } catch {
      return { ok: false, list: [] };
    }
  });

  return (
    <Page wide>
      <ScreenTitle
          title={t("notices", lang())}
          subtitle="Notices"
          trailing={
            <button
              type="button"
              aria-label="refresh"
              onClick={() => setReloads((n) => n + 1)}
              class="flex size-9 items-center justify-center rounded-full bg-secondary text-muted-foreground"
            >
              <RefreshIcon size={16} />
            </button>
          }
        />

      <Show
        when={notices().ok}
        fallback={
          <EmptyState
            title={t("noticesFailed", lang())}
            action={
              <button
                type="button"
                onClick={() => setReloads((n) => n + 1)}
                class="rounded-lg bg-primary px-4 py-2 text-[0.75rem] font-bold text-primary-foreground"
              >
                {t("retry", lang())}
              </button>
            }
          />
        }
      >
        <Show
          when={notices().list.length > 0}
          fallback={
            <EmptyState title={t("noNotices", lang())} hint={t("noNoticesHint", lang())} />
          }
        >
          <Section class="gap-3">
            <SectionLabel
              trailing={
                <span class="tnum text-[0.63rem] font-semibold text-faint-foreground">
                  {notices().list.length}
                </span>
              }
            >
              {`${t("notices", lang())} Service notices`}
            </SectionLabel>

            <CardColumns>
            <For each={notices().list}>
              {(notice) => {
                const routes = routesMentioned(notice);
                return (
                  <CardColumnItem>
                  <Card class="p-4 motion-safe:mb-rise">
                    <div class="flex flex-col gap-2">
                      <span class="text-[0.85rem] font-bold leading-snug tracking-[-0.01em] text-foreground">
                        {pick(notice.heading, lang())}
                      </span>

                      {/* Kept as the department wrote it, newlines and all.
                          A one-line notice is entirely its heading, so there is
                          nothing more to print. */}
                      <Show when={pick(notice.detail, lang())}>
                        <p
                          class="text-[0.72rem] font-medium leading-relaxed text-muted-foreground"
                          style={{ "white-space": "pre-line" }}
                        >
                          {pick(notice.detail, lang())}
                        </p>
                      </Show>

                      <Show when={routes.length > 0}>
                        <div class="flex flex-wrap items-center gap-1.5 pt-1">
                          <span class="text-[0.6rem] font-semibold text-faint-foreground">
                            {t("affectsRoutes", lang())}
                          </span>
                          <For each={routes}>
                            {(route) => (
                              <span class="rounded-md bg-secondary px-1.5 py-0.5 text-[0.63rem] font-bold text-muted-foreground">
                                {route}
                              </span>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </Card>
                  </CardColumnItem>
                );
              }}
            </For>
            </CardColumns>

            <p class="pt-2 text-center text-[0.6rem] font-medium text-faint-foreground">
              {t("noticesSource", lang())}
            </p>
          </Section>
        </Show>
      </Show>
    </Page>
  );
}
