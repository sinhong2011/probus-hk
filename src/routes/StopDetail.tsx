import { useParams } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { Page } from "~/components/Layout";
import { StopPreview } from "~/components/StopPreview";
import { useDb } from "~/data/context";
import { stopMetaDescription, stopTitle, usePageHead } from "~/lib/documentHead";
import { pick, t } from "~/lib/i18n";
import { NotFound } from "~/routes/NotFound";
import { settings } from "~/stores/settings";

export default function StopDetail() {
  const db = useDb();
  const params = useParams({ from: "/stop/$id" });
  const lang = settings.lang;
  const stopId = () => params().id;

  usePageHead(() => {
    const entry = db().stopList[stopId()];
    if (!entry) return appTitle(t("notFoundStop", lang()), lang());
    const name = pick(entry.name, lang());
    return {
      title: stopTitle(entry.name, lang()),
      description: stopMetaDescription(name, lang()),
    };
  });

  return (
    <Page fill="always">
      <Show when={db().stopList[stopId()]} fallback={<NotFound kind="stop" />}>
        <StopPreview stopId={stopId()} lang={lang()} />
      </Show>
    </Page>
  );
}
