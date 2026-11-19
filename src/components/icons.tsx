// DROP shared thin-line icon set — drawn SVG only, never platform emoji.
// Every icon: 24x24 viewBox, 1.5px stroke, round caps/joins, currentColor,
// 22px default size. `filled` renders a solid mark; Fire fills in DROP
// rose (#D92D5E), the droplet fills solid ink (currentColor).

import type { ReactNode } from 'react';
import { useId } from 'react';

export type IconProps = {
  size?: number;
  filled?: boolean;
  className?: string;
};

const DROP_ROSE = '#D92D5E';

function Svg({ size = 22, filled = false, className, fill, children }: IconProps & {
  fill?: string;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? (fill ?? 'currentColor') : 'none'}
      stroke={filled ? (fill ?? 'currentColor') : 'currentColor'}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'middle', flex: 'none' }}
    >
      {children}
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </Svg>
  );
}

export function IconReels(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
      <path d="m6.2 5.3 3.1 3.9" />
      <path d="m12.4 3.4 3.1 3.9" />
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Svg>
  );
}

export function IconDrop(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
    </Svg>
  );
}

// LogoDrop — the approved gradient-swirl droplet brand mark (see the
// approved Home reference images). This is a FILLED gradient mark, not
// the thin-line IconDrop nav icon above (which stays exactly as-is as
// the DROP Hub nav icon). Sampled from the reference: magenta/pink at
// the top, purple through the middle, orange along the left edge, cyan
// at the bottom, with a teardrop cut out of the centre so the
// background shows through (mask, so it works on light and dark
// surfaces). Gradient ids are per-instance (useId) so the mark can be
// used twice on one page (header + desktop rail) without id clashes.
export function LogoDrop({ size = 28, className }: IconProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const swirl = `drop-swirl-${uid}`;
  const edge = `drop-edge-${uid}`;
  const clip = `drop-clip-${uid}`;
  const hole = `drop-hole-${uid}`;
  const outer = 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z';
  const inner = 'M12 7.5C11.4 9.4 10.2 10.6 9 11.6 7.7 12.7 7.4 13.9 7.4 14.6A4.6 4.6 0 0 0 12 19.2 4.6 4.6 0 0 0 16.6 14.6C16.6 13.9 16.3 12.7 15 11.6 13.8 10.6 12.6 9.4 12 7.5Z';
  // Orange sliver down the droplet's left edge (clipped to the droplet).
  const leftEdge = 'M12 2C11 5 8.5 7.5 7 9.5 5.5 11.8 5 13.2 5 15A7 7 0 0 0 9.5 21.5C7.8 19 7 16.5 7.6 13.8 8.3 10.8 10.2 6.5 12 2Z';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'middle', flex: 'none' }}
    >
      <defs>
        <linearGradient id={swirl} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#FF2E9A" />
          <stop offset="35%" stopColor="#8B2FF7" />
          <stop offset="65%" stopColor="#3D7BFA" />
          <stop offset="100%" stopColor="#00D9C0" />
        </linearGradient>
        <linearGradient id={edge} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFB300" />
          <stop offset="45%" stopColor="#FF6A00" />
          <stop offset="100%" stopColor="#FF2E9A" />
        </linearGradient>
        <clipPath id={clip}>
          <path d={outer} />
        </clipPath>
        <mask id={hole}>
          <rect x="0" y="0" width="24" height="24" fill="#fff" />
          <path d={inner} fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${hole})`}>
        <path d={outer} fill={`url(#${swirl})`} />
        <path d={leftEdge} fill={`url(#${edge})`} clipPath={`url(#${clip})`} />
      </g>
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

export function IconProfile(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Svg>
  );
}

export function IconMessages(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </Svg>
  );
}

export function IconComment(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </Svg>
  );
}

// Fire — the DROP flame brand mark. Outline by default; `filled` renders
// a solid flame in DROP rose. Used for the Fire action and the 64px
// double-tap Fire burst.
export function IconFire({ size, filled, className }: IconProps) {
  return (
    <Svg size={size} filled={filled} fill={DROP_ROSE} className={className}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </Svg>
  );
}

export function IconShare(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="m16 6-4-4-4 4" />
      <path d="M12 2v13" />
    </Svg>
  );
}

export function IconSend(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </Svg>
  );
}

export function IconSave(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

// Solid presence dot — always filled, inherits the surrounding text color
// (wrap in a green span for the "active" state).
export function IconPresenceDot({ size = 10, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'middle', flex: 'none' }}
    >
      <circle cx="12" cy="12" r="7" />
    </svg>
  );
}

export function IconEye(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function IconLocationPin(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </Svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </Svg>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </Svg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </Svg>
  );
}

export function IconFilm(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2" width="20" height="20" rx="2.18" />
      <path d="M7 2v20" />
      <path d="M17 2v20" />
      <path d="M2 12h20" />
      <path d="M2 7h5" />
      <path d="M2 17h5" />
      <path d="M17 17h5" />
      <path d="M17 7h5" />
    </Svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 4 14 8-14 8V4z" />
    </Svg>
  );
}

export function IconReplay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </Svg>
  );
}

export function IconMore(props: IconProps) {
  const { size = 22, className } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'middle', flex: 'none' }}
    >
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Svg>
  );
}

export function IconImage(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </Svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </Svg>
  );
}

export function IconGear(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

// Room-identity mask mark (replaces the theatre-masks emoji).
export function IconMask(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3c-4 0-7 1.5-8 4-.6 1.6-.5 3.5.3 5.2.9 2 2.5 3.6 4.5 4.5 1 .5 2 .8 3.2.8s2.2-.3 3.2-.8c2-.9 3.6-2.5 4.5-4.5.8-1.7.9-3.6.3-5.2-1-2.5-4-4-8-4z" />
      <path d="M8 10.5c.7-.7 1.6-.7 2.3 0" />
      <path d="M13.7 10.5c.7-.7 1.6-.7 2.3 0" />
      <path d="M9.5 14.5c.7.6 1.5.9 2.5.9s1.8-.3 2.5-.9" />
    </Svg>
  );
}
