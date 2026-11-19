import { defaultLabels, type DicomViewerLabels } from '../i18n/labels';
import type { WorkstationTool } from './gridRenderer';
import type { MprLayout } from './layouts';

/**
 * Every user-visible string of `<DicomWorkstation />`. Extends the viewer's labels, so
 * errors, series names and pane titles are shared. Pass a partial object through the
 * `labels` prop to translate or reword any of them.
 */
export interface WorkstationLabels extends Omit<DicomViewerLabels, 'tools'> {
  appTitle: string;
  menu: string;
  closeMenu: string;
  tabs: { viewer: string; map: string };
  tabList: string;
  more: string;

  // Groups
  fileGroup: string;
  layoutSelector: string;
  gridLayouts: string;
  mprLayouts: string;
  gridLayoutName: (rows: number, columns: number) => string;
  mprLayoutNames: Record<MprLayout, string>;
  cellMode: string;
  modes: { '2d': string; '3d': string };
  navigationTools: string;
  measurementTools: string;
  tools: Record<WorkstationTool, string>;
  toolShortcuts: Partial<Record<WorkstationTool, string>>;
  clearMeasurements: string;

  // Brightness and contrast
  windowGroup: string;
  presets: Record<string, string>;
  presetHint: Record<string, string>;
  presetUnavailable: string;
  customWindow: string;
  windowWidth: string;
  windowCenter: string;
  apply: string;

  // Image
  imageGroup: string;
  invert: string;
  rotateLeft: string;
  rotateRight: string;
  flipHorizontal: string;
  flipVertical: string;
  cine: string;
  play: string;
  pause: string;
  framesPerSecond: string;
  fpsValue: (fps: number) => string;

  // View
  viewGroup: string;
  syncGroup: string;
  syncScroll: string;
  syncZoomPan: string;
  syncWindowLevel: string;
  referenceLines: string;
  overlay: string;
  patientInfo: string;
  fullscreen: string;
  exitFullscreen: string;
  exportImage: string;
  exportFileName: (seriesNumber?: number) => string;
  closeCell: string;
  emptyCell: string;
  emptyCellHint: string;
  dropSeriesHint: string;
  activeCell: (index: number) => string;
  cellRegion: (index: number) => string;

  // Overlay
  overlayImage: (index: number, count: number) => string;
  overlayThickness: (value: string) => string;
  overlayLocation: (value: string) => string;
  overlayRotation: (degrees: number) => string;
  overlayFlipped: string;
  overlayInverted: string;

  // Map tab
  mapHeading: string;
  mapSource: (seriesLabel: string, image: number, count: number) => string;
  mapNoImage: string;
  mapSearch: string;
  mapSearchPlaceholder: string;
  mapLoading: string;
  mapFailed: string;
  mapColumns: { tag: string; name: string; vr: string; value: string };
  mapCount: (shown: number, total: number) => string;
  mapItem: (index: number) => string;
  mapExpandAll: string;
  mapCollapseAll: string;
  mapCopy: string;
  mapCopied: string;
  mapExportJson: string;
  mapHidePrivate: string;
  mapRedacted: string;
  mapInstance: string;
  mapPrivacyNote: string;
  mapNoMatches: string;
}

export const defaultWorkstationLabels: WorkstationLabels = {
  ...defaultLabels,
  appTitle: 'DICOM Viewer',
  menu: 'Menu',
  closeMenu: 'Close menu',
  tabs: { viewer: 'Viewer', map: 'Map' },
  tabList: 'Views',
  more: 'More',

  fileGroup: 'Files',
  layoutSelector: 'Layout',
  gridLayouts: 'Viewport grid',
  mprLayouts: '3D arrangement',
  gridLayoutName: (rows, columns) => `${rows} × ${columns}`,
  mprLayoutNames: {
    grid: '2 × 2 (planes + 3D)',
    axialPrimary: 'Axial large',
    volumePrimary: '3D large',
    planes: '3 planes',
    axial: 'Axial only',
    sagittal: 'Sagittal only',
    coronal: 'Coronal only',
    volume: '3D only',
  },
  cellMode: 'Viewport mode',
  modes: { '2d': '2D', '3d': '3D / MPR' },
  navigationTools: 'Tools',
  measurementTools: 'Measure',
  tools: {
    windowLevel: 'Window/level',
    pan: 'Pan',
    zoom: 'Zoom',
    scroll: 'Scroll',
    magnify: 'Magnify',
    crosshairs: 'Crosshairs',
    length: 'Length',
    angle: 'Angle',
    cobbAngle: 'Cobb angle',
    bidirectional: 'Bidirectional',
    rectangleRoi: 'Rectangle ROI',
    ellipticalRoi: 'Ellipse ROI',
    probe: 'Probe',
    arrow: 'Arrow note',
    eraser: 'Eraser',
  },
  toolShortcuts: { windowLevel: 'W', pan: 'P', zoom: 'Z', scroll: 'S', crosshairs: 'C', length: 'L', angle: 'A', magnify: 'M', eraser: 'E' },
  clearMeasurements: 'Clear measurements',

  windowGroup: 'Brightness & contrast',
  presets: {
    auto: 'Auto',
    default: 'Default',
    softTissue: 'Soft tissue',
    lung: 'Lungs',
    bone: 'Bones',
    brain: 'Brain',
    abdomen: 'Abdomen',
    mediastinum: 'Mediastinum',
    dental: 'Teeth',
    liver: 'Liver',
    stroke: 'Stroke',
    subdural: 'Subdural',
    angio: 'Angio',
    temporalBone: 'Temporal bone',
  },
  presetHint: {
    auto: 'Spreads the visible tissue over the full grey range',
    default: 'The window stored in the file',
  },
  presetUnavailable: 'Needs a CT image (Hounsfield units)',
  customWindow: 'Custom window',
  windowWidth: 'Width',
  windowCenter: 'Level',
  apply: 'Apply',

  imageGroup: 'Image',
  invert: 'Invert',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  flipHorizontal: 'Flip horizontal',
  flipVertical: 'Flip vertical',
  cine: 'Cine',
  play: 'Play',
  pause: 'Pause',
  framesPerSecond: 'Frames per second',
  fpsValue: (fps) => `${fps} fps`,

  viewGroup: 'View',
  syncGroup: 'Link viewports',
  syncScroll: 'Link scrolling',
  syncZoomPan: 'Link zoom & pan',
  syncWindowLevel: 'Link window/level',
  referenceLines: 'Reference lines',
  overlay: 'Image information',
  patientInfo: 'Show patient details',
  fullscreen: 'Full screen',
  exitFullscreen: 'Exit full screen',
  exportImage: 'Save as PNG',
  exportFileName: (seriesNumber) => `dicom-image${seriesNumber !== undefined ? `-series-${seriesNumber}` : ''}.png`,
  closeCell: 'Close viewport',
  emptyCell: 'Empty viewport',
  emptyCellHint: 'Select a series to show it here.',
  dropSeriesHint: 'Drop to show this series here',
  activeCell: (index) => `Viewport ${index} (active)`,
  cellRegion: (index) => `Viewport ${index}`,

  overlayImage: (index, count) => `Im ${index}/${count}`,
  overlayThickness: (value) => `Thk ${Number.parseFloat(value).toFixed(2)} mm`,
  overlayLocation: (value) => `Loc ${Number.parseFloat(value).toFixed(2)} mm`,
  overlayRotation: (degrees) => `Rot ${degrees}°`,
  overlayFlipped: 'Flipped',
  overlayInverted: 'Inverted',

  mapHeading: 'DICOM tag map',
  mapSource: (seriesLabel, image, count) => `${seriesLabel} · image ${image} of ${count}`,
  mapNoImage: 'Open a series to see its DICOM tags. The map shows the image in the active viewport.',
  mapSearch: 'Search tags',
  mapSearchPlaceholder: 'Search by name, tag, VR or value',
  mapLoading: 'Reading tags…',
  mapFailed: 'The tags of this file could not be read.',
  mapColumns: { tag: 'Tag', name: 'Name', vr: 'VR', value: 'Value' },
  mapCount: (shown, total) => (shown === total ? `${total} attributes` : `${shown} of ${total} attributes`),
  mapItem: (index) => `Item ${index}`,
  mapExpandAll: 'Expand all',
  mapCollapseAll: 'Collapse all',
  mapCopy: 'Copy',
  mapCopied: 'Copied',
  mapExportJson: 'Export JSON',
  mapHidePrivate: 'Hide private tags',
  mapRedacted: 'Hidden',
  mapInstance: 'File',
  mapPrivacyNote: 'Tags are read in this browser from the local file.',
  mapNoMatches: 'No attributes match the search.',
};

export function resolveWorkstationLabels(overrides?: Partial<WorkstationLabels>): WorkstationLabels {
  if (!overrides) return defaultWorkstationLabels;
  const base = defaultWorkstationLabels;
  return {
    ...base,
    ...overrides,
    skippedReasons: { ...base.skippedReasons, ...overrides.skippedReasons },
    errors: { ...base.errors, ...overrides.errors },
    tools: { ...base.tools, ...overrides.tools },
    toolShortcuts: { ...base.toolShortcuts, ...overrides.toolShortcuts },
    layouts: { ...base.layouts, ...overrides.layouts },
    views: { ...base.views, ...overrides.views },
    volumeUnsupportedReasons: { ...base.volumeUnsupportedReasons, ...overrides.volumeUnsupportedReasons },
    tabs: { ...base.tabs, ...overrides.tabs },
    mprLayoutNames: { ...base.mprLayoutNames, ...overrides.mprLayoutNames },
    modes: { ...base.modes, ...overrides.modes },
    presets: { ...base.presets, ...overrides.presets },
    presetHint: { ...base.presetHint, ...overrides.presetHint },
    mapColumns: { ...base.mapColumns, ...overrides.mapColumns },
  };
}
