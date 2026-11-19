import type { DataSet, Element } from 'dicom-parser';

import { readHeaderDataSet, type ReadRange } from './dicomHeader';
import { formatTag, isPrivateTag, lookupTag, normalizeTag } from './tagDictionary';

/** One attribute in the tag map. Sequences carry their items as nested lists. */
export interface TagNode {
  /** `(gggg,eeee)`. */
  tag: string;
  name: string;
  vr: string;
  /** Value length in bytes (undefined for undefined-length sequences). */
  length?: number;
  /** Display value. Binary values are summarised, not dumped. */
  value: string;
  isPrivate: boolean;
  /** True when the value was hidden because it identifies the patient. */
  redacted?: boolean;
  /** Present for sequences (SQ): one array of nodes per item. */
  items?: TagNode[][];
}

export interface TagMapOptions {
  signal?: AbortSignal;
  readRange?: ReadRange;
  /** Hide the values of attributes that identify the patient. */
  redactPatientData?: boolean;
  /** Maximum number of values shown for multi-valued attributes. @default 32 */
  maxValues?: number;
}

/**
 * Attributes whose values identify the patient or the people involved (DICOM PS3.15
 * basic profile, abridged). Used for redaction in the tag map and the image overlay.
 */
export const PATIENT_IDENTIFYING_TAGS: ReadonlySet<string> = new Set([
  '00080050', '00080080', '00080081', '00080090', '00080092', '00080094', '00081010', '00081040', '00081048',
  '00081050', '00081060', '00081070', '00100010', '00100020', '00100021', '00100030', '00100032', '00100040',
  '00101000', '00101001', '00101010', '00101020', '00101030', '00101040', '00102160', '00102180', '001021B0',
  '00104000', '00200010', '00321032', '00380010', '00181000',
]);

const STRING_VRS = new Set(['AE', 'AS', 'CS', 'DA', 'DS', 'DT', 'IS', 'LO', 'PN', 'SH', 'TM', 'UI', 'UC', 'UR']);
const TEXT_VRS = new Set(['LT', 'ST', 'UT']);
const PIXEL_DATA = '7FE00010';
const REDACTED = '•••';

function vrOf(tag: string, element: Element): string {
  if (element.vr) return element.vr;
  if (element.items) return 'SQ';
  return lookupTag(tag)?.vr ?? 'UN';
}

function hexBytes(dataSet: DataSet, element: Element, max = 16): string {
  const bytes = dataSet.byteArray.subarray(element.dataOffset, element.dataOffset + Math.min(element.length, max));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
  return element.length > max ? `${hex} …` : hex;
}

function isPrintable(dataSet: DataSet, element: Element): boolean {
  if (element.length === 0 || element.length > 1024) return false;
  const end = element.dataOffset + element.length;
  if (end > dataSet.byteArray.length) return false;
  for (let index = element.dataOffset; index < end; index += 1) {
    const byte = dataSet.byteArray[index]!;
    if (byte !== 0 && (byte < 0x20 || byte > 0x7e) && byte !== 0x0a && byte !== 0x0d && byte !== 0x09) return false;
  }
  return true;
}

function numbers(count: number, read: (index: number) => number, maxValues: number): string {
  const shown = Math.min(count, maxValues);
  const values: string[] = [];
  for (let index = 0; index < shown; index += 1) {
    const value = read(index);
    values.push(Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(8))));
  }
  return count > shown ? `${values.join('\\')} … (${count} values)` : values.join('\\');
}

function formatValue(dataSet: DataSet, tagKey: string, element: Element, vr: string, maxValues: number): string {
  const hex = normalizeTag(tagKey);
  if (hex === PIXEL_DATA) {
    const fragments = element.fragments?.length;
    if (fragments) return `<encapsulated pixel data, ${fragments} fragment${fragments === 1 ? '' : 's'}>`;
    return element.length ? `<pixel data, ${element.length} bytes>` : '<pixel data>';
  }
  if (element.length === 0) return '';
  if (element.dataOffset + element.length > dataSet.byteArray.length) return '<not read>';
  const length = element.length;
  try {
    if (STRING_VRS.has(vr)) return dataSet.string(tagKey)?.trim() ?? '';
    if (TEXT_VRS.has(vr)) return dataSet.text(tagKey)?.trim() ?? '';
    switch (vr) {
      case 'US':
        return numbers(length / 2, (index) => dataSet.uint16(tagKey, index) ?? 0, maxValues);
      case 'SS':
        return numbers(length / 2, (index) => dataSet.int16(tagKey, index) ?? 0, maxValues);
      case 'UL':
        return numbers(length / 4, (index) => dataSet.uint32(tagKey, index) ?? 0, maxValues);
      case 'SL':
        return numbers(length / 4, (index) => dataSet.int32(tagKey, index) ?? 0, maxValues);
      case 'FL':
        return numbers(length / 4, (index) => dataSet.float(tagKey, index) ?? 0, maxValues);
      case 'FD':
        return numbers(length / 8, (index) => dataSet.double(tagKey, index) ?? 0, maxValues);
      case 'AT': {
        const values: string[] = [];
        for (let index = 0; index < length / 4 && index < maxValues; index += 1) {
          const group = dataSet.uint16(tagKey, index * 2) ?? 0;
          const elementNumber = dataSet.uint16(tagKey, index * 2 + 1) ?? 0;
          values.push(formatTag(group.toString(16).padStart(4, '0') + elementNumber.toString(16).padStart(4, '0')));
        }
        return values.join('\\');
      }
      default:
        // OB, OW, OF, OD, UN and unknown implicit-VR values.
        if (vr === 'UN' && isPrintable(dataSet, element)) return dataSet.string(tagKey)?.trim() ?? '';
        return `<${length} bytes> ${hexBytes(dataSet, element)}`;
    }
  } catch {
    return '<unreadable>';
  }
}

/** Converts a parsed data set into tag map nodes, in tag order. */
export function dataSetToNodes(dataSet: DataSet, options: Pick<TagMapOptions, 'redactPatientData' | 'maxValues'> = {}): TagNode[] {
  const { redactPatientData = false, maxValues = 32 } = options;
  const keys = Object.keys(dataSet.elements).sort();
  return keys.map((key) => {
    const element = dataSet.elements[key]!;
    const hex = normalizeTag(key);
    const vr = vrOf(hex, element);
    const definition = lookupTag(hex);
    const isPrivate = isPrivateTag(hex);
    const node: TagNode = {
      tag: formatTag(hex),
      name: definition?.name ?? (isPrivate ? 'Private Tag' : 'Unknown Tag'),
      vr,
      length: element.hadUndefinedLength ? undefined : element.length,
      value: '',
      isPrivate,
    };
    if (vr === 'SQ' || element.items) {
      node.items = (element.items ?? []).map((item) => (item.dataSet ? dataSetToNodes(item.dataSet, options) : []));
      node.value = `${node.items.length} item${node.items.length === 1 ? '' : 's'}`;
      return node;
    }
    if (redactPatientData && PATIENT_IDENTIFYING_TAGS.has(hex)) {
      node.value = REDACTED;
      node.redacted = true;
      return node;
    }
    node.value = formatValue(dataSet, key, element, vr, maxValues);
    return node;
  });
}

const vrCallback = (tag: string): string => lookupTag(tag)?.vr ?? 'UN';

/**
 * Reads every attribute of a local DICOM file up to Pixel Data, for the tag map.
 * Rejects with `Error('NOT_DICOM')` when the file is not DICOM Part 10.
 */
export async function readTagMap(file: Blob, options: TagMapOptions = {}): Promise<TagNode[]> {
  const dataSet = await readHeaderDataSet(file, { signal: options.signal, readRange: options.readRange, vrCallback });
  if (!dataSet) throw new Error('NOT_DICOM');
  return dataSetToNodes(dataSet, options);
}

/** Case-insensitive filter that keeps sequences whose items contain a match. */
export function filterTagNodes(nodes: readonly TagNode[], query: string): TagNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...nodes];
  const compactNeedle = needle.replace(/[^0-9a-f]/g, '');
  const matches = (node: TagNode) =>
    node.name.toLowerCase().includes(needle) ||
    node.value.toLowerCase().includes(needle) ||
    node.vr.toLowerCase() === needle ||
    node.tag.toLowerCase().includes(needle) ||
    (compactNeedle.length >= 4 && normalizeTag(node.tag).toLowerCase().includes(compactNeedle));
  const result: TagNode[] = [];
  for (const node of nodes) {
    if (matches(node)) {
      result.push(node);
      continue;
    }
    if (node.items) {
      const items = node.items.map((item) => filterTagNodes(item, query));
      if (items.some((item) => item.length > 0)) result.push({ ...node, items });
    }
  }
  return result;
}

/** Counts nodes including those nested in sequence items. */
export function countTagNodes(nodes: readonly TagNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    for (const item of node.items ?? []) count += countTagNodes(item);
  }
  return count;
}

/** Plain JSON-friendly representation for export. */
export function tagNodesToJson(nodes: readonly TagNode[]): unknown[] {
  return nodes.map((node) => ({
    tag: node.tag,
    name: node.name,
    vr: node.vr,
    ...(node.items ? { items: node.items.map((item) => tagNodesToJson(item)) } : { value: node.value }),
  }));
}
