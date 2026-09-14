import { Show, createSignal } from "solid-js";
import { Card, Hairline, Reveal, SectionLabel, Segmented, Toggle } from "~/components/Chrome";
import { Drawer, DrawerHeader } from "~/components/Drawer";
import { DownloadCloudIcon, UploadCloudIcon } from "~/components/Icons";
import { Section } from "~/components/Layout";
import { t } from "~/lib/i18n";
import {
  RemoteSyncError,
  applyRemoteBackup,
  pullRemote,
  pushRemote,
  syncReady,
  type SyncKind,
} from "~/lib/remoteSync";
import { createWide } from "~/lib/wide";
import { settings } from "~/stores/settings";
import { sync } from "~/stores/sync";
import { toast } from "~/stores/toast";
import { format } from "date-fns";
import { enUS, zhHK } from "date-fns/locale";

function Field(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  type?: "text" | "password" | "url";
  placeholder?: string;
  autocomplete?: string;
  name?: string;
}) {
  return (
    <label class="flex flex-col gap-1 px-3.5 py-2.5">
      <span class="text-[0.75rem] font-semibold text-subtle-foreground">{props.label}</span>
      <input
        type={props.type ?? "text"}
        name={props.name}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        placeholder={props.placeholder}
        autocomplete={props.autocomplete ?? "off"}
        spellcheck={false}
        class="h-10 rounded-xl border border-border bg-card px-3 text-[0.88rem] font-semibold text-foreground outline-none placeholder:font-medium placeholder:text-faint-foreground focus-visible:border-primary"
      />
    </label>
  );
}

function errorMessage(error: unknown, lang: "zh" | "en"): string {
  const code = error instanceof RemoteSyncError ? error.code : "http";
  const key =
    code === "cors"
      ? "remoteSyncCors"
      : code === "auth"
        ? "remoteSyncAuth"
        : code === "missing"
          ? "remoteSyncMissing"
          : code === "invalid"
            ? "remoteSyncInvalid"
            : code === "incomplete"
              ? "remoteSyncIncomplete"
              : "remoteSyncHttp";
  return t(key, lang);
}

/**
 * Where a copy of the rider's data can live besides this phone.
 *
 * WebDAV and S3 are the two ways a self-hosted backup actually travels: a
 * Nextcloud folder, a MinIO box, Cloudflare R2. The credentials stay in this
 * browser; the JSON that goes over the wire is the same file Export already
 * writes. Push replaces the remote file, pull merges it in - the same two
 * verbs as the file buttons on the settings card underneath this sheet.
 */
export default function SyncSheet(props: { open: boolean; onClose: () => void; nested?: boolean }) {
  const lang = settings.lang;
  const wide = createWide();
  const [busy, setBusy] = createSignal(false);

  const locale = () => (lang() === "zh" ? zhHK : enUS);
  const last = () => {
    const at = sync.lastSyncedAt();
    if (!at) return t("remoteSyncNever", lang());
    return `${t("remoteSyncLast", lang())} ${format(new Date(at), "MM-dd HH:mm", { locale: locale() })}`;
  };

  const push = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await pushRemote(sync.snapshot());
      sync.markSynced();
      toast.show(t("remoteSyncPushed", lang()), t("remoteSync", lang()));
    } catch (error) {
      toast.show(errorMessage(error, lang()), t("remoteSync", lang()));
    } finally {
      setBusy(false);
    }
  };

  const pull = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      const remote = await pullRemote(sync.snapshot());
      if (!remote) {
        toast.show(t("remoteSyncMissing", lang()), t("remoteSync", lang()));
        return;
      }
      applyRemoteBackup(remote, "merge");
      sync.markSynced();
      toast.show(t("remoteSyncPulled", lang()), t("remoteSync", lang()));
    } catch (error) {
      toast.show(errorMessage(error, lang()), t("remoteSync", lang()));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      nested={props.nested}
      modal
      side={wide() ? "right" : "bottom"}
      scroll={false}
      label={t("remoteSync", lang())}
      class={wide() ? "" : "sm:max-w-[32rem]"}
    >
      <DrawerHeader title={t("remoteSync", lang())} />

      <div class="app-scroll min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pb-6 pt-1">
        <div class="flex flex-col gap-6">
          <p class="-mb-2 px-1 text-[0.75rem] font-medium leading-relaxed text-subtle-foreground">
            {t("remoteSyncHint", lang())}
          </p>

          <Section class="gap-3">
            <SectionLabel>{t("remoteSync", lang())}</SectionLabel>
            <Card raised>
              <div class="px-3.5 py-3">
                <Segmented
                  fill
                  label={t("remoteSync", lang())}
                  value={sync.kind()}
                  onChange={(value) => sync.setKind(value)}
                  options={[
                    { value: "none" as SyncKind, label: t("remoteSyncOff", lang()) },
                    { value: "webdav" as SyncKind, label: "WebDAV" },
                    { value: "s3" as SyncKind, label: "S3" },
                  ]}
                />
              </div>
            </Card>
          </Section>

          <Reveal open={sync.kind() === "webdav"}>
            <Section class="gap-3">
              <SectionLabel>WebDAV</SectionLabel>
              <Card raised>
                <Field
                  label={t("webdavUrl", lang())}
                  value={sync.webdavUrl()}
                  onInput={sync.setWebdavUrl}
                  type="url"
                  name="webdav-url"
                  placeholder="https://cloud.example/remote.php/dav/files/you/"
                  autocomplete="url"
                />
                <Hairline />
                <Field
                  label={t("webdavUser", lang())}
                  value={sync.webdavUser()}
                  onInput={sync.setWebdavUser}
                  name="webdav-user"
                  autocomplete="username"
                />
                <Hairline />
                <Field
                  label={t("webdavPassword", lang())}
                  value={sync.webdavPassword()}
                  onInput={sync.setWebdavPassword}
                  type="password"
                  name="webdav-password"
                  autocomplete="current-password"
                />
              </Card>
              <p class="px-1 text-[0.75rem] font-medium leading-relaxed text-faint-foreground">
                {t("webdavUrlHint", lang())}
              </p>
            </Section>
          </Reveal>

          <Reveal open={sync.kind() === "s3"}>
            <Section class="gap-3">
              <SectionLabel>S3</SectionLabel>
              <Card raised>
                <Field
                  label={t("s3Endpoint", lang())}
                  value={sync.s3Endpoint()}
                  onInput={sync.setS3Endpoint}
                  type="url"
                  name="s3-endpoint"
                  placeholder="https://s3.amazonaws.com"
                  autocomplete="url"
                />
                <Hairline />
                <Field
                  label={t("s3Region", lang())}
                  value={sync.s3Region()}
                  onInput={sync.setS3Region}
                  name="s3-region"
                  placeholder="us-east-1"
                />
                <Hairline />
                <Field
                  label={t("s3Bucket", lang())}
                  value={sync.s3Bucket()}
                  onInput={sync.setS3Bucket}
                  name="s3-bucket"
                />
                <Hairline />
                <Field
                  label={t("s3Key", lang())}
                  value={sync.s3Key()}
                  onInput={sync.setS3Key}
                  name="s3-key"
                  placeholder="probus-backup.json"
                />
                <Hairline />
                <Field
                  label={t("s3AccessKey", lang())}
                  value={sync.s3AccessKey()}
                  onInput={sync.setS3AccessKey}
                  name="s3-access-key"
                  autocomplete="off"
                />
                <Hairline />
                <Field
                  label={t("s3SecretKey", lang())}
                  value={sync.s3SecretKey()}
                  onInput={sync.setS3SecretKey}
                  type="password"
                  name="s3-secret-key"
                  autocomplete="off"
                />
                <Hairline />
                <div class="flex items-center gap-3 px-3.5 py-3">
                  <div class="flex min-w-0 grow flex-col gap-0.5">
                    <span class="text-[0.88rem] font-bold text-foreground">
                      {t("s3PathStyle", lang())}
                    </span>
                    <span class="text-[0.75rem] font-medium text-subtle-foreground">
                      {t("s3PathStyleHint", lang())}
                    </span>
                  </div>
                  <Toggle
                    label={t("s3PathStyle", lang())}
                    checked={sync.s3PathStyle()}
                    onChange={sync.setS3PathStyle}
                  />
                </div>
              </Card>
            </Section>
          </Reveal>

          <Show when={sync.kind() !== "none"}>
            <div class="flex flex-col gap-2">
              <span class="tnum px-1 text-[0.75rem] font-medium text-subtle-foreground">
                {last()}
              </span>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy() || !syncReady(sync.snapshot())}
                  onClick={() => void pull()}
                  class="flex h-10 grow items-center justify-center gap-2 rounded-lg bg-raised text-[0.88rem] font-bold text-muted-foreground disabled:opacity-50"
                >
                  <span class={{ "motion-safe:animate-spin": busy() }}>
                    <DownloadCloudIcon size={15} />
                  </span>
                  {t("remoteSyncPull", lang())}
                </button>
                <button
                  type="button"
                  disabled={busy() || !syncReady(sync.snapshot())}
                  onClick={() => void push()}
                  class="flex h-10 grow items-center justify-center gap-2 rounded-lg bg-raised text-[0.88rem] font-bold text-muted-foreground disabled:opacity-50"
                >
                  <UploadCloudIcon size={15} />
                  {t("remoteSyncPush", lang())}
                </button>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Drawer>
  );
}
