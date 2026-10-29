import { memo, useMemo } from 'react';
import type { Object3D } from 'three';
import type { BlockSpec, DecorSpec, LevelDef } from '@listen-up/sim';
import { cloneStatic, useKenney, useStaticModel } from './models';

const decorHeights: Record<string, number> = {
  tree: 2.35,
  'tree-pine': 2.5,
  flowers: 0.3,
  mushrooms: 0.4,
  sign: 0.8,
  rocks: 0.55,
  grass: 0.28,
  'fence-straight': 0.8,
};

const Block = memo(function Block({ source, block }: { source: Object3D; block: BlockSpec }) {
  const model = useStaticModel(source, 1);
  return (
    <group
      position={[block.at.x + block.size.x / 2, block.at.y, block.at.z + block.size.z / 2]}
      scale={[block.size.x * 1.1, block.size.y, block.size.z * 1.1]}
    >
      <primitive object={model} />
    </group>
  );
});

const Decor = memo(function Decor({ source, item }: { source: Object3D; item: DecorSpec }) {
  const height = (decorHeights[item.model] ?? 0.8) * (item.scale ?? 1);
  const model = useMemo(() => cloneStatic(source, height), [source, height]);
  return (
    <primitive
      object={model}
      position={[item.at.x, item.at.y, item.at.z]}
      rotation={[0, item.rotation ?? 0, 0]}
    />
  );
});

interface LevelViewProps {
  level: LevelDef;
}

export function LevelView({ level }: LevelViewProps) {
  const grass = useKenney('block-grass').scene;
  const grassLow = useKenney('block-grass-low').scene;
  const tree = useKenney('tree').scene;
  const pine = useKenney('tree-pine').scene;
  const flowers = useKenney('flowers').scene;
  const mushrooms = useKenney('mushrooms').scene;
  const sign = useKenney('sign').scene;
  const rocks = useKenney('rocks').scene;
  const grassTuft = useKenney('grass').scene;

  const decorSources: Record<string, Object3D> = useMemo(
    () => ({
      tree,
      'tree-pine': pine,
      flowers,
      mushrooms,
      sign,
      rocks,
      grass: grassTuft,
    }),
    [tree, pine, flowers, mushrooms, sign, rocks, grassTuft],
  );

  return (
    <>
      {level.blocks.map((block) => (
        <Block
          key={`${block.at.x},${block.at.y},${block.at.z}`}
          source={block.kind === 'grassLow' ? grassLow : grass}
          block={block}
        />
      ))}
      {level.zones
        .filter((zone) => zone.id === 'safe_pad')
        .map((zone) => (
          <group key={zone.id} position={[zone.at.x, zone.at.y + 0.03, zone.at.z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <ringGeometry args={[0.52, 0.68, 32]} />
              <meshBasicMaterial color="#9cf7cf" transparent opacity={0.95} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.45, 28]} />
              <meshBasicMaterial color="#47d7a0" transparent opacity={0.35} />
            </mesh>
          </group>
        ))}
      {level.decor.map((item) => {
        const source = decorSources[item.model];
        if (!source) return null;
        return <Decor key={item.id} source={source} item={item} />;
      })}
    </>
  );
}
