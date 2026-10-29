import { useMemo } from 'react';
import * as THREE from 'three';

function SkyDome() {
  const uniforms = useMemo(
    () => ({
      topColor: { value: new THREE.Color('#48b8ef') },
      horizonColor: { value: new THREE.Color('#c8f2ff') },
      bottomColor: { value: new THREE.Color('#effcff') },
    }),
    [],
  );
  return (
    <mesh renderOrder={-10}>
      <sphereGeometry args={[120, 32, 16]} />
      <shaderMaterial
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        vertexShader={`
          varying vec3 vWorld;
          void main() {
            vWorld = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform vec3 topColor;
          uniform vec3 horizonColor;
          uniform vec3 bottomColor;
          varying vec3 vWorld;
          void main() {
            float h = vWorld.y;
            vec3 color = mix(bottomColor, horizonColor, smoothstep(-0.25, 0.08, h));
            color = mix(color, topColor, smoothstep(0.05, 0.8, h));
            gl_FragColor = vec4(color, 1.0);
          }
        `}
      />
    </mesh>
  );
}

function Cloud({
  position,
  scale,
  seed,
}: {
  position: [number, number, number];
  scale: number;
  seed: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0, 0]} castShadow={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[1.2 + seed * 0.04, -0.1, 0.2]} castShadow={false}>
        <icosahedronGeometry args={[0.72, 1]} />
        <meshBasicMaterial color="#f8feff" />
      </mesh>
      <mesh position={[-1.05, -0.18, -0.15]} castShadow={false}>
        <icosahedronGeometry args={[0.58, 1]} />
        <meshBasicMaterial color="#f4fcff" />
      </mesh>
    </group>
  );
}

export function SkyAndClouds() {
  const clouds = useMemo(() => {
    const list: { position: [number, number, number]; scale: number; seed: number }[] = [];
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2 + 0.4;
      const radius = 30 + (index % 4) * 7;
      list.push({
        position: [Math.cos(angle) * radius, 7 + (index % 3) * 3.5, Math.sin(angle) * radius - 4],
        scale: 2.4 + (index % 4) * 0.7,
        seed: index,
      });
    }
    return list;
  }, []);

  return (
    <>
      <SkyDome />
      {clouds.map((cloud) => (
        <Cloud
          key={`${cloud.position[0]},${cloud.position[2]}`}
          position={cloud.position}
          scale={cloud.scale}
          seed={cloud.seed}
        />
      ))}
      <hemisphereLight args={['#e8fbff', '#5d7f49', 1.15]} />
      <ambientLight intensity={0.32} />
      <directionalLight
        position={[14, 22, 9]}
        intensity={2.3}
        color="#fff5dc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
        shadow-camera-near={0.5}
        shadow-camera-far={70}
      />
      <fogExp2 attach="fog" args={['#d7f4ff', 0.012]} />
    </>
  );
}
