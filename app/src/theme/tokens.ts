/**
 * Nudge design tokens — taken 1:1 from "Design system 1.0" (docs/design/source/00_Foundations.html
 * and 01_Components_and_states.html). One accent (indigo) reserved for AI + focus; primary actions are ink.
 */

export type ColorScheme = 'light' | 'dark';

export type Palette = {
  bg: string;
  bg2: string;
  card: string;
  glass: string;
  glassBorder: string;
  line: string;
  line2: string;
  t1: string;
  t2: string;
  t3: string;
  acc: string;
  onAcc: string;
  accText: string;
  accWash: string;
  accWash2: string;
  ok: string;
  okDot: string;
  okWash: string;
  warn: string;
  warnDot: string;
  warnWash: string;
  bad: string;
  badDot: string;
  badWash: string;
  inv: string;
  onInv: string;
  scrim: string;
  skeletonHi: string;
  tabGlass: string;
  tabEdge: string;
  tabOff: string;
  tabActiveFill: string;
  aiBorder: string;
};

export const light: Palette = {
  bg: '#F5F4F0',
  bg2: '#ECEBE6',
  card: '#FFFFFF',
  glass: 'rgba(255,255,255,0.68)',
  glassBorder: 'rgba(255,255,255,0.85)',
  line: 'rgba(20,20,28,0.07)',
  line2: 'rgba(20,20,28,0.12)',
  t1: '#121217',
  t2: '#52525C',
  t3: '#696973',
  acc: '#4B47E0',
  onAcc: '#FFFFFF',
  accText: '#3E3AC8',
  accWash: 'rgba(75,71,224,0.07)',
  accWash2: 'rgba(75,71,224,0.14)',
  ok: '#2C7A50',
  okDot: '#3AA36B',
  okWash: 'rgba(58,163,107,0.12)',
  warn: '#94570B',
  warnDot: '#E09B32',
  warnWash: 'rgba(224,155,50,0.14)',
  bad: '#B03A30',
  badDot: '#D5554A',
  badWash: 'rgba(213,85,74,0.10)',
  inv: '#121217',
  onInv: '#FFFFFF',
  scrim: 'rgba(20,20,28,0.22)',
  skeletonHi: '#F4F3EF',
  tabGlass: 'rgba(255,255,255,0.72)',
  tabEdge: 'rgba(255,255,255,0.9)',
  tabOff: '#6A6A74',
  tabActiveFill: 'rgba(75,71,224,0.12)',
  aiBorder: 'rgba(255,255,255,0.85)',
};

export const dark: Palette = {
  bg: '#0B0B0E',
  bg2: '#1B1B21',
  card: '#16161B',
  glass: 'rgba(30,30,37,0.66)',
  glassBorder: 'rgba(255,255,255,0.09)',
  line: 'rgba(255,255,255,0.07)',
  line2: 'rgba(255,255,255,0.13)',
  t1: '#F3F3F5',
  t2: '#A6A6B0',
  t3: '#8E8E98',
  acc: '#7F7BFF',
  onAcc: '#0B0B14',
  accText: '#A6A3FF',
  accWash: 'rgba(127,123,255,0.11)',
  accWash2: 'rgba(127,123,255,0.22)',
  ok: '#6FD39C',
  okDot: '#5BC48A',
  okWash: 'rgba(91,196,138,0.13)',
  warn: '#F0BE63',
  warnDot: '#E8B04F',
  warnWash: 'rgba(232,176,79,0.14)',
  bad: '#F48A80',
  badDot: '#F0786D',
  badWash: 'rgba(240,120,109,0.13)',
  inv: '#F3F3F5',
  onInv: '#0B0B0E',
  scrim: 'rgba(0,0,0,0.55)',
  skeletonHi: '#24242B',
  tabGlass: 'rgba(28,28,34,0.72)',
  tabEdge: 'rgba(255,255,255,0.09)',
  tabOff: '#8C8C96',
  tabActiveFill: 'rgba(127,123,255,0.18)',
  aiBorder: 'rgba(127,123,255,0.18)',
};

/** Six muted avatar tints, assigned by name hash. */
export const avatarTints: Record<ColorScheme, { bg: string; fg: string }[]> = {
  light: [
    { bg: '#E7E6FB', fg: '#3E3AC8' },
    { bg: '#F5E6D3', fg: '#86480E' },
    { bg: '#DCEEE3', fg: '#246A43' },
    { bg: '#F6DEDB', fg: '#9A3128' },
    { bg: '#DFE9F4', fg: '#285C88' },
    { bg: '#ECE4F2', fg: '#6A3D86' },
  ],
  dark: [
    { bg: 'rgba(127,123,255,0.2)', fg: '#C3C1FF' },
    { bg: 'rgba(232,176,79,0.18)', fg: '#F2C980' },
    { bg: 'rgba(91,196,138,0.18)', fg: '#94DDB5' },
    { bg: 'rgba(240,120,109,0.18)', fg: '#F6B1AA' },
    { bg: 'rgba(110,168,230,0.18)', fg: '#A9CCF2' },
    { bg: 'rgba(190,140,230,0.18)', fg: '#D8B9F0' },
  ],
};

/** 4-pt spacing scale. Screen gutter 20, card padding 16–20, section gap 28. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 10: 40, 14: 56 } as const;
export const gutter = 20;

export const radius = { tag: 8, input: 16, btn: 14, card: 20, aiCard: 22, sheet: 32, pill: 999 } as const;

export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
} as const;

/** Type ramp. letterSpacing is converted from em to px. */
export const type = {
  display: { fontFamily: fonts.semibold, fontSize: 34, lineHeight: 40, letterSpacing: -1.02 },
  h1: { fontFamily: fonts.semibold, fontSize: 32, lineHeight: 38, letterSpacing: -0.96 },
  section: { fontFamily: fonts.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.53 },
  h2: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.48 },
  h3: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  t: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  s: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19 },
  meta: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 16 },
  cap: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  label: { fontFamily: fonts.medium, fontSize: 10.5, lineHeight: 12 },
} as const;

export type TypeVariant = keyof typeof type;

/** Motion — calm, fast, no bounce. Standard easing cubic-bezier(.2,.8,.2,1). */
export const motion = {
  tap: 120,
  nav: 220,
  customerAdded: 240,
  promiseCheck: 180,
  promiseCollapse: 260,
  aiPulse: 1600,
  skeleton: 1400,
  reduced: 150,
  easing: [0.2, 0.8, 0.2, 1] as const,
};
