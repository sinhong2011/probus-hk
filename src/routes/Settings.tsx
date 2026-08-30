import { format } from "date-fns";
import { enUS, zhHK } from "date-fns/locale";
import { For, Show, createMemo, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Card, Hairline, ScreenTitle, SectionLabel, Segmented, Toggle } from "~/components/Chrome";
import { AppMark } from "~/components/AppMark";
import { Page, Section } from "~/components/Layout";
import {
  DownloadCloudIcon,
  ExternalIcon,
  GithubIcon,
  RefreshIcon,
  ShareIcon,
  TrashIcon,
} from "~/components/Icons";
import { useDb, useDbMeta } from "~/data/context";
import { describeDb, refreshRouteDb } from "~/data/db";
import { clearEtaCache } from "~/data/eta";
import { APP_VERSION, BUILD_SHA, REPO_URL } from "~/lib/build";
import { t } from "~/lib/i18n";
import { notifyPermission, requestNotifyPermission, type NotifyPermission } from "~/lib/notify";
import { pointerOrigin, swapTheme } from "~/lib/themeSwap";
import {
  ALERT_LEAD_CHOICES,
  ALERT_RADIUS_CHOICES,
  REFRESH_CHOICES,
  RADIUS_CHOICES,
  settings,
} from "~/stores/settings";
import { alerts } from "~/stores/alerts";
import { toast } from "~/stores/toast";

function Row(props: { title: string; subtitle?: string; children: unknown }) {
  return (
    <div class="flex items-center gap-3 px-3.5 py-3">
      <div class="flex min-w-0 grow flex-col gap-0.5">
        <span class="text-[0.88rem] font-bold text-foreground">{props.title}</span>
        <Show when={props.subtitle}>
          <span class="text-[0.75rem] font-medium text-subtle-foreground">{props.subtitle}</span>
        </Show>
      </div>
      {props.children as never}
    </div>
  );
}

/**
 * Where a piece of the app comes from, as a row that opens the source itself.
 *
 * Every credit here is a live link rather than a printed domain: a rider who
 * wants to check what the app is reading should be one tap away from the
 * feed, not left to retype a hostname. The arrow says the row leaves the app -
 * a chevron would promise another screen of ours behind it.
 */
function LinkRow(props: { href: string; title: string; subtitle: string; icon?: JSX.Element }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      class="mb-tap flex items-center gap-3 px-3.5 py-3"
    >
      <Show when={props.icon}>
        <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          {props.icon}
        </span>
      </Show>
      <div class="flex min-w-0 grow flex-col gap-0.5">
        <span class="text-[0.88rem] font-bold text-foreground">{props.title}</span>
        <span class="truncate text-[0.75rem] font-medium text-subtle-foreground">
          {props.subtitle}
        </span>
      </div>
      <ExternalIcon size={15} class="text-faint-foreground" />
    </a>
  );
}

/**
 * Every feed the app reads, named and linked.
 *
 * The hosts are deliberately not translated - a domain is the same string in
 * both languages, and printing "資料來源" beside a hostname the rider can
 * verify is worth more than a second rendering of the same words.
 */
const CREDITS = [
  { key: "creditLive", href: "https://data.gov.hk/", host: "data.gov.hk · rt.data.gov.hk" },
  { key: "creditRoutes", href: "https://hkbus.app/", host: "data.hkbus.app" },
  {
    key: "creditNotices",
    href: "https://www.td.gov.hk/en/special_news/trafficnews.htm",
    host: "Transport Department",
  },
  {
    key: "creditMap",
    href: "https://www.openstreetmap.org/copyright",
    host: "CARTO · OpenStreetMap",
  },
  { key: "creditIcons", href: "https://lineicons.com/", host: "Lineicons" },
] as const;

export default function Settings() {
  const db = useDb();
  const meta = useDbMeta();
  const lang = settings.lang;
  const [busy, setBusy] = createSignal(false);
  /* Read at setup: the rider may have changed it in the browser itself. */
  const [permission, setPermission] = createSignal<NotifyPermission>(notifyPermission());

  const stats = createMemo(() => describeDb(db()));
  const locale = () => (lang() === "zh" ? zhHK : enUS);

  /*
   * The app itself, as a link. Someone standing at a stop showing a friend
   * what they are using is the way an app like this actually travels, and the
   * system sheet is the shortest path from that moment to the friend's phone.
   * Where there is no sheet - a desktop browser - the clipboard says so.
   */
  const shareApp = () => {
    const url = window.location.origin;
    if (navigator.share) {
      void navigator.share({ title: t("appName", lang()), url }).catch(() => undefined);
      return;
    }
    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast.show(t("linkCopied", lang()), url))
      .catch(() => undefined);
  };

  const update = async () => {
    setBusy(true);
    try {
      clearEtaCache();
      await refreshRouteDb();
      // The database is read once at start-up, so a reload is the honest way to
      // adopt a newer copy rather than leaving half the app on stale data.
      location.reload();
    } catch {
      setBusy(false);
    }
  };

  return (
    <Page>
      <ScreenTitle title={t("settings", lang())} />

      {/*
       * Settings are read down, then across. Six stacked cards left a desktop
       * window three-quarters empty and the last of them a scroll away; in
       * columns the whole panel is one screenful, and each block still reads
       * top to bottom the way the phone shows it.
       */}
      <div class="flex flex-col gap-6 lg:block lg:columns-2 lg:gap-8 min-[110rem]:columns-3">
        <Section class="gap-3 lg:mb-8 lg:break-inside-avoid">
          <SectionLabel>{t("display", lang())}</SectionLabel>
          <Card>
            <Row title={t("language", lang())}>
              <Segmented
                label="Language"
                value={lang()}
                onChange={(v) => settings.setLang(v)}
                options={[
                  { value: "zh" as const, label: "繁中" },
                  { value: "en" as const, label: "EN" },
                ]}
              />
            </Row>
            <Hairline />
            <Row title={t("theme", lang())}>
              <Segmented
                label="Theme"
                value={settings.theme()}
                onChange={(v, event) => swapTheme(v, pointerOrigin(event))}
                options={[
                  { value: "auto" as const, label: t("themeAuto", lang()) },
                  { value: "light" as const, label: t("themeLight", lang()) },
                  { value: "dark" as const, label: t("themeDark", lang()) },
                ]}
              />
            </Row>
          </Card>
        </Section>

        <Section class="gap-3 lg:mb-8 lg:break-inside-avoid">
          <SectionLabel>{t("liveEta", lang())}</SectionLabel>
          <Card>
            <Row title={t("refresh", lang())}>
              <Segmented
                label="Refresh interval"
                value={settings.refreshSeconds()}
                onChange={(v) => settings.setRefreshSeconds(v)}
                options={REFRESH_CHOICES.map((s) => ({ value: s, label: `${s}s` }))}
              />
            </Row>
            <Hairline />
            <Row title={t("radius", lang())}>
              <Segmented
                label="Search radius"
                value={settings.radiusM()}
                onChange={(v) => settings.setRadiusM(v)}
                options={RADIUS_CHOICES.map((r) => ({ value: r, label: `${r}m` }))}
              />
            </Row>
            <Hairline />
            <Row title={t("showScheduled", lang())}>
              <Toggle
                label={t("showScheduled", lang())}
                checked={settings.showScheduled()}
                onChange={(v) => settings.setShowScheduled(v)}
              />
            </Row>
          </Card>
        </Section>

        <Section class="gap-3 lg:mb-8 lg:break-inside-avoid">
          <SectionLabel
            trailing={
              <Show when={alerts.items().length > 0}>
                <span class="tnum text-[0.75rem] font-semibold text-faint-foreground">
                  {alerts.items().length}
                </span>
              </Show>
            }
          >
            {t("alerts", lang())}
          </SectionLabel>
          <Card>
            {/*
             * Whether a reminder can reach a pocket is the first thing to say:
             * everything under it is worthless if the answer is no.
             */}
            <Row title={t("alertPermission", lang())}>
              <Show
                when={permission() === "default"}
                fallback={
                  <span
                    class={[
                      "text-[0.81rem] font-bold",
                      {
                        "text-primary": permission() === "granted",
                        "text-subtle-foreground": permission() !== "granted",
                      },
                    ]}
                  >
                    {permission() === "granted"
                      ? t("alertEnabled", lang())
                      : permission() === "denied"
                        ? t("alertBlocked", lang())
                        : t("alertUnsupported", lang())}
                  </span>
                }
              >
                <button
                  type="button"
                  onClick={() => void requestNotifyPermission().then(setPermission)}
                  class="mb-press flex h-8 items-center rounded-full bg-primary px-3.5 text-[0.81rem] font-bold text-primary-foreground"
                >
                  {t("alertEnable", lang())}
                </button>
              </Show>
            </Row>
            <Hairline />
            <Row title={t("alertArrival", lang())} subtitle={t("alertLead", lang())}>
              <Segmented
                label={t("alertLead", lang())}
                value={settings.alertLeadMinutes()}
                onChange={(v) => settings.setAlertLeadMinutes(v)}
                options={ALERT_LEAD_CHOICES.map((m) => ({ value: m, label: `${m}` }))}
              />
            </Row>
            <Hairline />
            <Row title={t("alertDestination", lang())} subtitle={t("alertRadius", lang())}>
              <Segmented
                label={t("alertRadius", lang())}
                value={settings.alertRadiusM()}
                onChange={(v) => settings.setAlertRadiusM(v)}
                options={ALERT_RADIUS_CHOICES.map((m) => ({ value: m, label: `${m}m` }))}
              />
            </Row>
            <Hairline />
            {/* Either there are reminders to call off, or there is a sentence
              saying where they come from. Neither screen should be silent. */}
            <Show
              when={alerts.items().length > 0}
              fallback={
                <div class="flex flex-col gap-0.5 px-3.5 py-3">
                  <span class="text-[0.88rem] font-bold text-muted-foreground">
                    {t("noAlerts", lang())}
                  </span>
                  <span class="text-[0.75rem] font-medium leading-snug text-subtle-foreground">
                    {t("noAlertsHint", lang())}
                  </span>
                </div>
              }
            >
              <div class="flex items-center gap-3 px-3.5 py-3">
                <span class="tnum min-w-0 grow text-[0.81rem] font-medium text-subtle-foreground">
                  {alerts.items().length} {t("alerts", lang())}
                </span>
                <button
                  type="button"
                  onClick={() => alerts.clear()}
                  class="flex h-8 items-center rounded-full bg-secondary px-3.5 text-[0.81rem] font-bold text-destructive"
                >
                  {t("alertOff", lang())}
                </button>
              </div>
            </Show>
          </Card>
        </Section>

        <Section class="gap-3 lg:mb-8 lg:break-inside-avoid">
          <SectionLabel>{t("offlineData", lang())}</SectionLabel>
          <Card class="p-3.5">
            <div class="flex flex-col gap-3">
              <div class="flex items-start gap-3">
                <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-muted text-primary">
                  <DownloadCloudIcon size={18} />
                </div>
                <div class="flex min-w-0 grow flex-col gap-1">
                  <span class="text-[0.88rem] font-bold text-foreground">
                    {t("routeDatabase", lang())}
                  </span>
                  <span class="tnum text-[0.81rem] font-medium text-muted-foreground">
                    {stats().routes.toLocaleString()} {lang() === "zh" ? "條路線" : "routes"} ·{" "}
                    {stats().stops.toLocaleString()} {lang() === "zh" ? "個車站" : "stops"}
                  </span>
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <div class="h-1.5 overflow-hidden rounded-full bg-background">
                  <div
                    class="h-full rounded-full"
                    style={{
                      width: "100%",
                      background:
                        "linear-gradient(to right, color-mix(in srgb, var(--primary) 60%, transparent), var(--primary))",
                    }}
                  />
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-[0.75rem] font-semibold text-primary">
                    {t("downloaded", lang())}
                  </span>
                  <span class="tnum text-[0.75rem] font-medium text-subtle-foreground">
                    {t("updatedAt", lang())}{" "}
                    {format(new Date(meta().fetchedAt), "MM-dd HH:mm", { locale: locale() })}
                  </span>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy()}
                  onClick={() => void update()}
                  class="flex h-10 grow items-center justify-center gap-2 rounded-lg bg-secondary text-[0.88rem] font-bold text-muted-foreground disabled:opacity-50"
                >
                  <span class={{ "motion-safe:animate-spin": busy() }}>
                    <RefreshIcon size={15} />
                  </span>
                  {t("updateNow", lang())}
                </button>
                <button
                  type="button"
                  aria-label="clear cache"
                  onClick={() => clearEtaCache()}
                  class="flex size-10 items-center justify-center rounded-lg bg-secondary text-subtle-foreground"
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            </div>
          </Card>
        </Section>

        {/*
         * The one place in the app that says whose app this is - and, now that it
         * has a section of its own rather than a centred footer, what it is built
         * on and what it does with what it knows about you.
         */}
        <Section class="gap-3 lg:mb-8 lg:break-inside-avoid">
          <SectionLabel>{t("about", lang())}</SectionLabel>
          <Card>
            <div class="flex items-center gap-3.5 px-3.5 py-4">
              <AppMark size={44} />
              <div class="flex min-w-0 flex-col gap-1">
                <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span class="text-[1rem] font-bold tracking-[-0.02em] text-foreground">
                    {t("appName", lang())}
                  </span>
                  {/*
                   * Release and commit together: the number is what a rider
                   * quotes, the sha is what makes the report actionable.
                   */}
                  <span class="tnum rounded-full bg-secondary px-1.5 py-[1px] text-[0.69rem] font-bold tracking-[0.04em] text-faint-foreground">
                    {APP_VERSION} · {BUILD_SHA}
                  </span>
                </div>
                <span class="text-[0.81rem] font-medium leading-snug text-subtle-foreground">
                  {t("appTagline", lang())}
                </span>
              </div>
            </div>
            <Hairline />
            <LinkRow
              href={REPO_URL}
              title={t("sourceCode", lang())}
              subtitle={t("sourceCodeHint", lang())}
              icon={<GithubIcon size={16} />}
            />
            <Hairline />
            <button
              type="button"
              onClick={shareApp}
              class="mb-tap flex w-full items-center gap-3 px-3.5 py-3 text-left"
            >
              <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                <ShareIcon size={15} />
              </span>
              <span class="flex min-w-0 grow flex-col gap-0.5">
                <span class="text-[0.88rem] font-bold text-foreground">
                  {t("shareApp", lang())}
                </span>
                <span class="text-[0.75rem] font-medium text-subtle-foreground">
                  {t("shareAppHint", lang())}
                </span>
              </span>
            </button>
          </Card>
          {/* Where everything the app knows about this rider is kept. It sits
            under the card rather than in it: it is not a row to press. */}
          <p class="px-0.5 text-[0.75rem] font-medium leading-relaxed text-faint-foreground">
            {t("privacyNote", lang())}
          </p>
        </Section>

        <Section class="gap-3 lg:mb-8 lg:break-inside-avoid">
          <SectionLabel>{t("dataSources", lang())}</SectionLabel>
          <Card>
            <For each={CREDITS}>
              {(credit, i) => (
                <>
                  <Show when={i() > 0}>
                    <Hairline />
                  </Show>
                  <LinkRow
                    href={credit.href}
                    title={t(credit.key, lang())}
                    subtitle={credit.host}
                  />
                </>
              )}
            </For>
          </Card>
          {/* What a time on this screen is actually worth, said once, under the
            list of the feeds those times come out of. */}
          <p class="px-0.5 text-[0.75rem] font-medium leading-relaxed text-faint-foreground">
            {t("notAffiliated", lang())}
          </p>
        </Section>
      </div>
    </Page>
  );
}
