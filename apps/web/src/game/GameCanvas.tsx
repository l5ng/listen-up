import { Preload } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense } from 'react';
import * as THREE from 'three';
import type { GameSession } from '@listen-up/game';
import type { LevelDef } from '@listen-up/sim';
import { CameraRig } from './CameraRig';
import { CharacterView } from './CharacterView';
import { LevelView } from './LevelView';
import { PlayerInput } from './PlayerInput';
import { PropsLayer } from './PropsLayer';
import { SkyAndClouds } from './SkyAndClouds';
import type { InputState } from './input';

interface GameCanvasProps {
  session: GameSession;
  level: LevelDef;
  input: InputState;
  paused: boolean;
  canControl: boolean;
  reduceMotion: boolean;
}

function GameTicker({ session }: { session: GameSession }) {
  useFrame((_, delta) => {
    session.tick(delta);
  });
  return null;
}

export function GameCanvas({
  session,
  level,
  input,
  paused,
  canControl,
  reduceMotion,
}: GameCanvasProps) {
  return (
    <div className="canvas-wrap">
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, 1.75]}
        camera={{ fov: 45, near: 0.1, far: 220, position: [14, 12, 18] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NoToneMapping;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <Suspense fallback={null}>
          <SkyAndClouds />
          <LevelView level={level} />
          <PropsLayer session={session} />
          <CharacterView session={session} which="a" />
          <CharacterView session={session} which="b" />
          <Preload all />
        </Suspense>
        <GameTicker session={session} />
        <CameraRig session={session} input={input} reduceMotion={reduceMotion} />
        <PlayerInput session={session} input={input} canControl={canControl} paused={paused} />
      </Canvas>
    </div>
  );
}
