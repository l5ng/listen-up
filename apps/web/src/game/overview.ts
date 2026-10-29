import * as THREE from 'three';
import type { LevelDef } from '@listen-up/sim';
import { decorHeights } from './decor';

/** The default angle for the opening overview: high enough to read the whole map. */
export const OVERVIEW_PITCH = 0.9;
/** Keep the level inside this share of the horizontal viewport. */
const HORIZONTAL_FILL = 0.94;
/** Keep the level inside this share of the vertical viewport. */
const VERTICAL_FILL = 0.84;
/** A little breathing room around blocks for grass tufts and cliff edges. */
const FOOTPRINT_PAD = 0.35;

export interface OverviewFrame {
  /** The point the camera looks at when both characters are at rest. */
  target: THREE.Vector3;
  /** Candidate world points used to fit the whole level into view. */
  points: THREE.Vector3[];
}

/**
 * Collects the corners of every block plus the tallest points of props and
 * decor, so the initial camera can frame the complete playable area instead
 * of only its centre.
 */
export function createOverviewFrame(level: LevelDef): OverviewFrame {
  const bounds = new THREE.Box3();
  const points: THREE.Vector3[] = [];

  for (const block of level.blocks) {
    const minX = block.at.x - FOOTPRINT_PAD;
    const maxX = block.at.x + block.size.x + FOOTPRINT_PAD;
    const minZ = block.at.z - FOOTPRINT_PAD;
    const maxZ = block.at.z + block.size.z + FOOTPRINT_PAD;

    bounds.expandByPoint(new THREE.Vector3(block.at.x, block.at.y, block.at.z));
    bounds.expandByPoint(
      new THREE.Vector3(
        block.at.x + block.size.x,
        block.at.y + block.size.y,
        block.at.z + block.size.z,
      ),
    );

    for (const x of [minX, maxX]) {
      for (const z of [minZ, maxZ]) {
        points.push(new THREE.Vector3(x, block.at.y, z));
        points.push(new THREE.Vector3(x, block.at.y + block.size.y, z));
      }
    }
  }

  for (const item of level.decor) {
    const height = (decorHeights[item.model] ?? 0.8) * (item.scale ?? 1);
    points.push(new THREE.Vector3(item.at.x, item.at.y + height, item.at.z));
  }

  for (const item of level.props) {
    const height = item.size?.y ?? 1;
    points.push(new THREE.Vector3(item.at.x, item.at.y + height, item.at.z));
  }

  if (bounds.isEmpty()) {
    return {
      target: new THREE.Vector3(0, 1.4, 0),
      points: [
        new THREE.Vector3(-6, 0, -6),
        new THREE.Vector3(6, 0, -6),
        new THREE.Vector3(-6, 0, 6),
        new THREE.Vector3(6, 0, 6),
      ],
    };
  }

  const target = bounds.getCenter(new THREE.Vector3());
  target.y += 0.9;
  return { target, points };
}

/**
 * How far the camera must sit from {@link target} to see every point from the
 * given yaw/pitch. Uses the real perspective frustum, not a bounding sphere, so
 * wide or L-shaped levels do not get pushed unnecessarily far away.
 */
export function fitCameraDistance(
  points: readonly THREE.Vector3[],
  target: THREE.Vector3,
  yaw: number,
  pitch: number,
  fovDegrees: number,
  aspect: number,
): number {
  const tanVertical = Math.tan((fovDegrees * Math.PI) / 360);
  const tanHorizontal = tanVertical * Math.max(aspect, 0.1);
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  // Camera-space axes for a camera looking at the target from (yaw, pitch).
  const rightX = cosYaw;
  const rightZ = -sinYaw;
  const upX = -sinYaw * sinPitch;
  const upY = cosPitch;
  const upZ = -cosYaw * sinPitch;
  const towardX = sinYaw * cosPitch;
  const towardY = sinPitch;
  const towardZ = cosYaw * cosPitch;

  let distance = 0;
  for (const point of points) {
    const dx = point.x - target.x;
    const dy = point.y - target.y;
    const dz = point.z - target.z;

    const horizontal = Math.abs(dx * rightX + dz * rightZ);
    const vertical = Math.abs(dx * upX + dy * upY + dz * upZ);
    // Positive when the point is nearer to the camera than the target.
    const near = dx * towardX + dy * towardY + dz * towardZ;

    distance = Math.max(
      distance,
      near + horizontal / (tanHorizontal * HORIZONTAL_FILL),
      near + vertical / (tanVertical * VERTICAL_FILL),
    );
  }

  return Math.max(distance, 4);
}
