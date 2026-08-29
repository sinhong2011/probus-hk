import { format, formatDistanceToNowStrict } from "date-fns";
import { enUS, zhHK } from "date-fns/locale";
import { For, Show, createMemo, createSignal } from "solid-js";
import { Chip, EmptyState, ScreenTitle } from "~/components/Chrome";
import { Page, Section } from "~/components/Layout";
import { RefreshIcon } from "~/components/Icons";
import { fetchNotices, routesMentioned, type Notice } from "~/data/notices";
import { createAsyncMemo } from "~/lib/async";
import { pick, t, type Lang } from "~/lib/i18n";
import { now } from "~/stores/clock";
import { settings } from "~/stores/settings";

/**
 * The feed's own geometry, in one place so the rule, the dots and the text
 * column cannot drift apart: the time column is `TIME` wide, the rule runs down
 * its right edge, and the text starts a gap beyond it.
 */
const TIME = "3.75rem";
const RULE = "left-[3.75rem]";

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

  /** The newest timestamp in the batch: how current the whole screen is. */
  const publishedAt = createMemo(() => {
    const times = notices()
      .list.map((n) => n.at?.getTime())
      .filter((v): v is number => typeof v === "number");
    return times.length > 0 ? new Date(Math.max(...times)) : null;
  });

  return (
    <Page>
      {/*
       * One title. The screen used to name itself twice - once as the heading
       * and again as a section label directly beneath it - which said nothing
       * the second time and pushed the first notice down a row.
       */}
      {/*
       * The heading says what the screen is; the line under it says how current
       * it is, which is the first thing anyone reading a disruption feed wants
       * to know. That line used to hang loose above the first notice, aligned
       * with nothing - as a subtitle it is part of the title block every other
       * screen has.
       */}
      <ScreenTitle
        title={t("notices", lang())}
        subtitle={
          publishedAt()
            ? `${t("noticesUpdated", lang())} ${format(publishedAt() as Date, "HH:mm")}`
            : undefined
        }
        trailing={
          <div class="flex items-center gap-2">
            <Show when={notices().list.length > 0}>
              <Chip class="shrink-0">
                <span class="tnum">{notices().list.length}</span>
              </Chip>
            </Show>
            <button
              type="button"
              aria-label={t("refresh", lang())}
              onClick={() => setReloads((n) => n + 1)}
              class="mb-press flex size-8 items-center justify-center rounded-full bg-secondary text-muted-foreground"
            >
              <RefreshIcon size={15} />
            </button>
          </div>
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
                class="rounded-lg bg-primary px-4 py-2 text-[0.88rem] font-bold text-primary-foreground"
              >
                {t("retry", lang())}
              </button>
            }
          />
        }
      >
        <Show
          when={notices().list.length > 0}
          fallback={<EmptyState title={t("noNotices", lang())} hint={t("noNoticesHint", lang())} />}
        >
          <Section class="gap-3">
            {/*
             * A wire, not a noticeboard.
             *
             * These arrive as one feed in one order, and cards packed into
             * columns broke that: the eye had to choose a column, and "what
             * came in last" - the only question this screen answers - was
             * split across two of them. One line runs the length of the feed
             * and every notice hangs off it at its own time.
             */}
            <div class="relative">
              <span aria-hidden="true" class={`absolute inset-y-0 ${RULE} w-px bg-border`} />
              <For each={notices().list}>
                {(notice, index) => (
                  <NoticeRow notice={notice} lang={lang()} first={index() === 0} />
                )}
              </For>
            </div>

            <p class="pt-2 text-center text-[0.75rem] font-medium text-faint-foreground">
              {t("noticesSource", lang())}
            </p>
          </Section>
        </Show>
      </Show>
    </Page>
  );
}

/**
 * One notice on the wire: when it was said, then what was said.
 *
 * No card around it. Forty boxed notices are forty frames the reader has to
 * look past, and the frame was carrying nothing the hairline between two
 * notices does not carry for a hairline's worth of ink.
 */
function NoticeRow(props: { notice: Notice; lang: Lang; first: boolean }) {
  const routes = createMemo(() => routesMentioned(props.notice));
  const locale = () => (props.lang === "zh" ? zhHK : enUS);

  /*
   * Recomputed once a minute rather than once a second: "12 分鐘前" is the same
   * string for sixty ticks, and rewriting it every one of them churns the DOM
   * of every notice on the screen for no visible change.
   */
  const minute = createMemo(() => Math.floor(now() / 60_000));

  const ago = createMemo(() => {
    const at = props.notice.at;
    if (!at) return null;
    minute();
    return formatDistanceToNowStrict(at, { addSuffix: true, locale: locale() });
  });

  return (
    <article
      /*
       * No rule between notices. The wire already runs the length of the feed
       * and each notice is beaded onto it at its own time, so a hairline across
       * every row was a second answer to a question the line had answered -
       * and it cut the line in half on its way across.
       */
      class={["relative grid motion-safe:mb-rise", props.first ? "pb-4" : "py-4"]}
      style={{ "grid-template-columns": `${TIME} minmax(0, 1fr)` }}
    >
      {/*
       * When it was said, in the margin. A notice with no time on it cannot be
       * judged: a lane that reopened is only news if the reopening is recent,
       * and the feed has carried the timestamp all along.
       */}
      <div class="flex flex-col items-end gap-0.5 pr-3">
        <Show when={props.notice.at} fallback={<span class="text-subtle-foreground">·</span>}>
          {(at) => (
            <>
              <span class="tnum text-[0.81rem] font-bold leading-none text-muted-foreground">
                {format(at(), "HH:mm")}
              </span>
              <span class="tnum text-[0.69rem] font-semibold leading-none text-faint-foreground">
                {format(at(), "MM-dd")}
              </span>
            </>
          )}
        </Show>
      </div>

      {/* The bead on the wire, level with the first line of the heading. */}
      <span
        aria-hidden="true"
        class={[
          `absolute ${RULE} -ml-[3px] size-[7px] rounded-full border-2 border-background bg-subtle-foreground`,
          props.first ? "top-[0.3rem]" : "top-[1.3rem]",
        ]}
      />

      <div class="flex min-w-0 flex-col gap-1.5 pl-4">
        <span class="text-[0.94rem] font-bold leading-snug tracking-[-0.01em] text-foreground">
          {pick(props.notice.heading, props.lang)}
        </span>

        {/* Where, when the register says so. The announcements desk leaves this
            to its prose, so most notices have nothing to put here. */}
        <Show when={props.notice.location && pick(props.notice.location, props.lang)}>
          {(where) => (
            <span class="text-[0.81rem] font-semibold text-subtle-foreground">{where()}</span>
          )}
        </Show>

        {/* Kept as the department wrote it, newlines and all. A one-line
            notice is entirely its heading, so there is nothing more to
            print. */}
        <Show when={pick(props.notice.detail, props.lang)}>
          <p
            class="text-[0.81rem] font-medium leading-relaxed text-muted-foreground"
            style={{ "white-space": "pre-line" }}
          >
            {pick(props.notice.detail, props.lang)}
          </p>
        </Show>

        <Show when={ago()}>
          <span class="text-[0.75rem] font-medium text-faint-foreground">{ago()}</span>
        </Show>

        <Show when={routes().length > 0}>
          <div class="flex flex-wrap items-center gap-1.5 pt-1">
            <span class="text-[0.75rem] font-semibold text-faint-foreground">
              {t("affectsRoutes", props.lang)}
            </span>
            <For each={routes()}>
              {(route) => (
                <span class="rounded-md bg-secondary px-1.5 py-0.5 text-[0.75rem] font-bold text-muted-foreground">
                  {route}
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>
    </article>
  );
}
