/**
 * The app's own mark, the same drawing as the home-screen icon.
 *
 * It is kept apart from `BusIcon`, which is a control in the tab bar: a logo
 * that is also a button says nothing particular. This one is only ever
 * identity - a splash, an about line - and never something to press.
 *
 * The tile is ink, so on the app's dark background it would otherwise be a
 * black square on a black page. A hairline ring gives it an edge to stand on
 * without lightening the tile itself.
 */
export function AppMark(props: { size?: number; class?: string }) {
  const size = () => props.size ?? 64;

  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 512 512"
      class={props.class}
      role="img"
      aria-label="ProBus HK"
    >
      <rect width="512" height="512" rx="112" fill="#09090b" />
      <rect
        x="4"
        y="4"
        width="504"
        height="504"
        rx="108"
        fill="none"
        stroke="var(--border)"
        stroke-width="8"
      />
      <g fill="none" stroke="#f9fafe" stroke-width="34" stroke-linecap="round">
        <rect x="140" y="112" width="232" height="222" rx="60" />
        <path d="M132 212 H380" />
        <path d="M180 350 V396" />
        <path d="M332 350 V396" />
      </g>
      <circle cx="200" cy="282" r="25" fill="#f9fafe" />
      <circle cx="312" cy="282" r="25" fill="#f9fafe" />
    </svg>
  );
}
