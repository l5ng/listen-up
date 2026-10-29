import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import type { GameSession } from '@listen-up/game';
import { COMPANION_NAME, PLAYER_NAME } from '@listen-up/sim';
import { cloneCharacter, useKenney } from './models';

const ANIMATION_NAMES = [
  'idle',
  'walk',
  'sprint',
  'jump',
  'fall',
  'interact-right',
  'die',
] as const;
type AnimationName = (typeof ANIMATION_NAMES)[number];

function SpeechBubble({ session }: { session: GameSession }) {
  const ui = useSyncExternalStore(session.subscribe, session.getUiSnapshot);
  if (!ui.speech.trim()) return null;
  return (
    <Html
      position={[0, 1.95, 0]}
      center
      distanceFactor={9}
      zIndexRange={[4, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div className="speech-bubble">
        <span className="speech-name">{COMPANION_NAME}</span>
        {ui.speech}
      </div>
    </Html>
  );
}

interface CharacterViewProps {
  session: GameSession;
  which: 'a' | 'b';
}

export function CharacterView({ session, which }: CharacterViewProps) {
  const gltf = useKenney(which === 'a' ? 'character-oobi' : 'character-oopi');
  const { root, actions, mixer } = useMemo(() => {
    const clone = cloneCharacter(gltf.scene, 1.55);
    const animationMixer = new THREE.AnimationMixer(clone.root);
    const map = new Map<string, THREE.AnimationAction>();
    for (const clip of gltf.animations) {
      const action = animationMixer.clipAction(clip);
      map.set(clip.name, action);
    }
    return { root: clone.root, actions: map, mixer: animationMixer };
  }, [gltf.scene, gltf.animations]);

  const group = useRef<THREE.Group>(null);
  const current = useRef<AnimationName>('idle');
  const ready = useRef(false);

  useEffect(() => {
    const idle = actions.get('idle');
    if (idle) {
      idle.reset().play();
      current.current = 'idle';
      ready.current = true;
    }
    return () => {
      mixer.stopAllAction();
    };
  }, [actions, mixer]);

  const play = (name: AnimationName) => {
    if (current.current === name) return;
    const next = actions.get(name) ?? actions.get('idle');
    if (!next) return;
    const previous = actions.get(current.current);
    next.reset();
    next.setLoop(
      name === 'jump' || name === 'fall' || name === 'die' ? THREE.LoopOnce : THREE.LoopRepeat,
      Infinity,
    );
    next.clampWhenFinished = name === 'jump' || name === 'fall' || name === 'die';
    next.fadeIn(0.12).play();
    if (previous && previous !== next) previous.fadeOut(0.12);
    current.current = name;
  };

  const ui = useSyncExternalStore(session.subscribe, session.getUiSnapshot);

  useFrame((_, delta) => {
    const char = which === 'a' ? session.world.a : session.world.b;
    if (group.current) {
      group.current.position.set(char.pos.x, char.pos.y, char.pos.z);
      group.current.rotation.y = char.facing;
    }
    mixer.update(Math.min(delta, 0.05));
    if (!ready.current) return;
    if (char.respawnCooldown > 0) {
      play('idle');
    } else if (!char.grounded) {
      play(char.vel.y > 0.2 ? 'jump' : 'fall');
    } else if (char.speed > 3.3) {
      play('sprint');
    } else if (char.speed > 0.18) {
      play('walk');
    } else {
      play('idle');
    }
  });

  const ringColor = which === 'a' ? '#ffcf5c' : '#36c8d8';

  return (
    <group ref={group}>
      <primitive object={root} />
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.35, 0.44, 28]} />
        <meshBasicMaterial color={ringColor} transparent opacity={0.8} depthWrite={false} />
      </mesh>
      <Html
        position={[0, 1.72, 0]}
        center
        distanceFactor={12}
        zIndexRange={[4, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <span className={`name-tag ${which}`}>{which === 'a' ? PLAYER_NAME : COMPANION_NAME}</span>
      </Html>
      {which === 'b' ? <SpeechBubble session={session} /> : null}
      {which === 'b' && ui.turnActive ? (
        <mesh position={[0, 2.1, 0]}>
          <octahedronGeometry args={[0.08, 0]} />
          <meshBasicMaterial color="#36c8d8" />
        </mesh>
      ) : null}
    </group>
  );
}
