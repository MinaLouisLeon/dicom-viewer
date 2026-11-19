import type { ReactElement } from 'react';

type Vec3 = readonly [number, number, number];

/**
 * Faces in the cube's own frame: x = patient left, y = posterior, z = inferior. Storing
 * superior as −z keeps the cube's frame and the screen frame of the same handedness, so
 * the letters are never mirrored. The extra rotateZ keeps each letter upright when that
 * face is seen with the patient's head up.
 */
const FACES: readonly { label: string; transform: string; tone: string }[] = [
  { label: 'L', transform: 'rotateY(90deg) rotateZ(90deg)', tone: 'x' },
  { label: 'R', transform: 'rotateY(-90deg) rotateZ(-90deg)', tone: 'x' },
  { label: 'P', transform: 'rotateX(-90deg) rotateZ(180deg)', tone: 'y' },
  { label: 'A', transform: 'rotateX(90deg)', tone: 'y' },
  { label: 'S', transform: 'rotateY(180deg)', tone: 'z' },
  { label: 'I', transform: 'rotateX(0deg)', tone: 'z' },
];

/**
 * Small labelled cube that turns with the 3D view. `right`, `down` and `normal` are the
 * screen directions of the 3D camera in patient LPS coordinates (normal towards the viewer).
 */
export function OrientationCube({ right, down, normal, size = 44 }: { right: Vec3; down: Vec3; normal: Vec3; size?: number }): ReactElement {
  // Columns: screen images (x right, y down, z towards the viewer) of the cube axes L, P and I.
  const matrix = [right[0], down[0], normal[0], 0, right[1], down[1], normal[1], 0, -right[2], -down[2], -normal[2], 0, 0, 0, 0, 1];
  const half = size / 2;
  return (
    <div className="mihawk-ws-cube" aria-hidden="true" style={{ width: size, height: size }} data-testid="mihawk-ws-orientation-cube">
      <div className="mihawk-ws-cube-body" style={{ transform: `matrix3d(${matrix.join(',')})` }}>
        {FACES.map((face) => (
          <span
            key={face.label}
            className="mihawk-ws-cube-face"
            data-tone={face.tone}
            style={{ width: size, height: size, lineHeight: `${size}px`, transform: `${face.transform} translateZ(${half}px)` }}
          >
            {face.label}
          </span>
        ))}
      </div>
    </div>
  );
}
