import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { levels } from '@listen-up/sim';
import { createOverviewFrame, fitCameraDistance } from './overview';

describe('createOverviewFrame', () => {
  it('covers every block and leaves headroom for the camera', () => {
    const frame = createOverviewFrame(levels[0]!);
    expect(frame.points.length).toBeGreaterThan(levels[0]!.blocks.length * 4);
    expect(frame.target.x).toBeCloseTo(6);
    expect(frame.target.z).toBeCloseTo(6);
    for (const point of frame.points) {
      expect(Number.isFinite(point.x + point.y + point.z)).toBe(true);
    }
  });

  it('includes tall decor above the playable surfaces', () => {
    const frame = createOverviewFrame(levels[0]!);
    const highest = Math.max(...frame.points.map((point) => point.y));
    expect(highest).toBeGreaterThan(4);
  });
});

describe('fitCameraDistance', () => {
  const target = new THREE.Vector3(0, 1, 0);
  const points: THREE.Vector3[] = [];
  for (const x of [-6, 6]) {
    for (const y of [0, 3]) {
      for (const z of [-6, 6]) {
        points.push(new THREE.Vector3(x, y, z));
      }
    }
  }

  function assertInsideView(distance: number, aspect: number) {
    const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);
    const yaw = 4.75;
    const pitch = 0.9;
    camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    camera.lookAt(target);
    camera.updateMatrixWorld();
    for (const point of points) {
      const projected = point.clone().project(camera);
      expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.941);
      expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.841);
    }
  }

  it('keeps the whole level inside the framing margins', () => {
    for (const aspect of [1.6, 4 / 3, 1.8]) {
      assertInsideView(fitCameraDistance(points, target, 4.75, 0.9, 45, aspect), aspect);
    }
  });

  it('moves farther back for narrow viewports', () => {
    const wide = fitCameraDistance(points, target, 4.75, 0.9, 45, 1.8);
    const narrow = fitCameraDistance(points, target, 4.75, 0.9, 45, 0.8);
    expect(narrow).toBeGreaterThan(wide);
  });
});
