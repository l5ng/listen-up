import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { GameSession } from '@listen-up/game';
import type { InputState } from './input';

interface CameraRigProps {
  session: GameSession;
  input: InputState;
  reduceMotion: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function CameraRig({ session, input, reduceMotion }: CameraRigProps) {
  const { camera, gl } = useThree();
  const framing = useMemo(() => {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const block of session.level.blocks) {
      minX = Math.min(minX, block.at.x);
      maxX = Math.max(maxX, block.at.x + block.size.x);
      minY = Math.min(minY, block.at.y);
      maxY = Math.max(maxY, block.at.y + block.size.y);
      minZ = Math.min(minZ, block.at.z);
      maxZ = Math.max(maxZ, block.at.z + block.size.z);
    }
    const valid = Number.isFinite(minX);
    return {
      center: new THREE.Vector3(
        valid ? (minX + maxX) / 2 : 0,
        valid ? (minY + maxY) / 2 + 1 : 1.5,
        valid ? (minZ + maxZ) / 2 : 0,
      ),
      span: valid ? Math.max(maxX - minX, maxZ - minZ) : 12,
    };
  }, [session.level.blocks]);

  const cameraState = useRef({ yaw: session.level.cameraYaw ?? 0.5, pitch: 0.55, distance: 11 });
  const target = useRef(framing.center.clone());
  const desired = useRef(new THREE.Vector3());
  const offset = useRef(new THREE.Vector3());

  useEffect(() => {
    if (import.meta.env.DEV) window.listenupCamera = camera;
    const element = gl.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      cameraState.current.yaw -= (event.clientX - lastX) * 0.005;
      cameraState.current.pitch = clamp(
        cameraState.current.pitch + (event.clientY - lastY) * 0.0035,
        0.16,
        1.02,
      );
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const up = () => {
      dragging = false;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraState.current.distance = clamp(
        cameraState.current.distance + event.deltaY * 0.008,
        6.5,
        18,
      );
    };

    element.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      element.removeEventListener('wheel', wheel);
    };
  }, [gl, camera]);

  useFrame((_, delta) => {
    const a = session.world.a.pos;
    const b = session.world.b.pos;
    const active = document.activeElement;
    const editing =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement;
    const focusB = !editing && input.pressed.has('KeyQ');
    if (focusB) {
      desired.current.set(b.x, b.y + 1.2, b.z);
    } else {
      desired.current.set(
        framing.center.x + (a.x - framing.center.x) * 0.16 + (b.x - framing.center.x) * 0.16,
        Math.max(framing.center.y, Math.max(a.y, b.y) + 1.0),
        framing.center.z + (a.z - framing.center.z) * 0.16 + (b.z - framing.center.z) * 0.16,
      );
    }

    const smoothing = reduceMotion ? 1 - Math.exp(-delta * 12) : 1 - Math.exp(-delta * 5);
    target.current.lerp(desired.current, smoothing);

    const distance =
      clamp(framing.span * 1.16, 12.5, 22) *
      (cameraState.current.distance / 11) *
      (focusB ? 0.72 : 1);
    const pitch = cameraState.current.pitch;
    offset.current
      .set(
        Math.sin(cameraState.current.yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(cameraState.current.yaw) * Math.cos(pitch),
      )
      .multiplyScalar(distance);

    const wanted = desired.current.copy(target.current).add(offset.current);
    camera.position.lerp(wanted, 1 - Math.exp(-delta * 7));
    camera.lookAt(target.current);
  });

  return null;
}
