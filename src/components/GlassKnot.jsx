import { Suspense, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { MeshTransmissionMaterial, Environment, Center, Text3D } from '@react-three/drei'
import * as THREE from 'three'

function TwineText() {
  const matRef = useRef()
  const attColor = useRef(new THREE.Color('#DBFE02'))
  const baseColor = useRef(new THREE.Color('#DBFE02'))
  const shiftA = useRef(new THREE.Color('#DBFE02'))
  const shiftB = useRef(new THREE.Color('#A8E835'))
  const shiftC = useRef(new THREE.Color('#FFFFD6'))

  useFrame((state) => {
    if (!matRef.current) return
    const t = state.clock.elapsedTime
    const s = (Math.sin(t * 0.7) + 1) / 2
    const s2 = (Math.sin(t * 0.5 + 1.3) + 1) / 2
    const ab = shiftA.current.clone().lerp(shiftB.current, s)
    const abc = ab.lerp(shiftC.current, s2 * 0.4)

    matRef.current.color = abc
    matRef.current.attenuationColor = abc
    matRef.current.chromaticAberration = 0.35 + Math.sin(t * 1.1) * 0.15
    matRef.current.distortion = 0.22 + Math.sin(t * 0.9 + 0.5) * 0.08
  })

  return (
    <Center>
      <Text3D
        font="/fonts/droid_sans_bold.typeface.json"
        size={1.4}
        height={0.12}
        curveSegments={32}
        bevelEnabled
        bevelThickness={0.03}
        bevelSize={0.025}
        bevelSegments={10}
        letterSpacing={-0.05}
      >
        twine
        <MeshTransmissionMaterial
          ref={matRef}
          color="#DBFE02"
          thickness={0.55}
          roughness={0.04}
          transmission={1}
          ior={1.45}
          chromaticAberration={0.4}
          anisotropicBlur={0.3}
          distortion={0.25}
          distortionScale={0.4}
          temporalDistortion={0.12}
          clearcoat={1}
          clearcoatRoughness={0.05}
          attenuationColor="#DBFE02"
          attenuationDistance={1.3}
          backside
          backsideThickness={0.3}
          samples={8}
          resolution={512}
          background={new THREE.Color('#ffffff')}
        />
      </Text3D>
    </Center>
  )
}

export default function GlassKnot({ className = '' }) {
  return (
    <div className={`glass-knot-canvas ${className}`}>
      <Canvas
        camera={{ position: [0, 0, 5.2], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 4, 5]} intensity={1.4} />
        <directionalLight position={[-4, -2, -3]} intensity={0.6} color="#DBFE02" />
        <pointLight position={[0, 0, 3]} intensity={0.7} color="#ffffff" />
        <Suspense fallback={null}>
          <TwineText />
          <Environment preset="studio" />
        </Suspense>
      </Canvas>
    </div>
  )
}
