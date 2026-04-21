import { Suspense, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { MeshTransmissionMaterial, Environment, Float } from '@react-three/drei'
import * as THREE from 'three'

function Knot() {
  const ref = useRef()

  useFrame((state, delta) => {
    if (!ref.current) return
    ref.current.rotation.x += delta * 0.15
    ref.current.rotation.y += delta * 0.22
    ref.current.rotation.z += delta * 0.08
  })

  return (
    <Float speed={1.4} rotationIntensity={0.4} floatIntensity={0.8}>
      <mesh ref={ref} scale={1}>
        <torusKnotGeometry args={[1, 0.38, 220, 48, 2, 3]} />
        <MeshTransmissionMaterial
          color="#DBFE02"
          thickness={1.8}
          roughness={0.05}
          transmission={1}
          ior={1.45}
          chromaticAberration={0.35}
          anisotropicBlur={0.3}
          distortion={0.35}
          distortionScale={0.4}
          temporalDistortion={0.15}
          clearcoat={1}
          clearcoatRoughness={0.08}
          attenuationColor="#DBFE02"
          attenuationDistance={1.4}
          backside
          backsideThickness={0.6}
          samples={10}
          resolution={512}
          background={new THREE.Color('#ffffff')}
        />
      </mesh>
    </Float>
  )
}

export default function GlassKnot({ className = '' }) {
  return (
    <div className={`glass-knot-canvas ${className}`}>
      <Canvas
        camera={{ position: [0, 0, 4.2], fov: 45 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 5]} intensity={1.2} />
        <directionalLight position={[-4, -2, -3]} intensity={0.6} color="#DBFE02" />
        <Suspense fallback={null}>
          <Knot />
          <Environment preset="studio" />
        </Suspense>
      </Canvas>
    </div>
  )
}
