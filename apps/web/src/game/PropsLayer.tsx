import { RoundedBox } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { GameSession } from '@listen-up/game';
import { EXIT_ZONE_RADIUS } from '@listen-up/sim';
import type { RenderPropState, WorldRenderState } from '@listen-up/sim';
import { useKenney, useStaticModel } from './models';

function useRenderState(session: GameSession): WorldRenderState {
  const [view, setView] = useState<WorldRenderState>(() => session.world.getRenderState());
  useEffect(() => {
    const timer = setInterval(() => setView(session.world.getRenderState()), 80);
    return () => clearInterval(timer);
  }, [session]);
  return view;
}

function CrateView({ source, prop }: { source: THREE.Object3D; prop: RenderPropState }) {
  const model = useStaticModel(source, 1);
  return <primitive object={model} position={[prop.pos.x, prop.pos.y, prop.pos.z]} />;
}

function LeverView({ source, prop }: { source: THREE.Object3D; prop: RenderPropState }) {
  const model = useStaticModel(source, 1.1);
  const glow = prop.on ? '#ffe08a' : '#6d7f8c';
  return (
    <group position={[prop.pos.x, prop.pos.y, prop.pos.z]}>
      <primitive object={model} />
      <mesh position={[0, 0.95, 0]} castShadow>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshToonMaterial
          color={glow}
          emissive={prop.on ? '#ffb01f' : '#000000'}
          emissiveIntensity={prop.on ? 0.6 : 0}
        />
      </mesh>
    </group>
  );
}

function PlateView({ prop }: { prop: RenderPropState }) {
  const red = prop.id.includes('red');
  const base = red ? '#f26b5e' : '#36c8d8';
  const top = prop.pressed ? -0.025 : 0;
  const color = red ? '#ff8b7d' : '#7be5ef';
  return (
    <group position={[prop.pos.x, prop.pos.y + 0.055, prop.pos.z]}>
      <RoundedBox
        args={[prop.size.x, prop.size.y, prop.size.z]}
        radius={0.05}
        smoothness={3}
        position={[0, prop.size.y / 2 + top, 0]}
        receiveShadow
        castShadow
      >
        <meshToonMaterial color={base} />
      </RoundedBox>
      <mesh position={[0, top + prop.size.y + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.28, 0.42, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, top + prop.size.y + 0.007, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.22, 24]} />
        <meshBasicMaterial color={color} transparent opacity={prop.pressed ? 0.95 : 0.45} />
      </mesh>
    </group>
  );
}

function GateView({ prop }: { prop: RenderPropState }) {
  const group = useRef<THREE.Group>(null);
  const target = prop.open ? prop.size.y * 0.95 : 0;
  useEffect(() => {
    if (!group.current) return;
    group.current.position.y = prop.pos.y + target;
  }, [prop.pos.y, target]);
  return (
    <group ref={group} position={[prop.pos.x, prop.pos.y + target, prop.pos.z]}>
      <mesh position={[0, prop.size.y / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[prop.size.x * 0.7, prop.size.y, prop.size.z * 0.88]} />
        <meshToonMaterial color="#b57645" />
      </mesh>
      {[0.2, 0.5, 0.8].map((ratio) => (
        <mesh key={ratio} position={[0, prop.size.y * ratio, 0]} castShadow>
          <boxGeometry args={[prop.size.x * 1.1, 0.14, prop.size.z]} />
          <meshToonMaterial color="#7e4c2d" />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, prop.size.y / 2, side * prop.size.z * 0.45]} castShadow>
          <boxGeometry args={[prop.size.x * 1.25, prop.size.y, 0.14]} />
          <meshToonMaterial color="#6b4029" />
        </mesh>
      ))}
    </group>
  );
}

function BridgeView({ prop }: { prop: RenderPropState }) {
  if (!prop.open) return null;
  const planks = Math.max(2, Math.round(prop.size.x / 0.55));
  return (
    <group position={[prop.pos.x, prop.pos.y, prop.pos.z]}>
      {Array.from({ length: planks }, (_, index) => {
        const x = -prop.size.x / 2 + (index + 0.5) * (prop.size.x / planks);
        return (
          <mesh key={index} position={[x, prop.size.y / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[prop.size.x / planks - 0.035, 0.16, prop.size.z]} />
            <meshToonMaterial color={index % 2 === 0 ? '#d49a5c' : '#c4884e'} />
          </mesh>
        );
      })}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[0, prop.size.y + 0.32, side * (prop.size.z / 2 - 0.06)]}
          castShadow
        >
          <boxGeometry args={[prop.size.x, 0.08, 0.08]} />
          <meshToonMaterial color="#8a5a36" />
        </mesh>
      ))}
    </group>
  );
}

function HazardView({ prop }: { prop: RenderPropState }) {
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const warningRing = useRef<THREE.Mesh>(null);
  const phase = prop.phase ?? 'safe';
  useEffect(() => {
    const timer = setInterval(() => {
      const now = performance.now() / 1000;
      const pulse = 0.5 + Math.sin(now * 6) * 0.5;
      if (material.current) {
        material.current.emissiveIntensity =
          phase === 'active' ? 1.4 + pulse * 0.8 : phase === 'warning' ? 0.25 + pulse * 0.5 : 0.05;
        material.current.color.set(
          phase === 'active' ? '#ff3524' : phase === 'warning' ? '#ff9b43' : '#b6473e',
        );
      }
      if (warningRing.current) {
        const scale = 1 + (phase === 'warning' ? pulse * 0.08 : 0);
        warningRing.current.scale.setScalar(scale);
        const ringMaterial = warningRing.current.material as THREE.MeshBasicMaterial;
        ringMaterial.opacity =
          phase === 'active' ? 0.9 : phase === 'warning' ? 0.55 + pulse * 0.35 : 0.12;
      }
    }, 50);
    return () => clearInterval(timer);
  }, [phase]);

  return (
    <group position={[prop.pos.x, prop.pos.y, prop.pos.z]}>
      <mesh position={[0, prop.size.y / 2 + 0.01, 0]} receiveShadow>
        <boxGeometry args={[prop.size.x, Math.max(0.08, prop.size.y), prop.size.z]} />
        <meshStandardMaterial
          ref={material}
          color="#b6473e"
          roughness={0.8}
          emissive="#ff2b1c"
          emissiveIntensity={0.05}
        />
      </mesh>
      <mesh ref={warningRing} position={[0, prop.size.y + 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry
          args={[
            Math.min(prop.size.x, prop.size.z) * 0.34,
            Math.min(prop.size.x, prop.size.z) * 0.39,
            40,
          ]}
        />
        <meshBasicMaterial color="#ffe5a3" transparent opacity={0.3} />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}:${sz}`}
            position={[sx * prop.size.x * 0.42, 0.12, sz * prop.size.z * 0.42]}
            castShadow
          >
            <coneGeometry args={[0.12, 0.3, 4]} />
            <meshToonMaterial color="#ffcf5c" />
          </mesh>
        )),
      )}
    </group>
  );
}

function ExitView({ source, prop }: { source: THREE.Object3D; prop: RenderPropState }) {
  const model = useStaticModel(source, 1.4);
  const ring = useRef<THREE.Mesh>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      if (ring.current) ring.current.rotation.z += 0.02;
    }, 30);
    return () => clearInterval(timer);
  }, []);
  return (
    <group position={[prop.pos.x, prop.pos.y, prop.pos.z]}>
      <primitive object={model} />
      <mesh ref={ring} position={[0, 0.95, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[EXIT_ZONE_RADIUS - 0.12, 0.07, 12, 48]} />
        <meshStandardMaterial color="#ffd45c" emissive="#ffb01f" emissiveIntensity={1.2} />
      </mesh>
      <pointLight position={[0, 1, 0]} color="#ffd45c" intensity={3} distance={5} />
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[EXIT_ZONE_RADIUS, 48]} />
        <meshBasicMaterial color="#ffe6a1" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[EXIT_ZONE_RADIUS - 0.09, EXIT_ZONE_RADIUS, 48]} />
        <meshBasicMaterial color="#ffe6a1" transparent opacity={0.85} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function PropsLayer({ session }: { session: GameSession }) {
  const view = useRenderState(session);
  const crate = useKenney('crate').scene;
  const lever = useKenney('lever').scene;
  const flag = useKenney('flag').scene;

  const models = useMemo(() => ({ crate, lever, flag }), [crate, lever, flag]);

  return (
    <>
      {view.crates.map((prop) => (
        <CrateView key={prop.id} source={models.crate} prop={prop} />
      ))}
      {view.levers.map((prop) => (
        <LeverView key={prop.id} source={models.lever} prop={prop} />
      ))}
      {view.plates.map((prop) => (
        <PlateView key={prop.id} prop={prop} />
      ))}
      {view.gates.map((prop) => (
        <GateView key={prop.id} prop={prop} />
      ))}
      {view.bridges.map((prop) => (
        <BridgeView key={prop.id} prop={prop} />
      ))}
      {view.hazards.map((prop) => (
        <HazardView key={prop.id} prop={prop} />
      ))}
      {view.exits.map((prop) => (
        <ExitView key={prop.id} source={models.flag} prop={prop} />
      ))}
    </>
  );
}
