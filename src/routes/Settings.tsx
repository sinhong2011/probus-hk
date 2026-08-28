import { format } from "date-fns";
import { enUS, zhHK } from "date-fns/locale";
import { Show, createMemo, createSignal } from "solid-js";
import { Card, Hairline, ScreenTitle, SectionLabel, Segmented, Toggle } from "~/components/Chrome";
import { AppMark } from "~/components/AppMark";
import { Page, Section } from "~/components/Layout";
import { DownloadCloudIcon, RefreshIcon, TrashIcon } from "~/components/Icons";
import { useDb, useDbMeta } from "~/data/context";
import { describeDb, refreshRouteDb } from "~/data/db";
import { clearEtaCache } from "~/data/eta";
import { t } from "~/lib/i18n";
import { REFRESH_CHOICES, RADIUS_CHOICES, settings } from "~/stores/settings";

function Row(props: { title: string; subtitle: string; children: unknown }) {
  return (
    <div class="flex items-center gap-3 px-3.5 py-3">
      <div class="flex min-w-0 grow flex-col gap-0.5">
        <span class="text-[0.8rem] font-bold text-foreground">{props.title}</span>
        <span class="text-[0.63rem] font-medium text-subtle-foreground">{props.subtitle}</span>
      </div>
      {props.children as never}
    </div>
  );
}

export default function Settings() {
  const db = useDb();
  const meta = useDbMeta();
  const lang = settings.lang;
  const [busy, setBusy] = createSignal(false);

  const stats = createMemo(() => describeDb(db()));
  const locale = () => (lang() === "zh" ? zhHK : enUS);

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
      <ScreenTitle title={t("settings", lang())} subtitle="Settings" />

      <Section class="gap-3">
        <SectionLabel>顯示 Display</SectionLabel>
        <Card>
          <Row title={t("language", lang())} subtitle="Language">
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
          <Row title={t("theme", lang())} subtitle="Theme">
            <Segmented
              label="Theme"
              value={settings.theme()}
              onChange={(v) => settings.setTheme(v)}
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
        <SectionLabel>實時到站 Live ETA</SectionLabel>
        <Card>
          <Row title={t("refresh", lang())} subtitle="Refresh interval">
            <Segmented
              label="Refresh interval"
              value={settings.refreshSeconds()}
              onChange={(v) => settings.setRefreshSeconds(v)}
              options={REFRESH_CHOICES.map((s) => ({ value: s, label: `${s}s` }))}
            />
          </Row>
          <Hairline />
          <Row title={t("radius", lang())} subtitle="Search radius">
            <Segmented
              label="Search radius"
              value={settings.radiusM()}
              onChange={(v) => settings.setRadiusM(v)}
              options={RADIUS_CHOICES.map((r) => ({ value: r, label: `${r}m` }))}
            />
          </Row>
          <Hairline />
          <Row title={t("showScheduled", lang())} subtitle="Show scheduled departures">
            <Toggle
              label={t("showScheduled", lang())}
              checked={settings.showScheduled()}
              onChange={(v) => settings.setShowScheduled(v)}
            />
          </Row>
        </Card>
      </Section>

      <Section class="gap-3">
        <SectionLabel>{`${t("offlineData", lang())} Offline data`}</SectionLabel>
        <Card class="p-3.5">
          <div class="flex flex-col gap-3">
            <div class="flex items-start gap-3">
              <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-muted text-primary">
                <DownloadCloudIcon size={18} />
              </div>
              <div class="flex min-w-0 grow flex-col gap-1">
                <span class="text-[0.8rem] font-bold text-foreground">{t("routeDatabase", lang())}</span>
                <span class="tnum text-[0.66rem] font-medium text-muted-foreground">
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
                    background: "linear-gradient(to right, color-mix(in srgb, var(--primary) 60%, transparent), var(--primary))",
                  }}
                />
              </div>
              <div class="flex items-center justify-between">
                <span class="text-[0.63rem] font-semibold text-primary">
                  {t("downloaded", lang())}
                </span>
                <span class="tnum text-[0.63rem] font-medium text-subtle-foreground">
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
                class="flex h-10 grow items-center justify-center gap-2 rounded-lg bg-secondary text-[0.75rem] font-bold text-muted-foreground disabled:opacity-50"
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

      {/* The one place in the app that says whose app this is. */}
      <div class="flex flex-col items-center gap-2.5 pt-2">
        <AppMark size={40} />
        <div class="flex flex-col items-center gap-0.5">
          <span class="text-[0.75rem] font-bold tracking-[-0.01em] text-muted-foreground">
            MotherBus 0.1.0
          </span>
          <span class="text-center text-[0.63rem] font-medium leading-relaxed text-faint-foreground">
            {t("dataSource", lang())} data.gov.hk · data.hkbus.app
          </span>
        </div>
      </div>
    </Page>
  );
}
