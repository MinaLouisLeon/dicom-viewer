import type { ReactElement } from 'react';

/** 24×24 outline icons, drawn with `currentColor`. */
const PATHS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  layout: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  contrast: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
  pan: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  zoom: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6',
  scroll: 'M8 7l4-4 4 4M8 17l4 4 4-4M12 3v18',
  magnify: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-6-6M7 10h6',
  crosshairs: 'M12 2v6M12 16v6M2 12h6M16 12h6M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  angle: 'M4 20h16M4 20L16 6M9 20a5 5 0 0 0-1.5-3.6',
  cobb: 'M4 6l16 3M4 18l16-3M8 7l-2 10',
  bidirectional: 'M4 12h16M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3M12 6v12',
  rectangle: 'M4 6h16v12H4z',
  ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  probe: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  arrow: 'M5 19L19 5M19 5h-8M19 5v8',
  eraser: 'M7 21h10M5 15l9-9 5 5-9 9H7zM10 10l5 5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  invert: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18',
  rotateLeft: 'M4 4v5h5M4.5 9A8 8 0 1 1 6 16.5',
  rotateRight: 'M20 4v5h-5M19.5 9A8 8 0 1 0 18 16.5',
  flipH: 'M12 3v18M8 7L3 12l5 5zM16 7l5 5-5 5z',
  flipV: 'M3 12h18M7 8l5-5 5 5zM7 16l5 5 5-5z',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  lines: 'M3 8h18M3 16h18M8 3v18',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
  download: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  exitFullscreen: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  reset: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
  series: 'M4 5h16M4 12h16M4 19h10',
  map: 'M4 5h4M4 12h4M4 19h4M11 5h9M11 12h9M11 19h9',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  wand: 'M5 19L15 9M14 4v2M19 9h2M17 5l1.5-1.5M10 5l1 1M18 13l1 1',
  tool: 'M14 6l4 4-9 9H5v-4zM12 8l4 4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }): ReactElement {
  return (
    <svg
      className="mihawk-ws-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export const TOOL_ICONS: Record<string, IconName> = {
  windowLevel: 'contrast',
  pan: 'pan',
  zoom: 'zoom',
  scroll: 'scroll',
  magnify: 'magnify',
  crosshairs: 'crosshairs',
  length: 'ruler',
  angle: 'angle',
  cobbAngle: 'cobb',
  bidirectional: 'bidirectional',
  rectangleRoi: 'rectangle',
  ellipticalRoi: 'ellipse',
  probe: 'probe',
  arrow: 'arrow',
  eraser: 'eraser',
};
