import { useRef, useMemo, useCallback, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import './star-swipe.css'

const VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT_SHADER = `
precision highp float;

uniform float uTime;
uniform vec2  uRes;
uniform float uSpeed;
uniform float uScale;
uniform float uWarpStrength;
uniform float uWarpCurvature;
uniform float uWarpFalloff;
uniform float uScrollSpeed;
uniform float uNoiseAmount;
uniform float uColorIntensity;
uniform float uColorSeparation;
uniform float uRotation;
uniform vec3  uTint;
uniform vec3  uBg;
uniform float uAlpha;
uniform vec2  uPointer;
uniform float uCursorActive;
uniform float uCursorIntensity;

varying vec2 vUv;

vec3 safeTanh(vec3 x) {
  vec3 e = exp(-2.0 * x);
  return (1.0 - e) / (1.0 + e);
}

void main() {
  float t = uTime * uSpeed;

  vec2 p = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y * uScale;

  float cr = cos(uRotation);
  float sr = sin(uRotation);
  p = mat2(cr, -sr, sr, cr) * p;

  vec2 pointerPos = (uPointer * 2.0 - 1.0) * vec2(uRes.x / uRes.y, 1.0) * uScale;
  pointerPos = mat2(cr, -sr, sr, cr) * pointerPos;
  float cursorDist = length(p - pointerPos);
  float cursorInfluence = smoothstep(3.0, 0.0, cursorDist) * uCursorActive * uCursorIntensity;

  float localWarpStrength = uWarpStrength + cursorInfluence * 0.35;
  float localFalloff = uWarpFalloff - cursorInfluence * 0.6;

  float a = 9.0 * localWarpStrength;
  float b = 8.0 * localWarpStrength;
  mat2 warpMatrix = mat2(a, -b, -b, a);

  float inversiveScale = uWarpCurvature / (max(localFalloff, 0.5) + dot(p, p));

  float dither = fract(dot(gl_FragCoord, sin(gl_FragCoord.yxyx + t))) * uNoiseAmount;

  float scroll = t * uScrollSpeed;

  p = p * warpMatrix * inversiveScale + dither + scroll;

  float phase = sin(t + p.x + p.y);
  float brightness = exp(phase);

  vec2 freqA = cos(p + p.x / 7.0);
  vec2 freqB = sin(p.yx * 0.61);
  float interference = dot(freqA, freqB);

  float colorMod = cos(p.x * 0.1) + 1.0;
  vec3 channelOffset = colorMod * vec3(0.0, 0.1, 0.2) * uColorSeparation;

  vec3 denom = sin(interference + channelOffset) + 1.0;
  vec3 rawColor = uColorIntensity * brightness / denom;
  vec3 color = safeTanh(rawColor);

  color += cursorInfluence * 0.025;

  color *= uTint;

  float effectAlpha = max(color.r, max(color.g, color.b));
  vec3 composited = color + uBg * (1.0 - effectAlpha);

  gl_FragColor = vec4(composited, uAlpha);
}
`

function parseHexColor(hex) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!match) return [0, 0, 0]
  return [
    parseInt(match[1], 16) / 255,
    parseInt(match[2], 16) / 255,
    parseInt(match[3], 16) / 255,
  ]
}

function StarSwipeScene({
  speed, scale, warpStrength, warpCurvature, warpFalloff, scrollSpeed,
  noiseAmount, colorIntensity, colorSeparation, rotation,
  tintRgb, bgRgb, opacity, pointer, cursorInteraction, cursorIntensity,
}) {
  const meshRef = useRef(null)
  const { size, viewport } = useThree()
  const smoothPointer = useRef(new THREE.Vector2(0.5, 0.5))

  const shaderUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uSpeed: { value: speed },
      uScale: { value: scale },
      uWarpStrength: { value: warpStrength },
      uWarpCurvature: { value: warpCurvature },
      uWarpFalloff: { value: warpFalloff },
      uScrollSpeed: { value: scrollSpeed },
      uNoiseAmount: { value: noiseAmount },
      uColorIntensity: { value: colorIntensity },
      uColorSeparation: { value: colorSeparation },
      uRotation: { value: (rotation * Math.PI) / 180 },
      uTint: { value: new THREE.Vector3(...tintRgb) },
      uBg: { value: new THREE.Vector3(...bgRgb) },
      uAlpha: { value: opacity },
      uPointer: { value: new THREE.Vector2(0.5, 0.5) },
      uCursorActive: { value: 0 },
      uCursorIntensity: { value: 1 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useFrame((state, delta) => {
    if (!meshRef.current) return
    const mat = meshRef.current.material

    mat.uniforms.uTime.value = state.clock.elapsedTime
    mat.uniforms.uRes.value.set(
      size.width * viewport.dpr,
      size.height * viewport.dpr,
    )
    mat.uniforms.uSpeed.value = speed
    mat.uniforms.uScale.value = scale
    mat.uniforms.uWarpStrength.value = warpStrength
    mat.uniforms.uWarpCurvature.value = warpCurvature
    mat.uniforms.uWarpFalloff.value = warpFalloff
    mat.uniforms.uScrollSpeed.value = scrollSpeed
    mat.uniforms.uNoiseAmount.value = noiseAmount
    mat.uniforms.uColorIntensity.value = colorIntensity
    mat.uniforms.uColorSeparation.value = colorSeparation
    mat.uniforms.uRotation.value = (rotation * Math.PI) / 180
    mat.uniforms.uTint.value.set(...tintRgb)
    mat.uniforms.uBg.value.set(...bgRgb)
    mat.uniforms.uAlpha.value = opacity
    mat.uniforms.uCursorActive.value = cursorInteraction ? 1 : 0
    mat.uniforms.uCursorIntensity.value = cursorIntensity

    const ease = 1 - Math.exp(-delta / 0.15)
    smoothPointer.current.x += (pointer[0] - smoothPointer.current.x) * ease
    smoothPointer.current.y += (pointer[1] - smoothPointer.current.y) * ease
    mat.uniforms.uPointer.value.set(
      smoothPointer.current.x,
      smoothPointer.current.y,
    )
  })

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        uniforms={shaderUniforms}
        transparent
      />
    </mesh>
  )
}

export default function StarSwipe({
  width = '100%',
  height = '100%',
  className,
  children,
  speed = 0.2,
  scale = 1.5,
  warpStrength = 1.5,
  warpCurvature = 6.0,
  warpFalloff = 4.0,
  scrollSpeed = 6.0,
  noiseAmount = 0.5,
  colorIntensity = 0.1,
  colorSeparation = 0,
  rotation = -45,
  color = '#FF9FFC',
  backgroundColor = '#000000',
  opacity = 1,
  cursorInteraction = false,
  cursorIntensity = 1,
}) {
  const tintRgb = useMemo(() => parseHexColor(color), [color])
  const bgRgb = useMemo(() => parseHexColor(backgroundColor), [backgroundColor])

  const containerRef = useRef(null)
  const [pointer, setPointer] = useState([0.5, 0.5])

  const handlePointerMove = useCallback(
    (e) => {
      if (!cursorInteraction) return
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const nx = (e.clientX - rect.left) / rect.width
      const ny = 1 - (e.clientY - rect.top) / rect.height
      setPointer([nx, ny])
    },
    [cursorInteraction],
  )

  return (
    <div
      ref={containerRef}
      className={`star-swipe-container ${className || ''}`}
      style={{ width, height, backgroundColor }}
      onPointerMove={handlePointerMove}
    >
      <Canvas
        className="star-swipe-canvas"
        orthographic
        camera={{ position: [0, 0, 1], zoom: 1, left: -1, right: 1, top: 1, bottom: -1 }}
        gl={{ antialias: true, alpha: true }}
      >
        <StarSwipeScene
          speed={speed}
          scale={scale}
          warpStrength={warpStrength}
          warpCurvature={warpCurvature}
          warpFalloff={warpFalloff}
          scrollSpeed={scrollSpeed}
          noiseAmount={noiseAmount}
          colorIntensity={colorIntensity}
          colorSeparation={colorSeparation}
          rotation={rotation}
          tintRgb={tintRgb}
          bgRgb={bgRgb}
          opacity={opacity}
          pointer={pointer}
          cursorInteraction={cursorInteraction}
          cursorIntensity={cursorIntensity}
        />
      </Canvas>
      {children && <div className="star-swipe-content">{children}</div>}
    </div>
  )
}
