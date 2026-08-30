import type { JSX } from "@solidjs/web";
import { Drawer, DrawerHeader } from "./Drawer";
import { type Lang, t } from "~/lib/i18n";

/**
 * A dialog: a drawer that covers the page.
 *
 * Reference material - a timetable, a full stop list - does not belong inline.
 * Opening it there pushed the page it was attached to out from under the
 * reader, and inside a sticky column it had nowhere to go at all.
 *
 * It was a sheet that faded in and out; it is now the same drawer the map
 * uses, in its modal form - a scrim, focus held inside, Escape to leave, and a
 * handle that can be pulled to put it away. One kind of sheet across the app,
 * so a gesture learned on one works on all of them.
 */
export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  lang: Lang;
  children: JSX.Element;
}) {
  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      modal
      label={props.title}
      class="sm:max-w-[32rem]"
    >
      <DrawerHeader
        title={props.title}
        onClose={props.onClose}
        closeLabel={t("close", props.lang)}
      />
      <div class="px-4 pb-4">{props.children}</div>
    </Drawer>
  );
}
