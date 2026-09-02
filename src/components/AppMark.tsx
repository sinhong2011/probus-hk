/**
 * The app's own mark, the same drawing as the home-screen icon.
 *
 * It is kept apart from `BusIcon`, which is a control in the tab bar: a logo
 * that is also a button says nothing particular. This one is only ever
 * identity - a splash, an about line - and never something to press.
 */
export function AppMark(props: { size?: number; class?: string }) {
  const size = () => props.size ?? 64;

  return (
    <img
      src="/icons/logo.png"
      width={size()}
      height={size()}
      alt="ProBus HK"
      class={props.class}
      decoding="async"
    />
  );
}
