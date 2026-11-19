/**
 * Brightness and contrast (window/level) presets.
 *
 * `auto` and `default` are computed per image. The fixed presets are in Hounsfield
 * units, so they only make sense for calibrated CT (and most CBCT exports that store HU).
 */
export interface WindowValue {
  /** Window width (contrast). */
  width: number;
  /** Window center (brightness). */
  center: number;
}

export interface WindowPreset {
  id: string;
  /** Fixed window. Absent for computed presets (`auto`, `default`). */
  window?: WindowValue;
  /** Modalities the preset applies to. Undefined means every modality. */
  modalities?: readonly string[];
  /** Keyboard digit that applies the preset (1–9). */
  shortcut?: string;
}

const CT = ['CT'] as const;

/** Built-in presets, in menu order. Labels come from `labels.presets[id]`. */
export const DEFAULT_WINDOW_PRESETS: readonly WindowPreset[] = [
  { id: 'auto', shortcut: '1' },
  { id: 'default', shortcut: '2' },
  { id: 'softTissue', window: { width: 400, center: 40 }, modalities: CT, shortcut: '3' },
  { id: 'lung', window: { width: 1500, center: -600 }, modalities: CT, shortcut: '4' },
  { id: 'bone', window: { width: 2000, center: 500 }, modalities: CT, shortcut: '5' },
  { id: 'brain', window: { width: 80, center: 40 }, modalities: CT, shortcut: '6' },
  { id: 'abdomen', window: { width: 350, center: 50 }, modalities: CT, shortcut: '7' },
  { id: 'mediastinum', window: { width: 350, center: 40 }, modalities: CT, shortcut: '8' },
  { id: 'dental', window: { width: 3000, center: 1000 }, modalities: CT, shortcut: '9' },
  { id: 'liver', window: { width: 150, center: 30 }, modalities: CT },
  { id: 'stroke', window: { width: 40, center: 40 }, modalities: CT },
  { id: 'subdural', window: { width: 215, center: 75 }, modalities: CT },
  { id: 'angio', window: { width: 600, center: 170 }, modalities: CT },
  { id: 'temporalBone', window: { width: 2800, center: 600 }, modalities: CT },
];

/** True when the preset can be applied to an image of `modality`. */
export function presetApplies(preset: WindowPreset, modality: string | undefined): boolean {
  if (!preset.modalities) return true;
  return modality !== undefined && preset.modalities.includes(modality.toUpperCase());
}

export interface AutoWindowOptions {
  /** Lower percentile of the value distribution mapped to black. @default 0.5 */
  lowPercentile?: number;
  /** Upper percentile mapped to white. @default 99.5 */
  highPercentile?: number;
  /** Values at or below this are treated as background (for example air outside the field of view). */
  ignoreBelow?: number;
  /** Maximum number of samples read from `values`. @default 262144 */
  maxSamples?: number;
}

/**
 * Picks a window that spreads the visible tissue over the full grey range: it maps
 * the low and high percentiles of the (sampled) pixel values to black and white.
 * Background is dropped first: the most common value at either end of the range
 * (padding, air or collimation) usually takes up much of the image.
 *
 * `values` are modality values (stored value × slope + intercept). Returns undefined
 * when there is nothing to measure.
 */
export function computeAutoWindow(
  values: ArrayLike<number>,
  options: AutoWindowOptions = {},
): WindowValue | undefined {
  const { lowPercentile = 0.5, highPercentile = 99.5, ignoreBelow, maxSamples = 262_144 } = options;
  const length = values.length;
  if (length === 0) return undefined;
  const stride = Math.max(1, Math.floor(length / maxSamples));
  const samples: number[] = [];
  for (let index = 0; index < length; index += stride) {
    const value = values[index]!;
    if (!Number.isFinite(value)) continue;
    if (ignoreBelow !== undefined && value <= ignoreBelow) continue;
    samples.push(value);
  }
  if (samples.length === 0) return undefined;
  samples.sort((a, b) => a - b);

  // Drop a dominant background value at either end (≥ 20% of the samples).
  let start = 0;
  let end = samples.length;
  const dominant = samples.length * 0.2;
  const min = samples[0]!;
  const max = samples[samples.length - 1]!;
  let minCount = 0;
  while (minCount < samples.length && samples[minCount] === min) minCount += 1;
  let maxCount = 0;
  while (maxCount < samples.length && samples[samples.length - 1 - maxCount] === max) maxCount += 1;
  if (minCount >= dominant && minCount < samples.length) start = minCount;
  if (maxCount >= dominant && end - maxCount > start) end -= maxCount;

  const span = end - start;
  const at = (percentile: number) =>
    samples[start + Math.min(span - 1, Math.max(0, Math.round(((span - 1) * percentile) / 100)))]!;
  let low = at(lowPercentile);
  let high = at(highPercentile);
  if (high <= low) {
    // A flat image: centre a small window on its value.
    low -= 1;
    high += 1;
  }
  return { width: high - low, center: (high + low) / 2 };
}

/**
 * Auto settings per modality. For CT (Hounsfield units) air and lung (below −500 HU)
 * are left out and the 5th–95th percentiles are used, which lands near a soft-tissue
 * window that adapts to each image. Other modalities use the generic defaults.
 */
export function autoWindowOptionsFor(modality: string | undefined): AutoWindowOptions {
  if (modality?.toUpperCase() === 'CT') return { lowPercentile: 5, highPercentile: 95, ignoreBelow: -500 };
  return {};
}

/** Converts a window to the lower and upper values it maps to black and white. */
export function windowToRange({ width, center }: WindowValue): { lower: number; upper: number } {
  return { lower: center - width / 2, upper: center + width / 2 };
}

/** Converts a value range back to a window. */
export function rangeToWindow(lower: number, upper: number): WindowValue {
  return { width: upper - lower, center: (upper + lower) / 2 };
}
