import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { ReactElement } from 'react';

/**
 * One outlined family on a 24 grid, 1.7 stroke, round caps (Design system 1.0 · Iconography).
 * Filled only for the AI spark and active states. Paths are copied from the design source.
 */

type Parts = (fill: string) => ReactElement;

const ICONS = {
  home: () => <Path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  customers: () => (
    <>
      <Circle cx="9" cy="8" r="3.5" />
      <Path d="M2.5 19.5c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.6c1.8.6 3 2.2 3.5 4.9" />
    </>
  ),
  inbox: () => (
    <>
      <Path d="M3.5 13.5 6 5.5a1.5 1.5 0 0 1 1.4-1h9.2a1.5 1.5 0 0 1 1.4 1l2.5 8v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <Path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5" />
    </>
  ),
  insights: () => <Path d="M5 19v-6M12 19V5M19 19v-9" />,
  more: (f) => (
    <>
      <Circle cx="5.5" cy="12" r="1.4" fill={f} stroke="none" />
      <Circle cx="12" cy="12" r="1.4" fill={f} stroke="none" />
      <Circle cx="18.5" cy="12" r="1.4" fill={f} stroke="none" />
    </>
  ),
  radar: (f) => (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Circle cx="12" cy="12" r="4.5" />
      <Circle cx="12" cy="12" r="1.3" fill={f} stroke="none" />
    </>
  ),
  spark: (f) => <Path fill={f} stroke="none" d="M12 3c.6 4.6 3.4 7.4 8 8-4.6.6-7.4 3.4-8 8-.6-4.6-3.4-7.4-8-8 4.6-.6 7.4-3.4 8-8z" />,
  logo: (f) => (
    <Path fill={f} stroke="none" d="M12 2.5c.7 5.2 4.3 8.8 9.5 9.5-5.2.7-8.8 4.3-9.5 9.5-.7-5.2-4.3-8.8-9.5-9.5 5.2-.7 8.8-4.3 9.5-9.5z" />
  ),
  mic: () => (
    <>
      <Rect x="9" y="3" width="6" height="11" rx="3" />
      <Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  search: () => (
    <>
      <Circle cx="11" cy="11" r="6.5" />
      <Path d="m20 20-4.2-4.2" />
    </>
  ),
  message: () => <Path d="M20 11.5a8 8 0 0 1-11.8 7L4 19.5l1.1-4A8 8 0 1 1 20 11.5z" />,
  phone: () => (
    <Path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" />
  ),
  mail: () => (
    <>
      <Rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <Path d="m4 7 8 6 8-6" />
    </>
  ),
  doc: () => (
    <>
      <Path d="M7 3.5h6.5L18 8v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <Path d="M13 3.5V8h5M9 13h6M9 16.5h4" />
    </>
  ),
  card: () => (
    <>
      <Rect x="3" y="6" width="18" height="13" rx="2" />
      <Path d="M3 10h18" />
    </>
  ),
  pencil: () => <Path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />,
  clock: () => (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M12 7.5V12l3 2" />
    </>
  ),
  check: () => <Path d="m5 12.5 4.5 4.5L19 7.5" />,
  back: () => <Path d="m14.5 6-6 6 6 6" />,
  chevron: () => <Path d="m9.5 6 6 6-6 6" />,
  close: () => <Path d="M6 6l12 12M18 6 6 18" />,
  plus: () => <Path d="M12 5v14M5 12h14" />,
  bell: () => (
    <>
      <Path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <Path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  spinner: () => <Path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />,
  cloudOff: () => <Path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.5 4.5 0 0 0 7 18z" />,
  camera: () => (
    <>
      <Path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <Circle cx="12" cy="12.5" r="3.2" />
    </>
  ),
  userPlus: () => (
    <>
      <Circle cx="9" cy="8" r="3.5" />
      <Path d="M2.5 19.5c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5M19 8v6M16 11h6" />
    </>
  ),
  link: () => (
    <>
      <Path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      <Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    </>
  ),
  shield: () => <Path d="M12 3.5 19 6v5.5c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6z" />,
  shieldCheck: () => (
    <>
      <Path d="M12 3.5 19 6v5.5c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6z" />
      <Path d="m9 12 2 2 4-4" />
    </>
  ),
  plug: () => <Path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0zM12 16v5" />,
  keyboard: () => (
    <>
      <Rect x="3" y="6" width="18" height="12" rx="2" />
      <Path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
    </>
  ),
  sliders: () => (
    <>
      <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <Circle cx="16" cy="7" r="2" />
      <Circle cx="10" cy="17" r="2" />
    </>
  ),
  send: () => <Path d="M12 19V5M6 11l6-6 6 6" />,
  calendar: () => (
    <>
      <Rect x="3.5" y="5" width="17" height="15" rx="2" />
      <Path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  alert: () => (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M12 8v4.5M12 16h.01" />
    </>
  ),
  contrast: (f) => (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill={f} stroke="none" />
    </>
  ),
  instagram: (f) => (
    <>
      <Rect x="4" y="4" width="16" height="16" rx="4.5" />
      <Circle cx="12" cy="12" r="3.6" />
      <Circle cx="16.8" cy="7.2" r="1" fill={f} stroke="none" />
    </>
  ),
  rupee: () => <Path d="M7 5h10M7 9h10M10 5c3 0 5 1.6 5 4s-2 4-5 4H8l7 6" />,
  stop: (f) => <Rect x="7" y="7" width="10" height="10" rx="2.5" fill={f} stroke="none" />,
} satisfies Record<string, Parts>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  color = '#121217',
  strokeWidth = 1.7,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name](color)}
    </Svg>
  );
}
