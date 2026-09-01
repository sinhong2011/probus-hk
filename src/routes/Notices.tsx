import { format, formatDistanceToNowStrict } from "date-fns";
import { enUS, zhHK } from "date-fns/locale";
import { For, Show, createMemo } from "solid-js";
import { EmptyState, ScreenTitle } from "~/components/Chrome";
import { Page, Section } from "~/components/Layout";
import { RefreshIcon } from "~/components/Icons";
import { createWide } from "~/lib/wide";
import { routesMentioned, type Notice } from "~/data/notices";
import { useNotices } from "~/data/useNotices";
import { pick, t, type Lang } from "~/lib/i18n";
import { now } from "~/stores/clock";
import { settings } from "~/stores/settings";

/**
 * The feed's own geometry, in one place so the rule, the dots and the text
 * column cannot drift apart: the time column is 3.75rem wide, the rule runs
 * down its right edge, and the text starts a gap beyond it.
 */
const RULE = "left-[3.75rem]";
/*
 * Time, then the notice. On a wide window the third track is empty on
 * purpose: it caps the prose at a readable measure - a paragraph of the
 * department's own wording set 1,300px wide is one the eye loses its place
 * in - without pinning the feed to a centred column. Everything a notice
 * says, the route chips included, stays inside the prose track where it
 * reads as one statement.
 */
const COLUMNS =
  "grid-cols-[3.75rem_minmax(0,1fr)] xl:grid-cols-[3.75rem_minmax(0,58rem)_minmax(0,1fr)]";

/**
 * Service disruptions, straight from the Transport Department's feed.
 *
 * Nothing here is summarised or reworded: a diversion notice is the kind of
 * thing where a paraphrase can mislead, so the department's own wording is
 * shown, with only the first line pulled out as a heading.
 */
export default function Notices() {
  const lang = settings.lang;
  const { notices, reload } = useNotices();
  const wide = createWide();

  /** The newest timestamp in the batch: how current the whole screen is. */
  const publishedAt = createMemo(() => {
    const times = notices()
      .list.map((n) => n.at?.getTime())
      .filter((v): v is number => typeof v === "number");
    return times.length > 0 ? new Date(Math.max(...times)) : null;
  });

  /*
   * How many, and how current, as one line - "4 則通告 · 更新於 23:39".
   *
   * The count used to be a chip of its own beside the time: a bare "4" in a
   * pill, which is a number with nothing to say what it counts, and it left
   * the header carrying two separate half-statements. Both halves answer the
   * same question - how much of this is there and is it fresh - so they are
   * one sentence, and the header is left with one line of status and one
   * control.
   */
  const status = createMemo(() => {
    const said: string[] = [];
    const count = notices().list.length;
    const at = publishedAt();
    if (count > 0) said.push(`${count} ${t("noticeCount", lang())}`);
    if (at) said.push(`${t("noticesUpdated", lang())} ${format(at, "HH:mm")}`);
    return said.join(" · ");
  });

  /*
   * Fetching the feed again. A phone gives it a circle at the end of the
   * status line, where there is room for an icon and not for a word; a wide
   * window has a header bar running the width of the screen, so it takes the
   * word too and sits at the far end of it - the bar used to leave that whole
   * end empty and huddle a naked icon against the timestamp.
   *
   * `reload` and not `refresh`: `refresh` is the settings row that sets how
   * often arrivals are polled, and in Chinese it reads 更新頻率 - "refresh
   * rate", which is what this button was announcing to anyone listening.
   */
  const again = () => (
    <button
      type="button"
      aria-label={t("reload", lang())}
      onClick={reload}
      class={[
        "app-press flex items-center justify-center rounded-full bg-secondary text-muted-foreground transition-colors duration-state hover:text-foreground",
        wide() ? "h-9 gap-1.5 pl-3 pr-3.5 text-[0.81rem] font-bold" : "size-9 shrink-0 self-center",
      ]}
    >
      <RefreshIcon size={wide() ? 14 : 15} />
      <Show when={wide()}>{t("reload", lang())}</Show>
    </button>
  );

  return (
    <Page>
      {/*
       * One title. The screen used to name itself twice - once as the heading
       * and again as a section label directly beneath it - which said nothing
       * the second time and pushed the first notice down a row.
       *
       * The heading says what the screen is; the line under it says how much
       * there is and how current it is, which is the first thing anyone
       * reading a disruption feed wants to know. That line used to hang loose
       * above the first notice, aligned with nothing - as a subtitle it is
       * part of the title block every other screen has.
       */}
      <ScreenTitle
        title={t("notices", lang())}
        subtitle={status() || undefined}
        /* One slot at every width now that the band is one row - the button
           keeps the far end, and only its shape follows the room it has. */
        controls={again()}
      />

      <Show
        when={notices().ok}
        fallback={
          <EmptyState
            title={t("noticesFailed", lang())}
            action={
              <button
                type="button"
                onClick={reload}
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
      class={[`relative grid ${COLUMNS} motion-safe:app-rise`, props.first ? "pb-4" : "py-4"]}
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

        {/* The routes a notice names, right under its prose at every width.
            These chips are part of what the notice says; a column of their
            own on a wide window set them a thousand pixels adrift of the only
            notice they belonged to, floating in space nothing else used. */}
        <Show when={routes().length > 0}>
          <div class="flex flex-wrap items-start gap-1.5 pt-0.5">
            <span class="text-[0.75rem] font-semibold leading-5 text-faint-foreground">
              {t("affectsRoutes", props.lang)}
            </span>
            <For each={routes()}>
              {(route) => (
                <span class="rounded-md bg-secondary px-1.5 py-0.5 text-[0.75rem] font-bold leading-4 text-muted-foreground">
                  {route}
                </span>
              )}
            </For>
          </div>
        </Show>

        <Show when={ago()}>
          <span class="text-[0.75rem] font-medium text-faint-foreground">{ago()}</span>
        </Show>
      </div>
    </article>
  );
}
