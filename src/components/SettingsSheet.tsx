import { format } from "date-fns";
import { enUS, zhHK } from "date-fns/locale";
import { For, Show, createEffect, createMemo, createSignal, lazy } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Card, Hairline, SectionLabel, Segmented, Toggle } from "~/components/Chrome";
import { AppMark } from "~/components/AppMark";
import { Drawer, DrawerHeader } from "~/components/Drawer";
import { Section } from "~/components/Layout";
import {
  ChevronRightIcon,
  ClipboardIcon,
  DownloadCloudIcon,
  ExternalIcon,
  GithubIcon,
  RefreshIcon,
  ShareIcon,
  SettingsIcon,
  TrashIcon,
} from "~/components/Icons";
import { useDb, useDbMeta } from "~/data/context";
import { clearRouteDb, describeDb, refreshRouteDb } from "~/data/db";
import { clearEtaCache } from "~/data/eta";
import { APP_VERSION, BUILD_SHA, REPO_URL } from "~/lib/build";
import { downloadBackup, importBackup } from "~/lib/backup";
import { formatRange } from "~/lib/geo";
import { t } from "~/lib/i18n";
import { notifyPermission, requestNotifyPermission, type NotifyPermission } from "~/lib/notify";
import { pointerOrigin, swapTheme } from "~/lib/themeSwap";
import { createWide } from "~/lib/wide";
import {
  ALERT_LEAD_CHOICES,
  ALERT_RADIUS_CHOICES,
  REFRESH_CHOICES,
  settings,
} from "~/stores/settings";
import { alerts } from "~/stores/alerts";
import { sheets } from "~/stores/sheets";
import { starred } from "~/stores/starred";
import { trips } from "~/stores/trips";
import { toast } from "~/stores/toast";

/*
 * Inside this drawer rather than beside it: a nested root reads the drawer it
 * stacks on from context, so the range sheet has to live in this one's tree to
 * be able to push it back. The same lazy chunk the shell's un-nested copy
 * loads - one import, whichever way in the rider takes.
 */
const RangeSheet = lazy(() => import("./RangeSheet"));

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
      class="app-tap flex items-center gap-3 px-3.5 py-3"
    >
      <Show when={props.icon}>
        <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground">
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

/**
 * Settings, as a drawer over whatever the rider was doing.
 *
 * It was a screen of its own; it is now a sheet from the foot of a phone and
 * a panel from the right of a wide window, because nothing here is a place a
 * rider goes so much as a lever they pull and leave - and a drawer hands back
 * the screen they were on the moment it closes.
 */
export default function SettingsSheet() {
  const db = useDb();
  const meta = useDbMeta();
  const lang = settings.lang;
  const wide = createWide();
  const [busy, setBusy] = createSignal(false);
  const [permission, setPermission] = createSignal<NotifyPermission>(notifyPermission());

  // Re-read on every open rather than once at setup: the drawer outlives its
  // openings, and the rider may have changed it in the browser between them.
  createEffect(
    () => sheets.settingsOpen(),
    (open) => {
      if (open) setPermission(notifyPermission());
    },
  );

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

  let importBackupInput: HTMLInputElement | undefined;
  const [armedImportReplace, setArmedImportReplace] = createSignal(false, { ownedWrite: true });
  let disarmImport: number | undefined;

  const armImportReplace = () => {
    setArmedImportReplace(true);
    window.clearTimeout(disarmImport);
    disarmImport = window.setTimeout(() => setArmedImportReplace(false), 10_000);
  };

  const backupSummary = createMemo(() => {
    const count = starred.items().length;
    const stars =
      lang() === "zh" ? `${count} 個收藏` : `${count} ${count === 1 ? "star" : "stars"}`;
    const tripCount = trips.items().length;
    const tripsLabel =
      lang() === "zh"
        ? `${tripCount} 個行程`
        : `${tripCount} ${tripCount === 1 ? "trip" : "trips"}`;
    const alertCount = alerts.items().length;
    const alertsLabel =
      lang() === "zh"
        ? `${alertCount} 個提示`
        : `${alertCount} ${alertCount === 1 ? "alert" : "alerts"}`;
    return `${stars} · ${tripsLabel} · ${alertsLabel}`;
  });

  const exportAppData = () => {
    downloadBackup();
    toast.show(t("starredExported", lang()), backupSummary());
  };

  const importSummary = (result: ReturnType<typeof importBackup>) => {
    const parts = [
      `${result.starred.added} ${t("starredImportAdded", lang())}`,
      `${result.starred.skipped} ${t("starredImportSkipped", lang())}`,
    ];
    if (result.starred.invalid > 0) {
      parts.push(`${result.starred.invalid} ${t("starredImportInvalid", lang())}`);
    }
    return parts.join(" · ");
  };

  const importAppData = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const mode = armedImportReplace() ? "replace" : "merge";
    void file
      .text()
      .then((text) => {
        window.clearTimeout(disarmImport);
        setArmedImportReplace(false);
        const result = importBackup(JSON.parse(text), mode);
        toast.show(
          mode === "replace" ? t("starredImportReplaced", lang()) : t("starredImported", lang()),
          importSummary(result),
        );
      })
      .catch(() => toast.show(t("starredImportFailed", lang())))
      .finally(() => {
        input.value = "";
      });
  };

  const openImport = () => {
    if (armedImportReplace()) {
      window.clearTimeout(disarmImport);
      setArmedImportReplace(false);
    }
    importBackupInput?.click();
  };

  const openImportReplace = () => {
    if (armedImportReplace()) {
      importBackupInput?.click();
      return;
    }
    armImportReplace();
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

  /*
   * Deleting the offline database is the one thing on this screen a rider
   * cannot undo without a download, so it is asked twice: the first press arms
   * the button, the second does it. Ten seconds is long enough to read the
   * second ask and short enough that a panel left open does not keep a live
   * delete under the thumb.
   */
  const [armedDelete, setArmedDelete] = createSignal(false, { ownedWrite: true });
  let disarm: number | undefined;

  const arm = () => {
    setArmedDelete(true);
    window.clearTimeout(disarm);
    disarm = window.setTimeout(() => setArmedDelete(false), 10_000);
  };

  const wipe = async () => {
    window.clearTimeout(disarm);
    setArmedDelete(false);
    setBusy(true);
    try {
      await clearRouteDb();
      toast.show(t("deleteOfflineDone", lang()), t("routeDatabase", lang()));
      // Every screen is still holding the copy this just deleted from disk,
      // and the database is read once at start-up - the same reason "update
      // now" reloads rather than trying to swap it under the running app.
      location.reload();
    } catch {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={sheets.settingsOpen()}
      onClose={() => sheets.closeSettings()}
      modal
      side={wide() ? "right" : "bottom"}
      scroll={false}
      label={t("settings", lang())}
      class={[wide() ? "" : "z-50 sm:max-w-[32rem]"].filter(Boolean).join(" ")}
    >
      <DrawerHeader title={t("settings", lang())} />

      {/* The one part that scrolls; the header stays put over it. The sheet
          wears the same card surface as every other sheet; the section cards
          are `raised` a step above it, and the controls inside them step back
          down to the card tone, wells cut into the raised panels. */}
      <div class="app-scroll min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pb-6 pt-4">
        <div class="flex flex-col gap-6">
          <Section class="gap-3">
            <SectionLabel>{t("display", lang())}</SectionLabel>
            <Card raised>
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

          <Section class="gap-3">
            <SectionLabel>{t("liveEta", lang())}</SectionLabel>
            <Card raised>
              <Row title={t("refresh", lang())}>
                <Segmented
                  label="Refresh interval"
                  value={settings.refreshSeconds()}
                  onChange={(v) => settings.setRefreshSeconds(v)}
                  options={REFRESH_CHOICES.map((s) => ({ value: s, label: `${s}s` }))}
                />
              </Row>
              <Hairline />
              {/* Chosen on a map rather than from presets, so the row is a
                  door to the range sheet - which stacks on this drawer rather
                  than replacing it: settings pushes back the way a drawer
                  does under one of its own, and closing the map returns to
                  this row with the panel still up. */}
              <Row title={t("radius", lang())}>
                <button
                  type="button"
                  onClick={() => sheets.openRangeInSettings()}
                  class="app-press flex h-8 items-center gap-1 rounded-full bg-card px-3.5 text-[0.81rem] font-bold text-muted-foreground"
                >
                  <span class="tnum">{formatRange(settings.radiusM())}</span>
                  <ChevronRightIcon size={12} />
                </button>
              </Row>
              <Hairline />
              <Row title={t("showScheduled", lang())}>
                <Toggle
                  label={t("showScheduled", lang())}
                  checked={settings.showScheduled()}
                  onChange={(v) => settings.setShowScheduled(v)}
                />
              </Row>
              <Hairline />
              {/* The o'clock time beside the countdown. Off by default: the
                  minutes are the answer at a kerb, and this is the form for
                  planning against a watch or a last train. */}
              <Row title={t("showClockTimes", lang())}>
                <Toggle
                  label={t("showClockTimes", lang())}
                  checked={settings.clockTimes()}
                  onChange={(v) => settings.setClockTimes(v)}
                />
              </Row>
            </Card>
          </Section>

          {/*
           * Three switches for one inference, all off until asked for.
           *
           * The caveat is said once, under the heading, because it is true of
           * all three and repeating it on every row would make three rows of
           * small print out of three choices. Each row then says only where
           * the buses would be drawn, which is the part a rider is choosing
           * between: they are not equally strong claims - a bus on a map
           * points at a place, a glyph on the rail only at a gap between two
           * stops, and a count of stops is the loosest of the three - so the
           * rider takes the ones they trust rather than all or nothing.
           */}
          <Section class="gap-3">
            <SectionLabel>{t("showVehicles", lang())}</SectionLabel>
            <p class="-mt-1 px-1 text-[0.75rem] font-medium text-subtle-foreground">
              {t("showVehiclesHint", lang())}
            </p>
            <Card raised>
              <Row title={t("showVehiclesMap", lang())}>
                <Toggle
                  label={t("showVehiclesMap", lang())}
                  checked={settings.vehiclesOnMap()}
                  onChange={(v) => settings.setVehiclesOnMap(v)}
                />
              </Row>
              <Hairline />
              <Row title={t("showVehiclesList", lang())}>
                <Toggle
                  label={t("showVehiclesList", lang())}
                  checked={settings.vehiclesOnList()}
                  onChange={(v) => settings.setVehiclesOnList(v)}
                />
              </Row>
              <Hairline />
              <Row title={t("showVehiclesAway", lang())}>
                <Toggle
                  label={t("showVehiclesAway", lang())}
                  checked={settings.vehiclesAway()}
                  onChange={(v) => settings.setVehiclesAway(v)}
                />
              </Row>
            </Card>
          </Section>

          <Section class="gap-3">
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
            <Card raised>
              {/*
               * Whether a reminder can reach a pocket is the first thing to say:
               * everything under it is worthless if the answer is no. A switch,
               * but an honest one about what a page may do with the permission:
               * turning it on asks the browser, and that is the only direction
               * the browser allows - revocation lives in its own settings, so a
               * drag to off snaps back, and a blocked or unsupported state says
               * so under the title rather than pretending the switch could fix
               * it.
               */}
              <Row
                title={t("alertPermission", lang())}
                subtitle={
                  permission() === "denied"
                    ? t("alertBlocked", lang())
                    : permission() === "unsupported"
                      ? t("alertUnsupported", lang())
                      : undefined
                }
              >
                <Toggle
                  label={t("alertPermission", lang())}
                  checked={permission() === "granted"}
                  onChange={(on) => {
                    if (on) void requestNotifyPermission().then(setPermission);
                  }}
                />
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
                    class="flex h-8 items-center rounded-full bg-card px-3.5 text-[0.81rem] font-bold text-destructive"
                  >
                    {t("alertOff", lang())}
                  </button>
                </div>
              </Show>
            </Card>
          </Section>

          <Section class="gap-3">
            <SectionLabel>{t("starredData", lang())}</SectionLabel>
            <p class="-mt-1 px-1 text-[0.75rem] font-medium text-subtle-foreground">
              {t("starredDataHint", lang())}
            </p>
            <Card raised class="p-3.5">
              <div class="flex flex-col gap-3">
                <div class="flex items-start gap-3">
                  <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-muted text-primary">
                    <SettingsIcon size={18} />
                  </div>
                  <div class="flex min-w-0 grow flex-col gap-1">
                    <span class="text-[0.88rem] font-bold text-foreground">
                      {t("starredData", lang())}
                    </span>
                    <span class="tnum text-[0.81rem] font-medium text-muted-foreground">
                      {backupSummary()}
                    </span>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={exportAppData}
                    class="flex h-10 grow items-center justify-center gap-2 rounded-lg bg-card text-[0.88rem] font-bold text-muted-foreground"
                  >
                    <DownloadCloudIcon size={15} />
                    {t("starredExport", lang())}
                  </button>
                  <button
                    type="button"
                    onClick={openImport}
                    class="flex h-10 grow items-center justify-center gap-2 rounded-lg bg-card text-[0.88rem] font-bold text-muted-foreground"
                  >
                    <ClipboardIcon size={15} />
                    {t("starredImport", lang())}
                  </button>
                  <button
                    type="button"
                    aria-label={
                      armedImportReplace()
                        ? t("starredImportReplaceConfirm", lang())
                        : t("starredImportReplace", lang())
                    }
                    onClick={openImportReplace}
                    class={[
                      "flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg text-destructive transition-[width,background-color] duration-state",
                      armedImportReplace()
                        ? "bg-destructive/12 px-3.5 text-[0.88rem] font-bold"
                        : "size-10 bg-card",
                    ]}
                  >
                    <TrashIcon size={16} />
                    <Show when={armedImportReplace()}>
                      {t("starredImportReplaceConfirm", lang())}
                    </Show>
                  </button>
                  <input
                    ref={importBackupInput}
                    type="file"
                    accept="application/json,.json"
                    class="hidden"
                    onChange={importAppData}
                  />
                </div>
              </div>
            </Card>
          </Section>

          <Section class="gap-3">
            <SectionLabel>{t("offlineData", lang())}</SectionLabel>
            <Card raised class="p-3.5">
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
                  <div class="h-1.5 overflow-hidden rounded-full bg-card">
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
                    class="flex h-10 grow items-center justify-center gap-2 rounded-lg bg-card text-[0.88rem] font-bold text-muted-foreground disabled:opacity-50"
                  >
                    <span class={{ "motion-safe:animate-spin": busy() }}>
                      <RefreshIcon size={15} />
                    </span>
                    {t("updateNow", lang())}
                  </button>
                  {/* Destructive, so it says so in the one colour this app
                      reserves for it, and it asks twice. The second ask is the
                      button itself widening into the words - the next step on
                      the row, where every other state in this app shows it,
                      rather than a dialog thrown over the panel. It disarms on
                      its own, because an armed delete a rider walked away from
                      must not still be armed when they come back. */}
                  <button
                    type="button"
                    aria-label={
                      armedDelete() ? t("deleteOfflineConfirm", lang()) : t("deleteOffline", lang())
                    }
                    disabled={busy()}
                    onClick={() => (armedDelete() ? void wipe() : arm())}
                    class={[
                      "flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg text-destructive transition-[width,background-color] duration-state disabled:opacity-50",
                      armedDelete()
                        ? "bg-destructive/12 px-3.5 text-[0.88rem] font-bold"
                        : "size-10 bg-card",
                    ]}
                  >
                    <TrashIcon size={16} />
                    <Show when={armedDelete()}>{t("deleteOfflineConfirm", lang())}</Show>
                  </button>
                </div>
              </div>
            </Card>
          </Section>

          {/*
           * The one place in the app that says whose app this is - and, now that
           * it has a section of its own rather than a centred footer, what it is
           * built on and what it does with what it knows about you.
           */}
          <Section class="gap-3">
            <SectionLabel>{t("about", lang())}</SectionLabel>
            <Card raised>
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
                    <span class="tnum rounded-full bg-card px-1.5 py-[1px] text-[0.69rem] font-bold tracking-[0.04em] text-faint-foreground">
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
                class="app-tap flex w-full items-center gap-3 px-3.5 py-3 text-left"
              >
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground">
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
                <img
                  src="/icons/dragon.png"
                  alt=""
                  width={40}
                  height={40}
                  aria-hidden="true"
                  draggable={false}
                  class="size-10 shrink-0 object-contain"
                />
              </button>
            </Card>
            {/* Where everything the app knows about this rider is kept. It sits
              under the card rather than in it: it is not a row to press. */}
            <p class="px-0.5 text-[0.75rem] font-medium leading-relaxed text-faint-foreground">
              {t("privacyNote", lang())}
            </p>
          </Section>

          <Section class="gap-3">
            <SectionLabel>{t("dataSources", lang())}</SectionLabel>
            <Card raised>
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
      </div>

      {/* The map opened from the range row, stacked on this drawer. A sibling
          of the scroller and inside the same root, which is what makes it a
          nested drawer rather than a second one over the top. */}
      <Show when={sheets.rangeWanted()} keyed>
        <RangeSheet nested />
      </Show>
    </Drawer>
  );
}
