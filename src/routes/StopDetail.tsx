import { useParams } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { Page } from "~/components/Layout";
import { StopPreview } from "~/components/StopPreview";
import { useDb } from "~/data/context";
import { NotFound } from "~/routes/NotFound";
import { settings } from "~/stores/settings";

export default function StopDetail() {
  const db = useDb();
  const params = useParams({ from: "/stop/$id" });
  const lang = settings.lang;
  const stopId = () => params().id;

  return (
    <Page fill="always">
      <Show when={db().stopList[stopId()]} fallback={<NotFound kind="stop" />}>
        <StopPreview stopId={stopId()} lang={lang()} />
      </Show>
    </Page>
  );
}
