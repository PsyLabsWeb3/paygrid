import { Float, Line, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { memo, useMemo, useRef } from "react";
import * as THREE from "three";
import { theme } from "../celo-paygrid-theme";

function Core() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = state.clock.elapsedTime * 0.18;
    ref.current.position.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.04;
  });
  return (
    <Float speed={1.4} rotationIntensity={0.16} floatIntensity={0.14}>
      <mesh ref={ref}>
        <icosahedronGeometry args={[0.78, 3]} />
        <meshStandardMaterial color={theme.colors.lime} emissive={theme.colors.lime} emissiveIntensity={0.34} roughness={0.34} />
      </mesh>
    </Float>
  );
}

function OrbitingNodes() {
  const group = useRef<THREE.Group>(null);
  const nodes = useMemo(
    () =>
      Array.from({ length: 10 }, (_, index) => {
        const angle = (index / 10) * Math.PI * 2;
        const radius = index % 2 === 0 ? 2.3 : 3.05;
        return {
          position: new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle * 1.7) * 0.72, Math.sin(angle) * radius * 0.62),
          color: index % 3 === 0 ? theme.colors.warning : index % 2 === 0 ? theme.colors.soft : theme.colors.lime,
          size: index % 3 === 0 ? 0.08 : 0.105,
        };
      }),
    [],
  );

  useFrame((state) => {
    if (!group.current) return;
    group.current.rotation.y = state.clock.elapsedTime * 0.08;
    group.current.rotation.x = Math.sin(state.mouse.y * 0.2) * 0.12;
    group.current.rotation.z = Math.sin(state.mouse.x * 0.2) * 0.12;
  });

  return (
    <group ref={group}>
      {nodes.map((node, index) => (
        <group key={index}>
          <Line points={[new THREE.Vector3(0, 0, 0), node.position]} color={theme.colors.lime} transparent opacity={0.16} lineWidth={1} />
          <mesh position={node.position}>
            <sphereGeometry args={[node.size, 20, 20]} />
            <meshStandardMaterial color={node.color} emissive={node.color} emissiveIntensity={0.22} roughness={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Particles() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const count = typeof window !== "undefined" && window.innerWidth < 720 ? 28 : 48;
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        offset: i / count,
        radius: 1.1 + (i % 7) * 0.28,
        lane: i % 3,
      })),
    [count],
  );

  useFrame((state) => {
    if (!mesh.current) return;
    seeds.forEach((seed, index) => {
      const t = (state.clock.elapsedTime * 0.08 + seed.offset) % 1;
      const angle = t * Math.PI * 2 + seed.lane;
      const inward = 1 - Math.abs(t - 0.5) * 0.36;
      dummy.position.set(Math.cos(angle) * seed.radius * inward, Math.sin(angle * 1.3) * 0.72, Math.sin(angle) * seed.radius * 0.56);
      const scale = seed.lane === 1 ? 0.036 : 0.025;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.current?.setMatrixAt(index, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 10, 10]} />
      <meshBasicMaterial color={theme.colors.success} transparent opacity={0.72} />
    </instancedMesh>
  );
}

export const AgentNetworkScene = memo(function AgentNetworkScene() {
  return (
    <Canvas dpr={[1, 1.55]} gl={{ antialias: true, alpha: true }} className="hero-canvas" aria-hidden="true">
      <PerspectiveCamera makeDefault position={[0, 1.1, 5.4]} fov={42} />
      <ambientLight intensity={0.8} />
      <pointLight position={[3, 4, 4]} intensity={3.2} color={theme.colors.lime} />
      <pointLight position={[-4, -2, 2]} intensity={1.2} color={theme.colors.warning} />
      <Core />
      <OrbitingNodes />
      <Particles />
    </Canvas>
  );
});

