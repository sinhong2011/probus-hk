import { useLocation, useNavigate } from "@tanstack/solid-router";
import { For } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Drawer, DrawerRows } from "./Drawer";
import { ChevronRightIcon, MegaphoneIcon, SettingsIcon, TrainIcon, type IconProps } from "./Icons";
import { t, type Lang, type MessageKey } from "~/lib/i18n";
import { sheets } from "~/stores/sheets";
import { trail } from "~/stores/trail";

/**
 * The rest of the phone's navigation, as a sheet.
 *
 * A thumb reaches five things comfortably at the foot of a 390px screen, and
 * the bar was asking it to reach six. The screens a rider lives in - nearby,
 * starred, search - keep their tabs; the ones visited now and then, the
 * railway and the notices, live here behind "more", together with settings.
 * The sheet is a menu, not a place: a tap navigates and the sheet is gone.
 */
export function MoreSheet(props: { lang: Lang }) {
  const location = useLocation();
  const navigate = useNavigate();

  const places: {
    href: "/rail" | "/notices";
    label: MessageKey;
    Icon: (p: IconProps) => JSX.Element;
  }[] = [
    { href: "/rail", label: "rail", Icon: TrainIcon },
    { href: "/notices", label: "notices", Icon: MegaphoneIcon },
  ];

  const go = (href: "/rail" | "/notices") => {
    sheets.closeMore();
    void navigate({ to: href });
  };

  return (
    <Drawer
      open={sheets.moreOpen()}
      onClose={() => sheets.closeMore()}
      modal
      label={t("more", props.lang)}
      class="sm:max-w-[32rem]"
    >
      <nav aria-label={t("more", props.lang)} class="py-1.5">
        <DrawerRows>
          <For each={places}>
            {(place) => (
              <MoreRow
                label={t(place.label, props.lang)}
                Icon={place.Icon}
                active={trail.owns(place.href, location().pathname)}
                onPress={() => go(place.href)}
              />
            )}
          </For>
          <MoreRow
            label={t("settings", props.lang)}
            Icon={SettingsIcon}
            active={false}
            onPress={() => sheets.openSettings()}
          />
        </DrawerRows>
      </nav>
    </Drawer>
  );
}

function MoreRow(props: {
  label: string;
  Icon: (p: IconProps) => JSX.Element;
  /** Lit while the screen behind the sheet already belongs to this row. */
  active: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onPress}
      aria-current={props.active ? "page" : undefined}
      class="app-tap flex w-full items-center gap-3 px-4 py-3 text-left"
    >
      <span
        class={[
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          props.active ? "bg-primary-muted text-primary" : "bg-secondary text-muted-foreground",
        ]}
      >
        <props.Icon size={17} />
      </span>
      <span
        class={[
          "min-w-0 grow truncate text-[0.94rem] font-bold",
          props.active ? "text-primary" : "text-foreground",
        ]}
      >
        {props.label}
      </span>
      <ChevronRightIcon size={14} class="text-faint-foreground" />
    </button>
  );
}
