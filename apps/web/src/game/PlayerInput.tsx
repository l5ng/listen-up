import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { GameSession } from '@listen-up/game';
import type { InputState } from './input';

interface PlayerInputProps {
  session: GameSession;
  input: InputState;
  canControl: boolean;
  paused: boolean;
}

function isTyping(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (active as HTMLElement).isContentEditable
  );
}

export function PlayerInput({ session, input, canControl, paused }: PlayerInputProps) {
  const { camera } = useThree();
  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const up = useRef(new THREE.Vector3(0, 1, 0));

  useFrame(() => {
    if (!canControl || paused || isTyping()) {
      session.setPlayerInput({ x: 0, z: 0, jump: false });
      return;
    }
    camera.getWorldDirection(forward.current);
    forward.current.y = 0;
    if (forward.current.lengthSq() < 0.0001) forward.current.set(0, 0, -1);
    forward.current.normalize();
    right.current.crossVectors(forward.current, up.current).normalize();

    let x = 0;
    let z = 0;
    if (input.pressed.has('KeyW') || input.pressed.has('ArrowUp')) {
      x += forward.current.x;
      z += forward.current.z;
    }
    if (input.pressed.has('KeyS') || input.pressed.has('ArrowDown')) {
      x -= forward.current.x;
      z -= forward.current.z;
    }
    if (input.pressed.has('KeyD') || input.pressed.has('ArrowRight')) {
      x += right.current.x;
      z += right.current.z;
    }
    if (input.pressed.has('KeyA') || input.pressed.has('ArrowLeft')) {
      x -= right.current.x;
      z -= right.current.z;
    }
    const magnitude = Math.hypot(x, z);
    if (magnitude > 0) {
      x /= magnitude;
      z /= magnitude;
    }
    session.setPlayerInput({ x, z, jump: input.pressed.has('Space') });
  });

  return null;
}
