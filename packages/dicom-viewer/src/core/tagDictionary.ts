/**
 * Compact DICOM data dictionary for the tag map: keyword-style names and VRs of the
 * attributes found in typical CT, CBCT, MR, radiography, dental and ultrasound files.
 * Tags missing here are shown as "Unknown" (or "Private" for odd groups) with the VR
 * from the file when it has an explicit VR.
 *
 * Format: one entry per line, `GGGGEEEE VR Name`.
 */
const TABLE = `
00020000 UL File Meta Information Group Length
00020001 OB File Meta Information Version
00020002 UI Media Storage SOP Class UID
00020003 UI Media Storage SOP Instance UID
00020010 UI Transfer Syntax UID
00020012 UI Implementation Class UID
00020013 SH Implementation Version Name
00020016 AE Source Application Entity Title
00020100 UI Private Information Creator UID
00080005 CS Specific Character Set
00080008 CS Image Type
00080012 DA Instance Creation Date
00080013 TM Instance Creation Time
00080014 UI Instance Creator UID
00080016 UI SOP Class UID
00080018 UI SOP Instance UID
00080020 DA Study Date
00080021 DA Series Date
00080022 DA Acquisition Date
00080023 DA Content Date
0008002A DT Acquisition DateTime
00080030 TM Study Time
00080031 TM Series Time
00080032 TM Acquisition Time
00080033 TM Content Time
00080050 SH Accession Number
00080051 SQ Issuer of Accession Number Sequence
00080060 CS Modality
00080061 CS Modalities in Study
00080064 CS Conversion Type
00080068 CS Presentation Intent Type
00080070 LO Manufacturer
00080080 LO Institution Name
00080081 ST Institution Address
00080090 PN Referring Physician's Name
00080092 ST Referring Physician's Address
00080094 SH Referring Physician's Telephone Numbers
00080096 SQ Referring Physician Identification Sequence
00080100 SH Code Value
00080102 SH Coding Scheme Designator
00080103 SH Coding Scheme Version
00080104 LO Code Meaning
00080201 SH Timezone Offset From UTC
00081010 SH Station Name
00081030 LO Study Description
00081032 SQ Procedure Code Sequence
0008103E LO Series Description
0008103F SQ Series Description Code Sequence
00081040 LO Institutional Department Name
00081048 PN Physician(s) of Record
00081050 PN Performing Physician's Name
00081060 PN Name of Physician(s) Reading Study
00081070 PN Operators' Name
00081080 LO Admitting Diagnoses Description
00081090 LO Manufacturer's Model Name
00081110 SQ Referenced Study Sequence
00081111 SQ Referenced Performed Procedure Step Sequence
00081115 SQ Referenced Series Sequence
00081120 SQ Referenced Patient Sequence
00081140 SQ Referenced Image Sequence
00081150 UI Referenced SOP Class UID
00081155 UI Referenced SOP Instance UID
00081160 IS Referenced Frame Number
00082111 ST Derivation Description
00082112 SQ Source Image Sequence
00082218 SQ Anatomic Region Sequence
00089205 CS Pixel Presentation
00089206 CS Volumetric Properties
00089207 CS Volume Based Calculation Technique
00100010 PN Patient's Name
00100020 LO Patient ID
00100021 LO Issuer of Patient ID
00100030 DA Patient's Birth Date
00100032 TM Patient's Birth Time
00100040 CS Patient's Sex
00101000 LO Other Patient IDs
00101001 PN Other Patient Names
00101010 AS Patient's Age
00101020 DS Patient's Size
00101030 DS Patient's Weight
00101040 LO Patient's Address
00102160 SH Ethnic Group
00102180 SH Occupation
001021B0 LT Additional Patient History
00104000 LT Patient Comments
00120062 CS Patient Identity Removed
00120063 LO De-identification Method
00180010 LO Contrast/Bolus Agent
00180015 CS Body Part Examined
00180020 CS Scanning Sequence
00180021 CS Sequence Variant
00180022 CS Scan Options
00180023 CS MR Acquisition Type
00180024 SH Sequence Name
00180050 DS Slice Thickness
00180060 DS KVP
00180080 DS Repetition Time
00180081 DS Echo Time
00180082 DS Inversion Time
00180083 DS Number of Averages
00180084 DS Imaging Frequency
00180086 IS Echo Number(s)
00180087 DS Magnetic Field Strength
00180088 DS Spacing Between Slices
00180090 DS Data Collection Diameter
00180091 IS Echo Train Length
00180095 DS Pixel Bandwidth
00181000 LO Device Serial Number
00181004 LO Plate ID
00181020 LO Software Versions
00181030 LO Protocol Name
00181100 DS Reconstruction Diameter
00181110 DS Distance Source to Detector
00181111 DS Distance Source to Patient
00181114 DS Estimated Radiographic Magnification Factor
00181120 DS Gantry/Detector Tilt
00181130 DS Table Height
00181140 CS Rotation Direction
00181150 IS Exposure Time
00181151 IS X-Ray Tube Current
00181152 IS Exposure
00181153 IS Exposure in µAs
00181160 SH Filter Type
00181164 DS Imager Pixel Spacing
00181166 CS Grid
00181170 IS Generator Power
00181190 DS Focal Spot(s)
00181210 SH Convolution Kernel
00181250 SH Receive Coil Name
00181251 SH Transmit Coil Name
00181314 DS Flip Angle
00181316 DS SAR
00181400 LO Acquisition Device Processing Description
00181401 LO Acquisition Device Processing Code
00181405 IS Relative X-Ray Exposure
00181508 CS Positioner Type
00181510 DS Positioner Primary Angle
00181511 DS Positioner Secondary Angle
00185100 CS Patient Position
00185101 CS View Position
00187004 CS Detector Type
0018700A SH Detector ID
00189004 CS Content Qualification
00189345 FD CTDIvol
0020000D UI Study Instance UID
0020000E UI Series Instance UID
00200010 SH Study ID
00200011 IS Series Number
00200012 IS Acquisition Number
00200013 IS Instance Number
00200020 CS Patient Orientation
00200032 DS Image Position (Patient)
00200037 DS Image Orientation (Patient)
00200052 UI Frame of Reference UID
00200060 CS Laterality
00200062 CS Image Laterality
00201002 IS Images in Acquisition
00201040 LO Position Reference Indicator
00201041 DS Slice Location
00204000 LT Image Comments
00209056 SH Stack ID
00209057 UL In-Stack Position Number
00209071 SQ Frame Anatomy Sequence
00209111 SQ Frame Content Sequence
00209113 SQ Plane Position Sequence
00209116 SQ Plane Orientation Sequence
00209128 UL Temporal Position Index
00209157 UL Dimension Index Values
00209221 SQ Dimension Organization Sequence
00209222 SQ Dimension Index Sequence
00280002 US Samples per Pixel
00280004 CS Photometric Interpretation
00280006 US Planar Configuration
00280008 IS Number of Frames
00280009 AT Frame Increment Pointer
00280010 US Rows
00280011 US Columns
00280030 DS Pixel Spacing
00280034 IS Pixel Aspect Ratio
00280100 US Bits Allocated
00280101 US Bits Stored
00280102 US High Bit
00280103 US Pixel Representation
00280106 US Smallest Image Pixel Value
00280107 US Largest Image Pixel Value
00280120 US Pixel Padding Value
00280121 US Pixel Padding Range Limit
00280300 CS Quality Control Image
00280301 CS Burned In Annotation
00280A02 CS Pixel Spacing Calibration Type
00280A04 LO Pixel Spacing Calibration Description
00281040 CS Pixel Intensity Relationship
00281041 SS Pixel Intensity Relationship Sign
00281050 DS Window Center
00281051 DS Window Width
00281052 DS Rescale Intercept
00281053 DS Rescale Slope
00281054 LO Rescale Type
00281055 LO Window Center & Width Explanation
00281056 CS VOI LUT Function
00281101 US Red Palette Color Lookup Table Descriptor
00281102 US Green Palette Color Lookup Table Descriptor
00281103 US Blue Palette Color Lookup Table Descriptor
00281201 OW Red Palette Color Lookup Table Data
00281202 OW Green Palette Color Lookup Table Data
00281203 OW Blue Palette Color Lookup Table Data
00282110 CS Lossy Image Compression
00282112 DS Lossy Image Compression Ratio
00282114 CS Lossy Image Compression Method
00283000 SQ Modality LUT Sequence
00283002 US LUT Descriptor
00283003 LO LUT Explanation
00283004 LO Modality LUT Type
00283006 US LUT Data
00283010 SQ VOI LUT Sequence
00289110 SQ Pixel Measures Sequence
00289132 SQ Frame VOI LUT Sequence
00289145 SQ Pixel Value Transformation Sequence
00321032 PN Requesting Physician
00321033 LO Requesting Service
00321060 LO Requested Procedure Description
00324000 LT Study Comments
00380010 LO Admission ID
00400002 DA Scheduled Procedure Step Start Date
00400003 TM Scheduled Procedure Step Start Time
00400244 DA Performed Procedure Step Start Date
00400245 TM Performed Procedure Step Start Time
00400253 SH Performed Procedure Step ID
00400254 LO Performed Procedure Step Description
00400260 SQ Performed Protocol Code Sequence
00400275 SQ Request Attributes Sequence
00401001 SH Requested Procedure ID
00409096 SQ Real World Value Mapping Sequence
00540081 US Number of Slices
00541001 CS Units
00700001 SQ Graphic Annotation Sequence
00880140 UI Storage Media File-set UID
20500020 CS Presentation LUT Shape
52009229 SQ Shared Functional Groups Sequence
52009230 SQ Per-Frame Functional Groups Sequence
7FE00008 OF Float Pixel Data
7FE00009 OD Double Float Pixel Data
7FE00010 OW Pixel Data
FFFAFFFA SQ Digital Signatures Sequence
FFFCFFFC OB Data Set Trailing Padding
`;

export interface TagDefinition {
  vr: string;
  name: string;
}

let dictionary: Map<string, TagDefinition> | undefined;

function load(): Map<string, TagDefinition> {
  if (dictionary) return dictionary;
  dictionary = new Map();
  for (const line of TABLE.split('\n')) {
    if (line.length < 12) continue;
    const tag = line.slice(0, 8);
    const vr = line.slice(9, 11);
    dictionary.set(tag, { vr, name: line.slice(12) });
  }
  return dictionary;
}

/** Normalises `x00100010`, `00100010`, `(0010,0010)` or `0010,0010` to `00100010`. */
export function normalizeTag(tag: string): string {
  return tag.replace(/^x/i, '').replace(/[^0-9a-f]/gi, '').toUpperCase();
}

/** `(0010,0010)` display form. */
export function formatTag(tag: string): string {
  const hex = normalizeTag(tag);
  return `(${hex.slice(0, 4)},${hex.slice(4, 8)})`;
}

export function isPrivateTag(tag: string): boolean {
  const group = Number.parseInt(normalizeTag(tag).slice(0, 4), 16);
  return group % 2 === 1;
}

/** Dictionary entry for a tag. Group length elements (gggg0000) are named generically. */
export function lookupTag(tag: string): TagDefinition | undefined {
  const hex = normalizeTag(tag);
  const entry = load().get(hex);
  if (entry) return entry;
  if (hex.endsWith('0000')) return { vr: 'UL', name: 'Group Length' };
  if (isPrivateTag(hex) && Number.parseInt(hex.slice(4, 6), 16) === 0 && Number.parseInt(hex.slice(6, 8), 16) >= 0x10) {
    return { vr: 'LO', name: 'Private Creator' };
  }
  return undefined;
}

/** Number of entries in the built-in dictionary. */
export function dictionarySize(): number {
  return load().size;
}
