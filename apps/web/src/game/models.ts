import { useGLTF } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

const BASE = `${import.meta.env.BASE_URL}models/kenney/`;

export function modelUrl(name: string): string {
  return `${BASE}${name}.glb`;
}

export function useKenney(name: string) {
  return useGLTF(modelUrl(name));
}

const gradient = (() => {
  const data = new Uint8Array([52, 118, 190, 255]);
  const texture = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
})();

const materialCache = new Map<string, THREE.Material>();

function toonMaterial(material: THREE.Material): THREE.Material {
  const meshMaterial = material as THREE.MeshStandardMaterial;
  const key = `${meshMaterial.uuid}:${meshMaterial.map?.uuid ?? 'nomap'}:${meshMaterial.color?.getHexString() ?? 'white'}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  if (meshMaterial.map) {
    meshMaterial.map.magFilter = THREE.NearestFilter;
    meshMaterial.map.needsUpdate = true;
  }
  const toon = new THREE.MeshToonMaterial({
    map: meshMaterial.map ?? null,
    color: meshMaterial.color ? meshMaterial.color.clone() : new THREE.Color('#ffffff'),
    gradientMap: gradient,
    transparent: meshMaterial.transparent,
    opacity: meshMaterial.opacity,
    side: meshMaterial.side,
  });
  materialCache.set(key, toon);
  return toon;
}

export function toonify(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(toonMaterial);
    else if (mesh.material) mesh.material = toonMaterial(mesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

export function cloneStatic(source: THREE.Object3D, targetHeight: number): THREE.Group {
  const clone = source.clone(true);
  toonify(clone);
  const box = new THREE.Box3().setFromObject(clone);
  const height = Math.max(0.0001, box.max.y - box.min.y);
  const scale = targetHeight / height;
  const centerX = (box.min.x + box.max.x) / 2;
  const centerZ = (box.min.z + box.max.z) / 2;
  clone.scale.multiplyScalar(scale);
  clone.position.set(-centerX * scale, -box.min.y * scale, -centerZ * scale);
  const wrapper = new THREE.Group();
  wrapper.add(clone);
  return wrapper;
}

export function cloneCharacter(
  source: THREE.Object3D,
  targetHeight: number,
): { root: THREE.Group; height: number } {
  const clone = cloneSkeleton(source);
  toonify(clone);
  const box = new THREE.Box3().setFromObject(clone);
  const height = Math.max(0.0001, box.max.y - box.min.y);
  const scale = targetHeight / height;
  const centerX = (box.min.x + box.max.x) / 2;
  const centerZ = (box.min.z + box.max.z) / 2;
  clone.scale.multiplyScalar(scale);
  clone.position.set(-centerX * scale, -box.min.y * scale, -centerZ * scale);
  const wrapper = new THREE.Group();
  wrapper.add(clone);
  return { root: wrapper, height: targetHeight };
}

export function useStaticModel(source: THREE.Object3D, height: number): THREE.Group {
  return useMemo(() => cloneStatic(source, height), [source, height]);
}
