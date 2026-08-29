import { For, Show, createEffect, createSignal } from "solid-js";
import { Modal } from "./Modal";
import { AlarmIcon, CheckIcon } from "./Icons";
import type { KeyedRoute } from "~/data/types";
import { notifyPermission, requestNotifyPermission, type NotifyPermission } from "~/lib/notify";
import { pick, t, type Lang } from "~/lib/i18n";
import { alertId, alerts } from "~/stores/alerts";
import { ALERT_LEAD_CHOICES, settings } from "~/stores/settings";

/**
 * Arming a reminder for the bus you are waiting for.
 *
 * Only that one: a rider standing at a stop is asking "tell me when it gets
 * here", and that is the whole of this sheet. Getting off is a different
 * question and it belongs to a different thing - it is part of a ride, so it
 * is asked where the ride is, on the band that already knows which stop the
 * rider chose. Offering it here as well meant two controls arming the same
 * alert, and a rider having to pick between them before they could ask.
 */
export function AlertSheet(props: {
  open: boolean;
  onClose: () => void;
  route: KeyedRoute;
  seq: number;
  stopId: string;
  stopName: string;
  lang: Lang;
}) {
  const [permission, setPermission] = createSignal<NotifyPermission>("default");

  // Read on open rather than at setup: the rider may have changed it in the
  // browser's own settings since the page loaded.
  createEffect(
    () => props.open,
    (open) => {
      if (open) setPermission(notifyPermission());
    },
  );

  const armed = () => alerts.has("arrival", props.route.key, props.stopId);

  const toggle = () => {
    if (armed()) {
      alerts.remove(alertId("arrival", props.route.key, props.stopId));
      return;
    }
    alerts.arm({
      kind: "arrival",
      routeKey: props.route.key,
      co: props.route.co[0] ?? "kmb",
      stopId: props.stopId,
      seq: props.seq,
      leadMinutes: settings.alertLeadMinutes(),
      radiusM: settings.alertRadiusM(),
    });
    props.onClose();
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={`${props.route.route} · ${props.stopName}`}
      lang={props.lang}
    >
      <div class="flex flex-col gap-3">
        <span class="text-[0.81rem] font-medium text-subtle-foreground">
          {t("towards", props.lang)} {pick(props.route.dest, props.lang)}
        </span>

        <PermissionRow
          permission={permission()}
          lang={props.lang}
          onRequest={() => void requestNotifyPermission().then(setPermission)}
        />

        <AlertOption
          icon={<AlarmIcon size={16} />}
          title={t("alertArrival", props.lang)}
          hint={t("alertArrivalHint", props.lang)}
          armed={armed()}
          lang={props.lang}
          choiceLabel={t("alertLead", props.lang)}
          choices={ALERT_LEAD_CHOICES.map((m) => ({
            value: m,
            label: `${m} ${t("minute", props.lang)}`,
          }))}
          value={settings.alertLeadMinutes()}
          onChoose={(v) => settings.setAlertLeadMinutes(v)}
          onToggle={toggle}
        />
      </div>
    </Modal>
  );
}

/**
 * Whether the reminder can reach a pocket.
 *
 * It is stated rather than assumed: a rider who sets an alert and then puts the
 * phone away deserves to know, before they do, whether anything will actually
 * happen. Permission is asked from this button and nowhere else - a prompt on
 * page load is one browsers ignore and Safari holds against the site.
 */
function PermissionRow(props: { permission: NotifyPermission; lang: Lang; onRequest: () => void }) {
  return (
    <div class="flex items-center gap-3 rounded-xl bg-secondary px-3.5 py-3">
      <div class="flex min-w-0 grow flex-col gap-0.5">
        <span class="text-[0.88rem] font-bold text-foreground">
          {t("alertPermission", props.lang)}
        </span>
        <span class="text-[0.75rem] font-medium leading-snug text-subtle-foreground">
          {props.permission === "denied"
            ? t("alertBlocked", props.lang)
            : props.permission === "unsupported"
              ? t("alertUnsupported", props.lang)
              : t("alertPermissionHint", props.lang)}
        </span>
      </div>

      <Show when={props.permission === "default"}>
        <button
          type="button"
          onClick={props.onRequest}
          class="mb-press flex h-8 shrink-0 items-center rounded-full bg-primary px-3.5 text-[0.81rem] font-bold text-primary-foreground"
        >
          {t("alertEnable", props.lang)}
        </button>
      </Show>
      <Show when={props.permission === "granted"}>
        <span class="flex shrink-0 items-center gap-1 text-[0.81rem] font-bold text-primary">
          <CheckIcon size={12} />
          {t("alertEnabled", props.lang)}
        </span>
      </Show>
    </div>
  );
}

function AlertOption(props: {
  icon: unknown;
  title: string;
  hint: string;
  armed: boolean;
  lang: Lang;
  choiceLabel: string;
  choices: { value: number; label: string }[];
  value: number;
  onChoose: (value: number) => void;
  onToggle: () => void;
}) {
  return (
    <div
      class={[
        "flex flex-col gap-3 rounded-xl border p-3.5 transition-colors duration-state",
        {
          "border-primary-border bg-primary-muted": props.armed,
          "border-border bg-card": !props.armed,
        },
      ]}
    >
      <div class="flex items-start gap-3">
        <span
          class={[
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            {
              "bg-primary text-primary-foreground": props.armed,
              "bg-secondary text-muted-foreground": !props.armed,
            },
          ]}
        >
          {props.icon as never}
        </span>
        <div class="flex min-w-0 grow flex-col gap-0.5">
          <span class="text-[0.88rem] font-bold text-foreground">{props.title}</span>
          <span class="text-[0.81rem] font-medium leading-snug text-subtle-foreground">
            {props.hint}
          </span>
        </div>
      </div>

      {/* The setting sits inside the thing it configures, so a rider picking a
          lead time never has to wonder which alert it belongs to. */}
      <div class="flex items-center gap-2">
        <span class="shrink-0 text-[0.75rem] font-semibold text-subtle-foreground">
          {props.choiceLabel}
        </span>
        {/* Position-keyed: the array is rebuilt whenever the setting changes,
            and a value-keyed list would replace all four buttons - including
            the one the pointer is currently on - on every tap. */}
        <div class="flex grow items-center justify-end gap-1.5">
          <For each={props.choices} keyed={false}>
            {(choice) => (
              <button
                type="button"
                aria-pressed={props.value === choice().value ? "true" : "false"}
                onClick={() => props.onChoose(choice().value)}
                class={[
                  "tnum flex h-7 items-center rounded-full px-2.5 text-[0.81rem] font-bold transition-colors duration-150",
                  {
                    "bg-primary text-primary-foreground": props.value === choice().value,
                    "bg-secondary text-subtle-foreground": props.value !== choice().value,
                  },
                ]}
              >
                {choice().label}
              </button>
            )}
          </For>
        </div>
      </div>

      <button
        type="button"
        aria-label={`${props.title} · ${props.armed ? t("alertOff", props.lang) : t("remindMe", props.lang)}`}
        onClick={props.onToggle}
        class={[
          "mb-press flex h-10 items-center justify-center gap-1.5 rounded-lg text-[0.88rem] font-bold",
          {
            "bg-secondary text-destructive": props.armed,
            "bg-primary text-primary-foreground": !props.armed,
          },
        ]}
      >
        {props.armed ? t("alertOff", props.lang) : t("remindMe", props.lang)}
      </button>
    </div>
  );
}
