import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { GameSession } from '@listen-up/game';
import type { InputState } from './input';
import { OVERVIEW_PITCH, createOverviewFrame, fitCameraDistance } from './overview';

interface CameraRigProps {
  session: GameSession;
  input: InputState;
  reduceMotion: boolean;
}

const FOLLOW_XZ = 0.1;
const FOLLOW_Y = 0.16;
const MIN_PITCH = 0.32;
const MAX_PITCH = 1.28;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.35;
const FOCUS_ZOOM = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function CameraRig({ session, input, reduceMotion }: CameraRigProps) {
  const { camera, gl, size } = useThree();
  const framing = useMemo(() => createOverviewFrame(session.level), [session.level]);

  const cameraState = useRef({
    yaw: session.level.cameraYaw ?? 0.5,
    pitch: OVERVIEW_PITCH,
    zoom: 1,
  });
  const target = useRef(framing.target.clone());
  const desired = useRef(new THREE.Vector3());
  const offset = useRef(new THREE.Vector3());
  const wanted = useRef(new THREE.Vector3());
  const fitted = useRef({ key: '', distance: 0 });
  const initialized = useRef(false);

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
        MIN_PITCH,
        MAX_PITCH,
      );
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const up = () => {
      dragging = false;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraState.current.zoom = clamp(
        cameraState.current.zoom + event.deltaY * 0.0007,
        MIN_ZOOM,
        MAX_ZOOM,
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
        framing.target.x + ((a.x + b.x) / 2 - framing.target.x) * FOLLOW_XZ,
        framing.target.y + ((a.y + b.y) / 2 - framing.target.y) * FOLLOW_Y,
        framing.target.z + ((a.z + b.z) / 2 - framing.target.z) * FOLLOW_XZ,
      );
    }

    const smoothing = reduceMotion ? 1 - Math.exp(-delta * 12) : 1 - Math.exp(-delta * 5);
    target.current.lerp(desired.current, smoothing);

    const aspect = size.width / Math.max(size.height, 1);
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 45;
    const key = `${cameraState.current.yaw.toFixed(3)}:${cameraState.current.pitch.toFixed(3)}:${aspect.toFixed(3)}`;
    if (fitted.current.key !== key) {
      fitted.current = {
        key,
        distance: fitCameraDistance(
          framing.points,
          framing.target,
          cameraState.current.yaw,
          cameraState.current.pitch,
          fov,
          aspect,
        ),
      };
    }

    const distance = fitted.current.distance * cameraState.current.zoom * (focusB ? FOCUS_ZOOM : 1);
    const pitch = cameraState.current.pitch;
    offset.current
      .set(
        Math.sin(cameraState.current.yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(cameraState.current.yaw) * Math.cos(pitch),
      )
      .multiplyScalar(distance);

    wanted.current.copy(target.current).add(offset.current);
    if (!initialized.current) {
      camera.position.copy(wanted.current);
      initialized.current = true;
    } else {
      camera.position.lerp(wanted.current, 1 - Math.exp(-delta * 7));
    }
    camera.lookAt(target.current);
  });

  return null;
}
