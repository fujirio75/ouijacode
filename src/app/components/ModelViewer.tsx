import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { createOrbitalField } from './OrbitalField';

const ENABLE_MODEL_INTERACTION = true;
const PLUSH_SHADER_KEY = 'w3-plush-soft-v1';
const FUR_STRANDS_PER_MESH = 240000;
const FUR_LENGTH_RATIO = 0.022;
const FUR_LINE_WIDTH = 1.75;
const FUR_REFLECTION_STRENGTH = 0.14;
const FUR_BUNDLE_SHEEN_STRENGTH = 0.24;
const LIGHT_TEXTURE_FUR_MASK_THRESHOLD = 0.58;
const EAR_BACK_OFFSET = 0.024;

type LightTextureMask = {
  data: Uint8ClampedArray;
  height: number;
  texture: THREE.Texture;
  uv: THREE.Vector2;
  width: number;
};

interface ModelViewerProps {
  modelUrl?: string;
  onActivate?: () => void;
}

type BallAnimation = {
  baseQuaternion: THREE.Quaternion;
  baseScale: THREE.Vector3;
  currentGaze: THREE.Vector2;
  group: THREE.Group;
  nextSaccadeAt: number;
  random: () => number;
  targetGaze: THREE.Vector2;
};

type FloatingNodeAnimation = {
  basePosition: THREE.Vector3;
  currentPosition: THREE.Vector3;
  drift: THREE.Vector3;
  endpointDot: THREE.Mesh;
  glow: THREE.Sprite;
  index: number;
  labelOffset: THREE.Vector3;
  phase: number;
  sprite: THREE.Sprite;
  spriteBaseScale: THREE.Vector3;
};

type PathPulseAnimation = {
  mesh: THREE.Mesh;
  phase: number;
  speed: number;
};

type FloatingPathAnimation = {
  glowLine: THREE.Line;
  line: THREE.Line;
  pulses: PathPulseAnimation[];
};

type FloatingSpriteAnimation = {
  basePosition: THREE.Vector3;
  baseScale: THREE.Vector3;
  phase: number;
  sprite: THREE.Sprite;
};

type FloatingCueAnimation = {
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  drift: THREE.Vector3;
  group: THREE.Group;
  index: number;
  phase: number;
  spinSpeed: number;
};

type NodeSpaceAnimations = {
  ball: BallAnimation | null;
  cues: FloatingCueAnimation[];
  field: ReturnType<typeof createOrbitalField> | null;
  nodes: FloatingNodeAnimation[];
  path: FloatingPathAnimation | null;
  sprites: FloatingSpriteAnimation[];
};

function tunePlushMaterial(material: THREE.MeshStandardMaterial, envMap: THREE.Texture | null) {
  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.map.anisotropy = 8;
  }

  material.emissive.set(0x000000);
  material.emissiveIntensity = 0;
  material.emissiveMap = null;
  material.color.set(0xc8c3bb);
  material.roughness = 0.98;
  material.metalness = 0;
  material.envMapIntensity = 0.08;

  if (material.normalMap) {
    material.normalScale.set(0.72, 0.72);
  }

  if (envMap) {
    material.envMap = envMap;
  }

  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      #include <map_fragment>

      float plushLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      float whiteMask = smoothstep(0.54, 0.9, plushLuma);
      float darkMask = 1.0 - smoothstep(0.03, 0.2, plushLuma);
      vec3 softWhite = vec3(0.72, 0.71, 0.68);
      vec3 liftedBlack = diffuseColor.rgb * 1.62 + vec3(0.01, 0.01, 0.012);
      float furGrain = 0.5;
      #ifdef USE_MAP
        furGrain = fract(sin(dot(vMapUv * vec2(860.0, 1240.0), vec2(12.9898, 78.233))) * 43758.5453);
      #endif

      diffuseColor.rgb = mix(diffuseColor.rgb, softWhite, whiteMask * 0.66);
      diffuseColor.rgb = mix(diffuseColor.rgb, liftedBlack, darkMask * 0.48);
      diffuseColor.rgb += (furGrain - 0.45) * 0.018 * darkMask;
      diffuseColor.rgb *= mix(0.96, 0.84, whiteMask);
      `
    );
  };
  material.customProgramCacheKey = () => PLUSH_SHADER_KEY;
  material.needsUpdate = true;
}

function smoothPlushGeometry(geometry: THREE.BufferGeometry) {
  const smoothed = geometry.clone();
  smoothed.deleteAttribute('normal');
  const merged = mergeVertices(smoothed, 0.00001);
  smoothed.dispose();
  merged.computeVertexNormals();
  return merged;
}

function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function findWeightedTriangle(cumulativeAreas: Float32Array, target: number) {
  let low = 0;
  let high = cumulativeAreas.length - 1;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (target <= cumulativeAreas[mid]) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return low;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function furBundleSheen(
  x: number,
  y: number,
  z: number,
  lightFacing: number,
  viewFacing: number
) {
  const broadBundle = Math.pow(
    0.5 + 0.5 * Math.sin(x * 132 + z * 92 + Math.sin(y * 42) * 1.7),
    5
  );
  const fineFiber = Math.pow(
    0.5 + 0.5 * Math.sin(x * 540 + z * 320 + y * 76),
    14
  );
  const softPatch = 0.72 + (0.5 + 0.5 * Math.sin(x * 39 - y * 63 + z * 47)) * 0.28;
  const surfaceAngle = smoothstep(0.05, 0.72, lightFacing) * (0.55 + smoothstep(-0.18, 0.7, viewFacing) * 0.45);

  return (broadBundle * 0.78 + fineFiber * 0.34) * softPatch * surfaceAngle;
}

function writeFurColor(colors: Float32Array, offset: number, shade: number, bundleSheen: number) {
  colors[offset] = shade * 0.82;
  colors[offset + 1] = shade * 0.87;
  colors[offset + 2] = shade * (0.95 + bundleSheen * 0.08);
}

function pushEarsBack(geometry: THREE.BufferGeometry) {
  const positionAttribute = geometry.getAttribute('position');
  if (!positionAttribute) return;

  for (let i = 0; i < positionAttribute.count; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);
    const z = positionAttribute.getZ(i);
    const sideWeight = smoothstep(0.017, 0.027, Math.abs(x));
    const heightWeight = smoothstep(0.068, 0.105, y);
    const weight = sideWeight * heightWeight;

    if (weight > 0) {
      positionAttribute.setZ(i, z - EAR_BACK_OFFSET * weight);
    }
  }

  positionAttribute.needsUpdate = true;
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function createLightTextureMask(materials: THREE.Material[]) {
  const texturedMaterial = materials.find(
    (material): material is THREE.MeshStandardMaterial => (
      material instanceof THREE.MeshStandardMaterial && Boolean(material.map?.image)
    )
  );
  const texture = texturedMaterial?.map;
  const image = texture?.image as (CanvasImageSource & {
    height?: number;
    naturalHeight?: number;
    naturalWidth?: number;
    videoHeight?: number;
    videoWidth?: number;
    width?: number;
  }) | undefined;

  if (!texture || !image) return null;

  const width = image.videoWidth ?? image.naturalWidth ?? image.width ?? 0;
  const height = image.videoHeight ?? image.naturalHeight ?? image.height ?? 0;
  if (width <= 0 || height <= 0) return null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(image, 0, 0, width, height);

    return {
      data: context.getImageData(0, 0, width, height).data,
      height,
      texture,
      uv: new THREE.Vector2(),
      width
    };
  } catch (error) {
    console.warn('Texture sampling for fur mask was skipped:', error);
    return null;
  }
}

function sampleTextureLuma(mask: LightTextureMask, u: number, v: number) {
  mask.uv.set(u, v);
  mask.texture.transformUv(mask.uv);

  const x = Math.max(0, Math.min(mask.width - 1, Math.floor(mask.uv.x * mask.width)));
  const y = Math.max(0, Math.min(mask.height - 1, Math.floor(mask.uv.y * mask.height)));
  const index = (y * mask.width + x) * 4;
  const alpha = mask.data[index + 3] / 255;
  if (alpha <= 0.05) return 0;

  return (
    mask.data[index] * 0.299 +
    mask.data[index + 1] * 0.587 +
    mask.data[index + 2] * 0.114
  ) / 255;
}

function isLightTextureFurMask(mask: LightTextureMask, u: number, v: number) {
  if (sampleTextureLuma(mask, u, v) >= LIGHT_TEXTURE_FUR_MASK_THRESHOLD) return true;

  const du = 2 / mask.width;
  const dv = 2 / mask.height;
  return (
    sampleTextureLuma(mask, u + du, v) >= 0.68 ||
    sampleTextureLuma(mask, u - du, v) >= 0.68 ||
    sampleTextureLuma(mask, u, v + dv) >= 0.68 ||
    sampleTextureLuma(mask, u, v - dv) >= 0.68
  );
}

function insideEllipsoid(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number
) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  const dz = (z - cz) / rz;
  return dx * dx + dy * dy + dz * dz <= 1;
}

function isEyeFurMask(x: number, y: number, z: number) {
  if (y < 0.052 || y > 0.108 || z < 0.012) return false;

  return (
    insideEllipsoid(x, y, z, -0.014, 0.078, 0.039, 0.019, 0.027, 0.022) ||
    insideEllipsoid(x, y, z, 0.014, 0.078, 0.039, 0.019, 0.027, 0.022)
  );
}

function shouldSkipFurRoot(
  x: number,
  y: number,
  z: number,
  u: number | null,
  v: number | null,
  lightTextureMask: LightTextureMask | null
) {
  if (isEyeFurMask(x, y, z)) return true;
  return u !== null && v !== null && lightTextureMask !== null && isLightTextureFurMask(lightTextureMask, u, v);
}

function addSurfaceFur(mesh: THREE.Mesh, lightTextureMask: LightTextureMask | null) {
  if (mesh.getObjectByName(`${mesh.name}_surface_fur`)) return;

  const positionAttribute = mesh.geometry.getAttribute('position');
  const normalAttribute = mesh.geometry.getAttribute('normal');
  const uvAttribute = mesh.geometry.getAttribute('uv');
  if (!positionAttribute || !normalAttribute) return;

  const indexAttribute = mesh.geometry.getIndex();
  const triangleCount = indexAttribute
    ? Math.floor(indexAttribute.count / 3)
    : Math.floor(positionAttribute.count / 3);
  if (triangleCount <= 0) return;

  const vertexIndexAt = (triangleIndex: number, corner: number) => (
    indexAttribute
      ? indexAttribute.getX(triangleIndex * 3 + corner)
      : triangleIndex * 3 + corner
  );

  const cumulativeAreas = new Float32Array(triangleCount);
  let totalArea = 0;

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    const ia = vertexIndexAt(triangleIndex, 0);
    const ib = vertexIndexAt(triangleIndex, 1);
    const ic = vertexIndexAt(triangleIndex, 2);
    const ax = positionAttribute.getX(ia);
    const ay = positionAttribute.getY(ia);
    const az = positionAttribute.getZ(ia);
    const abx = positionAttribute.getX(ib) - ax;
    const aby = positionAttribute.getY(ib) - ay;
    const abz = positionAttribute.getZ(ib) - az;
    const acx = positionAttribute.getX(ic) - ax;
    const acy = positionAttribute.getY(ic) - ay;
    const acz = positionAttribute.getZ(ic) - az;
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;

    totalArea += Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ) * 0.5;
    cumulativeAreas[triangleIndex] = totalArea;
  }

  if (totalArea <= 0) return;

  mesh.geometry.computeBoundingSphere();
  const radius = mesh.geometry.boundingSphere?.radius ?? 1;
  const strandLength = radius * FUR_LENGTH_RATIO;
  const strandCount = FUR_STRANDS_PER_MESH;
  const random = seededRandom(positionAttribute.count + triangleCount * 17 + mesh.name.length * 97);

  const positions = new Float32Array(strandCount * 12);
  const colors = new Float32Array(strandCount * 12);
  let writeOffset = 0;
  let acceptedStrands = 0;
  let attempts = 0;
  const maxAttempts = strandCount * 4;
  const normal = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bitangent = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const randomBend = new THREE.Vector3();
  const groomDirection = new THREE.Vector3();
  const basisY = new THREE.Vector3(0, 1, 0);
  const basisX = new THREE.Vector3(1, 0, 0);
  const strandDirection = new THREE.Vector3();
  const furLightDirection = new THREE.Vector3(-0.35, 0.72, 0.6).normalize();
  const furViewDirection = new THREE.Vector3(0, 0.15, 1).normalize();
  const furHalfDirection = new THREE.Vector3()
    .addVectors(furLightDirection, furViewDirection)
    .normalize();
  const furRimDirection = new THREE.Vector3(0.45, 0.55, -0.7).normalize();

  while (acceptedStrands < strandCount && attempts < maxAttempts) {
    attempts++;
    const triangleIndex = findWeightedTriangle(cumulativeAreas, random() * totalArea);
    const ia = vertexIndexAt(triangleIndex, 0);
    const ib = vertexIndexAt(triangleIndex, 1);
    const ic = vertexIndexAt(triangleIndex, 2);
    let u = random();
    let v = random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;

    const x =
      positionAttribute.getX(ia) * w +
      positionAttribute.getX(ib) * u +
      positionAttribute.getX(ic) * v;
    const y =
      positionAttribute.getY(ia) * w +
      positionAttribute.getY(ib) * u +
      positionAttribute.getY(ic) * v;
    const z =
      positionAttribute.getZ(ia) * w +
      positionAttribute.getZ(ib) * u +
      positionAttribute.getZ(ic) * v;
    const sampleU = uvAttribute
      ? uvAttribute.getX(ia) * w + uvAttribute.getX(ib) * u + uvAttribute.getX(ic) * v
      : null;
    const sampleV = uvAttribute
      ? uvAttribute.getY(ia) * w + uvAttribute.getY(ib) * u + uvAttribute.getY(ic) * v
      : null;

    if (shouldSkipFurRoot(x, y, z, sampleU, sampleV, lightTextureMask)) continue;

    normal
      .set(
        normalAttribute.getX(ia) * w + normalAttribute.getX(ib) * u + normalAttribute.getX(ic) * v,
        normalAttribute.getY(ia) * w + normalAttribute.getY(ib) * u + normalAttribute.getY(ic) * v,
        normalAttribute.getZ(ia) * w + normalAttribute.getZ(ib) * u + normalAttribute.getZ(ic) * v
      )
      .normalize();

    tangent.crossVectors(Math.abs(normal.y) < 0.92 ? basisY : basisX, normal).normalize();
    bitangent.crossVectors(normal, tangent).normalize();

    const angle = random() * Math.PI * 2;
    randomBend
      .copy(tangent)
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(bitangent, Math.sin(angle))
      .normalize();
    groomDirection.set(x * 5.2, -1, -0.12);
    groomDirection.addScaledVector(normal, -groomDirection.dot(normal));
    if (groomDirection.lengthSq() < 0.000001) {
      groomDirection.copy(randomBend);
    } else {
      groomDirection.normalize();
    }
    bend
      .copy(groomDirection)
      .multiplyScalar(0.64 + random() * 0.18)
      .addScaledVector(randomBend, 0.24 + random() * 0.16)
      .normalize();

    const length = strandLength * (0.45 + random() * 0.75);
    const lean = length * (0.45 + random() * 0.95);
    const wave = (random() - 0.5) * length * 0.32;
    const rootOffset = strandLength * 0.04;

    const sx = x + normal.x * rootOffset;
    const sy = y + normal.y * rootOffset;
    const sz = z + normal.z * rootOffset;
    const mx = sx + normal.x * length * 0.22 + bend.x * lean * 0.45;
    const my = sy + normal.y * length * 0.22 + bend.y * lean * 0.45;
    const mz = sz + normal.z * length * 0.22 + bend.z * lean * 0.45;
    const ex = sx + normal.x * length * 0.48 + bend.x * lean + bitangent.x * wave;
    const ey = sy + normal.y * length * 0.48 + bend.y * lean + bitangent.y * wave;
    const ez = sz + normal.z * length * 0.48 + bend.z * lean + bitangent.z * wave;

    positions[writeOffset] = sx;
    positions[writeOffset + 1] = sy;
    positions[writeOffset + 2] = sz;
    positions[writeOffset + 3] = mx;
    positions[writeOffset + 4] = my;
    positions[writeOffset + 5] = mz;
    positions[writeOffset + 6] = mx;
    positions[writeOffset + 7] = my;
    positions[writeOffset + 8] = mz;
    positions[writeOffset + 9] = ex;
    positions[writeOffset + 10] = ey;
    positions[writeOffset + 11] = ez;

    strandDirection.set(ex - sx, ey - sy, ez - sz).normalize();
    const lightFacing = Math.max(0, normal.dot(furLightDirection));
    const viewFacing = normal.dot(furViewDirection);
    const strandSheen = Math.pow(Math.abs(strandDirection.dot(furHalfDirection)), 16);
    const bundleSheen = furBundleSheen(x, y, z, lightFacing, viewFacing);
    const rimSheen = Math.pow(Math.max(0, normal.dot(furRimDirection)), 7) * 0.12;
    const softTopSheen = Math.pow(lightFacing, 4) * 0.04;
    const strandGlint = 0.72 + random() * 0.28;
    const reflection = Math.min(
      0.28,
      (
        (strandSheen + rimSheen + softTopSheen) * FUR_REFLECTION_STRENGTH +
        bundleSheen * FUR_BUNDLE_SHEEN_STRENGTH * (0.45 + strandSheen * 0.55)
      ) * strandGlint
    );
    const rootShade = 0.001 + random() * 0.003 + reflection * 0.06;
    const midShade = 0.006 + random() * 0.006 + reflection * 0.34;
    const tipShade = 0.013 + random() * 0.014 + reflection * 0.78;
    writeFurColor(colors, writeOffset, rootShade, bundleSheen);
    writeFurColor(colors, writeOffset + 3, midShade, bundleSheen);
    writeFurColor(colors, writeOffset + 6, midShade, bundleSheen);
    writeFurColor(colors, writeOffset + 9, tipShade, bundleSheen);
    writeOffset += 12;
    acceptedStrands++;
  }

  if (writeOffset <= 0) return;

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(writeOffset === positions.length ? positions : positions.slice(0, writeOffset));
  geometry.setColors(writeOffset === colors.length ? colors : colors.slice(0, writeOffset));

  const material = new LineMaterial({
    vertexColors: true,
    transparent: true,
    linewidth: FUR_LINE_WIDTH,
    opacity: 0.68,
    depthWrite: false,
    alphaToCoverage: true
  });

  const fur = new LineSegments2(geometry, material);
  fur.name = `${mesh.name}_surface_fur`;
  fur.renderOrder = 2;
  mesh.add(fur);
}

const ACCENT_RED = 0xd91432;
const ACCENT_RED_CSS = '#d91432';
const BALL_RED = 0xc8102e;
const EIGHT_BALL_SIZE = 3.2;

const SKILL_NODES = [
  {
    drift: new THREE.Vector3(0.06, 0.12, 0.2),
    label: 'Unity',
    labelOffset: new THREE.Vector3(-0.18, 0.34, 0.04),
    phase: 0.2,
    position: new THREE.Vector3(-3.7, 2.15, 1.15),
    size: 0.34
  },
  {
    drift: new THREE.Vector3(0.1, 0.16, 0.14),
    label: 'C#',
    labelOffset: new THREE.Vector3(0.16, 0.3, 0.04),
    phase: 1.1,
    position: new THREE.Vector3(3.4, 1.55, -1.5),
    size: 0.27
  },
  {
    drift: new THREE.Vector3(0.14, 0.09, 0.22),
    label: 'TypeScript',
    labelOffset: new THREE.Vector3(-0.12, 0.34, 0.04),
    phase: 2.3,
    position: new THREE.Vector3(-2.25, 1.05, -2.65),
    size: 0.3
  },
  {
    drift: new THREE.Vector3(0.08, 0.18, 0.16),
    label: 'React',
    labelOffset: new THREE.Vector3(0.18, 0.3, 0.04),
    phase: 3.2,
    position: new THREE.Vector3(3.65, 0.55, 1.65),
    size: 0.28
  },
  {
    drift: new THREE.Vector3(0.16, 0.12, 0.24),
    label: 'Git',
    labelOffset: new THREE.Vector3(-0.2, -0.3, 0.04),
    phase: 4.4,
    position: new THREE.Vector3(-3.4, -0.45, 2.1),
    size: 0.25
  },
  {
    drift: new THREE.Vector3(0.09, 0.15, 0.18),
    label: 'Three.js',
    labelOffset: new THREE.Vector3(0.2, 0.32, 0.04),
    phase: 0.8,
    position: new THREE.Vector3(2.2, -0.72, -2.9),
    size: 0.32
  },
  {
    drift: new THREE.Vector3(0.15, 0.1, 0.25),
    label: 'WebGL',
    labelOffset: new THREE.Vector3(0.3, 0.34, 0.04),
    phase: 1.7,
    position: new THREE.Vector3(-0.75, -1.88, 2.5),
    size: 0.27
  },
  {
    drift: new THREE.Vector3(0.11, 0.17, 0.16),
    label: 'Shader Graph',
    labelOffset: new THREE.Vector3(0.2, -0.32, 0.04),
    phase: 2.8,
    position: new THREE.Vector3(3.2, -2, -0.45),
    size: 0.29
  },
  {
    drift: new THREE.Vector3(0.13, 0.11, 0.21),
    label: 'URP',
    labelOffset: new THREE.Vector3(-0.2, 0.32, 0.04),
    phase: 3.8,
    position: new THREE.Vector3(-3.6, -1.7, -1.6),
    size: 0.25
  },
  {
    drift: new THREE.Vector3(0.08, 0.19, 0.17),
    label: 'Addressables',
    labelOffset: new THREE.Vector3(-0.18, 0.3, 0.04),
    phase: 5.1,
    position: new THREE.Vector3(-1, 2, 2.25),
    size: 0.29
  }
];

function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Texture();

  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.28, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.58)');
  gradient.addColorStop(0.72, 'rgba(255, 255, 255, 0.16)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createTextSprite(text: string, height = 0.27) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Sprite(new THREE.SpriteMaterial({ color: ACCENT_RED }));

  const canvasHeight = 180;
  let fontSize = 92;
  context.font = `500 ${fontSize}px "Sofia Pro", Arial, sans-serif`;
  while (context.measureText(text).width > 820 && fontSize > 54) {
    fontSize -= 4;
    context.font = `500 ${fontSize}px "Sofia Pro", Arial, sans-serif`;
  }

  const textWidth = Math.ceil(context.measureText(text).width);
  canvas.width = Math.max(220, textWidth + 72);
  canvas.height = canvasHeight;
  const drawingContext = canvas.getContext('2d');
  if (!drawingContext) return new THREE.Sprite(new THREE.SpriteMaterial({ color: ACCENT_RED }));

  drawingContext.clearRect(0, 0, canvas.width, canvas.height);
  drawingContext.fillStyle = ACCENT_RED_CSS;
  drawingContext.font = `500 ${fontSize}px "Sofia Pro", Arial, sans-serif`;
  drawingContext.textAlign = 'center';
  drawingContext.textBaseline = 'middle';
  drawingContext.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    depthWrite: false,
    transparent: true
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(height * (canvas.width / canvas.height), height, 1);
  return sprite;
}

async function createAccentSvgSprite(url: string, height: number) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load SVG: ${url}`);

  const source = await response.text();
  const viewBox = source.match(/viewBox="([^"]+)"/i)?.[1].split(/\s+/).map(Number);
  const aspect = viewBox && viewBox.length === 4 && viewBox[3] > 0
    ? viewBox[2] / viewBox[3]
    : 3;
  const accentSource = source
    .replace(/#FF5656/gi, ACCENT_RED_CSS)
    .replace(/rgb\(255\s+86\s+86[^)]*\)/gi, ACCENT_RED_CSS);
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(accentSource)}`;
  const texture = await new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(dataUrl, resolve, undefined, reject);
  });

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    toneMapped: false,
    depthWrite: false,
    transparent: true
  }));
  sprite.scale.set(height * aspect, height, 1);
  return sprite;
}

function tuneEightBallMaterial(mesh: THREE.Mesh) {
  if (/Eight_Ball_Phenolic_Resin/i.test(mesh.name)) {
    const originalGeometry = mesh.geometry;
    mesh.geometry = new THREE.SphereGeometry(1, 96, 64);
    mesh.geometry.computeVertexNormals();
    originalGeometry.dispose();
  }

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material) => {
    if (material instanceof THREE.MeshStandardMaterial) {
      if (/polished phenolic resin\s*-\s*black/i.test(material.name)) {
        material.color.set(BALL_RED);
      }

      material.emissive.set(0x000000);
      material.emissiveIntensity = 0;
      material.envMapIntensity = 0;
      material.flatShading = false;
      material.metalness = 0;
      material.normalMap = null;
      material.roughness = 1;

      if (material instanceof THREE.MeshPhysicalMaterial) {
        material.clearcoat = 0;
        material.clearcoatRoughness = 1;
        material.iridescence = 0;
        material.sheen = 0;
        material.specularIntensity = 0;
      }

      material.needsUpdate = true;
    }
  });
}

function createSkillNode(
  root: THREE.Group,
  definition: (typeof SKILL_NODES)[number],
  glowTexture: THREE.Texture,
  index: number,
) {
  const { drift, label, labelOffset, phase, position, size } = definition;
  const dotGeometry = new THREE.SphereGeometry(index % 3 === 0 ? 0.045 : 0.034, 12, 12);
  const dotMaterial = new THREE.MeshBasicMaterial({
    color: ACCENT_RED,
    opacity: 0.88,
    transparent: true
  });
  const endpointDot = new THREE.Mesh(dotGeometry, dotMaterial);
  endpointDot.position.copy(position);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    blending: THREE.NormalBlending,
    color: ACCENT_RED,
    depthWrite: false,
    map: glowTexture,
    opacity: 0.16,
    transparent: true
  }));
  const glowSize = index % 3 === 0 ? 0.32 : 0.24;
  glow.position.copy(position);
  glow.scale.set(glowSize, glowSize, 1);

  const sprite = createTextSprite(label, size);
  sprite.position.copy(position).add(labelOffset);
  const spriteBaseScale = sprite.scale.clone();

  root.add(glow, endpointDot, sprite);
  return {
    basePosition: position.clone(),
    currentPosition: position.clone(),
    drift: drift.clone(),
    endpointDot,
    glow,
    index,
    labelOffset: labelOffset.clone(),
    phase,
    sprite,
    spriteBaseScale
  } satisfies FloatingNodeAnimation;
}

function createSkillPath(
  root: THREE.Group,
  nodes: FloatingNodeAnimation[]
) {
  const geometry = new THREE.BufferGeometry().setFromPoints(
    nodes.map((node) => node.currentPosition)
  );
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color: ACCENT_RED,
      depthWrite: false,
      opacity: 0.42,
      transparent: true
    })
  );
  line.frustumCulled = false;

  const glowLine = new THREE.Line(
    geometry.clone(),
    new THREE.LineBasicMaterial({
      blending: THREE.NormalBlending,
      color: ACCENT_RED,
      depthWrite: false,
      opacity: 0.09,
      transparent: true
    })
  );
  glowLine.frustumCulled = false;

  const pulses: PathPulseAnimation[] = Array.from({ length: 4 }, (_, index) => {
    const radius = index === 0 ? 0.047 : 0.026 + index * 0.004;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 10, 10),
      new THREE.MeshBasicMaterial({
        blending: THREE.NormalBlending,
        color: ACCENT_RED,
        depthWrite: false,
        opacity: 0.68,
        transparent: true
      })
    );
    root.add(mesh);
    return {
      mesh,
      phase: index * 0.237,
      speed: 0.018 + index * 0.0045
    };
  });

  root.add(glowLine, line);
  return { glowLine, line, pulses } satisfies FloatingPathAnimation;
}

function createCueWoodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Texture();

  context.fillStyle = '#f4f1e9';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const random = seededRandom(49271);
  for (let index = 0; index < 84; index++) {
    const startX = random() * canvas.width;
    const bend = (random() - 0.5) * 18;
    context.beginPath();
    context.moveTo(startX, -8);
    context.bezierCurveTo(
      startX + bend,
      canvas.height * 0.28,
      startX - bend * 0.7,
      canvas.height * 0.72,
      startX + bend * 0.35,
      canvas.height + 8
    );
    context.strokeStyle = `rgba(74, 42, 18, ${0.025 + random() * 0.075})`;
    context.lineWidth = 0.35 + random() * 1.15;
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.2, 1);
  texture.anisotropy = 8;
  return texture;
}

function createBilliardCuePrototype() {
  const cue = new THREE.Group();
  cue.name = 'realistic_billiard_cue_prototype';
  const woodTexture = createCueWoodTexture();
  const maple = new THREE.MeshStandardMaterial({
    color: 0xe8c99b,
    envMapIntensity: 0.25,
    map: woodTexture,
    metalness: 0,
    roughness: 0.68
  });
  const accent = new THREE.MeshStandardMaterial({
    color: ACCENT_RED,
    envMapIntensity: 0.28,
    map: woodTexture,
    metalness: 0,
    roughness: 0.58
  });
  const accentDark = accent.clone();
  accentDark.color.set(0x4b0b18);
  accentDark.roughness = 0.65;
  const ivory = new THREE.MeshStandardMaterial({
    color: 0xf2eadc,
    envMapIntensity: 0.7,
    metalness: 0,
    roughness: 0.28
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0xc9cdd0,
    envMapIntensity: 1.25,
    metalness: 0.9,
    roughness: 0.18
  });
  const grip = new THREE.MeshStandardMaterial({
    color: 0x181414,
    metalness: 0,
    roughness: 0.86
  });
  const leather = new THREE.MeshStandardMaterial({
    color: 0x25435b,
    metalness: 0,
    roughness: 0.92
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x111111,
    metalness: 0,
    roughness: 0.96
  });

  const addCylinder = (
    name: string,
    radiusTop: number,
    radiusBottom: number,
    height: number,
    y: number,
    material: THREE.MeshStandardMaterial,
    materialRole: string
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 24, 1, false),
      material
    );
    mesh.name = name;
    mesh.position.y = y;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.materialRole = materialRole;
    cue.add(mesh);
    return mesh;
  };

  // A 58-inch playing cue is typically split into a 29-inch shaft and 29-inch butt.
  addCylinder('Leather tip', 0.024, 0.0255, 0.04, 2.98, leather, 'leather');
  addCylinder('Ivory ferrule', 0.0255, 0.029, 0.075, 2.9225, ivory, 'ivory');
  addCylinder('Maple shaft', 0.0285, 0.044, 2.83, 1.47, maple, 'shaft');
  addCylinder('Shaft joint collar', 0.045, 0.045, 0.055, 0.0275, ivory, 'ivory');
  addCylinder('Stainless joint ring', 0.047, 0.047, 0.05, -0.025, metal, 'metal');
  addCylinder('Butt joint collar', 0.049, 0.049, 0.07, -0.085, accentDark, 'accent-dark');
  addCylinder('Tapered forearm', 0.049, 0.057, 1.1, -0.67, accent, 'accent');
  addCylinder('Forearm trim ring', 0.058, 0.058, 0.05, -1.245, metal, 'metal');
  addCylinder('Linen grip', 0.058, 0.061, 0.9, -1.72, grip, 'grip');
  addCylinder('Grip trim ring', 0.062, 0.062, 0.05, -2.195, ivory, 'ivory');
  addCylinder('Decorated butt sleeve', 0.062, 0.065, 0.55, -2.495, accentDark, 'accent-dark');
  addCylinder('Butt sleeve trim ring', 0.066, 0.066, 0.04, -2.79, metal, 'metal');
  addCylinder('Ivory butt cap', 0.066, 0.066, 0.12, -2.87, ivory, 'ivory');
  addCylinder('Rubber bumper', 0.048, 0.057, 0.07, -2.965, rubber, 'rubber');

  const addInlaySet = (name: string, y: number, radius: number, height: number) => {
    for (let index = 0; index < 4; index++) {
      const angle = index * Math.PI * 0.5;
      const inlay = new THREE.Mesh(
        new THREE.OctahedronGeometry(1, 0),
        ivory
      );
      inlay.name = `${name}_${index + 1}`;
      inlay.position.set(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
      inlay.rotation.y = angle;
      inlay.scale.set(0.011, height, 0.0055);
      inlay.userData.materialRole = 'ivory';
      cue.add(inlay);
    }
  };
  addInlaySet('Forearm diamond inlay', -0.68, 0.055, 0.16);
  addInlaySet('Butt sleeve diamond inlay', -2.49, 0.063, 0.12);

  return cue;
}

function cloneCueWithColor(prototype: THREE.Group, color: THREE.ColorRepresentation) {
  const cue = prototype.clone(true);
  const accentColor = new THREE.Color(color);
  cue.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const sourceMaterial = Array.isArray(child.material) ? child.material[0] : child.material;
    if (!(sourceMaterial instanceof THREE.MeshStandardMaterial)) return;
    const material = sourceMaterial.clone();
    const role = child.userData.materialRole;
    if (role === 'accent') {
      material.color.copy(accentColor);
    } else if (role === 'accent-dark') {
      material.color.copy(accentColor).multiplyScalar(0.7);
    }
    child.material = material;
  });
  return cue;
}

function createFloatingCues(root: THREE.Group) {
  const prototype = createBilliardCuePrototype();
  const definitions = [
    { color: '#ed2546', drift: [0.13, 0.12, 0.2], phase: 0.2, position: [-4.7, 1.9, 1.8], rotation: [0.18, 0.42, -0.46], scale: 0.88 },
    { color: '#245bce', drift: [0.1, 0.16, 0.15], phase: 0.9, position: [4.65, 2.65, 0.4], rotation: [0.35, -0.58, 0.52], scale: 0.54 },
    { color: '#069d7a', drift: [0.16, 0.1, 0.19], phase: 1.7, position: [-4.3, -3.1, 2.5], rotation: [-0.28, 0.5, 0.88], scale: 0.96 },
    { color: '#f6c200', drift: [0.12, 0.17, 0.13], phase: 2.5, position: [4.65, -2.6, 1.9], rotation: [0.32, 0.2, -0.38], scale: 0.89 },
    { color: '#7a36b0', drift: [0.09, 0.14, 0.22], phase: 3.3, position: [-2.2, 2.8, -0.1], rotation: [0.25, 0.26, -0.43], scale: 0.4 },
    { color: '#ff721b', drift: [0.15, 0.11, 0.18], phase: 4.1, position: [0.1, -4.1, 0.7], rotation: [-0.3, -0.38, -0.48], scale: 0.65 },
    { color: '#00a9bb', drift: [0.11, 0.18, 0.16], phase: 4.9, position: [-2.95, 1.35, -4.3], rotation: [0.45, 0.82, -0.7], scale: 0.36 },
    { color: '#202327', drift: [0.14, 0.09, 0.21], phase: 5.7, position: [3.6, -0.1, -3.8], rotation: [-0.32, 0.62, 0.58], scale: 0.33 },
    { color: '#e50087', drift: [0.1, 0.15, 0.17], phase: 6.5, position: [-4.3, -0.45, 1.35], rotation: [0.2, -0.2, -1.28], scale: 0.63 },
    { color: '#ef641c', drift: [0.17, 0.12, 0.14], phase: 7.3, position: [4.7, -0.8, -0.6], rotation: [-0.18, 0.3, 0.83], scale: 0.43 },
    { color: '#286fce', drift: [0.12, 0.1, 0.23], phase: 8.1, position: [-4.4, -1.85, -1.2], rotation: [0.28, 0.48, -0.34], scale: 0.52 },
    { color: '#91b300', drift: [0.1, 0.19, 0.15], phase: 8.9, position: [1.3, 4.0, -2.4], rotation: [-0.48, -0.96, 0.55], scale: 0.48 },
    { color: '#ed2546', drift: [0.13, 0.13, 0.18], phase: 9.7, position: [-0.85, 3.1, -4.7], rotation: [0.3, 0.76, 0.24], scale: 0.3 },
    { color: '#03a496', drift: [0.11, 0.16, 0.2], phase: 10.5, position: [-1.85, -2.45, -2.15], rotation: [-0.24, -0.82, 0.4], scale: 0.34 },
    { color: '#ed2546', drift: [0.16, 0.11, 0.19], phase: 11.2, position: [-5.7, -2.4, -3.6], rotation: [0.28, 0.52, -0.38], scale: 0.45 },
    { color: '#245bce', drift: [0.11, 0.17, 0.14], phase: 11.9, position: [6.35, 3.2, -2.1], rotation: [-0.38, -0.64, -0.25], scale: 0.58 },
    { color: '#08ae72', drift: [0.17, 0.12, 0.18], phase: 12.6, position: [0.85, -4.5, -3.6], rotation: [-0.35, 0.46, 0.4], scale: 0.5 },
    { color: '#f6c200', drift: [0.12, 0.18, 0.15], phase: 13.3, position: [4.0, 4.3, 1.5], rotation: [0.42, 0.24, -1.05], scale: 0.64 },
    { color: '#873aca', drift: [0.1, 0.15, 0.22], phase: 14, position: [-4.15, 3.1, -2.6], rotation: [0.2, 0.32, -0.72], scale: 0.48 },
    { color: '#f07b1c', drift: [0.15, 0.12, 0.17], phase: 14.7, position: [2.45, -2.9, 0.15], rotation: [-0.22, -0.44, 0.53], scale: 0.44 },
    { color: '#0cadba', drift: [0.12, 0.19, 0.16], phase: 15.4, position: [-6.4, 0.65, -0.4], rotation: [0.3, 0.88, -1.05], scale: 0.6 },
    { color: '#202327', drift: [0.15, 0.1, 0.21], phase: 16.1, position: [5.7, 0.1, -4.2], rotation: [-0.28, 0.7, 0.25], scale: 0.41 },
    { color: '#d90080', drift: [0.11, 0.16, 0.18], phase: 16.8, position: [-2.75, 4.4, 2.4], rotation: [0.36, -0.18, -1.18], scale: 0.73 },
    { color: '#326bd6', drift: [0.13, 0.11, 0.23], phase: 17.5, position: [2.2, -4.3, -3.7], rotation: [-0.32, 0.92, 0.44], scale: 0.4 },
    { color: '#91b300', drift: [0.11, 0.18, 0.16], phase: 18.2, position: [3.55, 0.8, -1.75], rotation: [0.3, -0.84, 0.14], scale: 0.32 },
    { color: '#ba692a', drift: [0.16, 0.13, 0.15], phase: 18.9, position: [-3.1, -4.2, -0.1], rotation: [-0.28, -0.76, -0.38], scale: 0.46 }
  ] as const;

  return definitions.map((definition, index) => {
    const cue = cloneCueWithColor(prototype, definition.color);
    cue.name = `floating_billiard_cue_${index + 1}`;
    cue.position.fromArray(definition.position);
    cue.rotation.set(...definition.rotation);
    cue.scale.setScalar(definition.scale);
    root.add(cue);
    return {
      basePosition: cue.position.clone(),
      baseQuaternion: cue.quaternion.clone(),
      drift: new THREE.Vector3().fromArray(definition.drift),
      group: cue,
      index,
      phase: definition.phase,
      spinSpeed: 0.025 + (index % 5) * 0.006
    } satisfies FloatingCueAnimation;
  });
}

function addEightBallNodeSpace(root: THREE.Group, ball: THREE.Group): NodeSpaceAnimations {
  return {
    ball: {
      baseQuaternion: ball.quaternion.clone(),
      baseScale: ball.scale.clone(),
      currentGaze: new THREE.Vector2(),
      group: ball,
      nextSaccadeAt: 1.1,
      random: seededRandom(19303),
      targetGaze: new THREE.Vector2()
    },
    cues: [],
    field: createOrbitalField(root),
    nodes: [],
    path: null,
    sprites: []
  };
}

function updateNodeSpaceFraming(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  model: THREE.Group | null
) {
  if (!model?.userData.isNodeSpace) return;

  const aspect = Math.max(0.01, width / Math.max(height, 1));
  const squareFov = 60;
  const squareFovRadians = THREE.MathUtils.degToRad(squareFov);

  // Treat the square composition like object-fit: cover at every aspect ratio.
  camera.aspect = aspect;
  camera.fov = aspect > 1
    ? THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.tan(squareFovRadians * 0.5) / aspect)
    )
    : squareFov;
  camera.position.set(0, 0, 11.2);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  model.scale.setScalar(1);
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((child) => {
    const renderable = child as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    renderable.geometry?.dispose();
    const materials = renderable.material
      ? Array.isArray(renderable.material) ? renderable.material : [renderable.material]
      : [];
    materials.forEach((material) => {
      const mappedMaterial = material as THREE.Material & { map?: THREE.Texture | null };
      mappedMaterial.map?.dispose();
      material.dispose();
    });
  });
}

export function ModelViewer({ modelUrl, onActivate }: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onActivateRef = useRef(onActivate);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const isDraggingRef = useRef(false);
  const blinkMeshesRef = useRef<THREE.Mesh[]>([]);
  const armBonesRef = useRef<{ left: THREE.Bone | null; right: THREE.Bone | null }>({ left: null, right: null });
  const envMapRef = useRef<THREE.Texture | null>(null);
  const nodeSpaceAnimationsRef = useRef<NodeSpaceAnimations>({ ball: null, cues: [], field: null, nodes: [], path: null, sprites: [] });
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    model: THREE.Group | null;
    animationId: number;
  } | null>(null);

  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  useEffect(() => {
    if (!containerRef.current) return;
    nodeSpaceAnimationsRef.current = { ball: null, cues: [], field: null, nodes: [], path: null, sprites: [] };

    // シーンの初期化
    const scene = new THREE.Scene();
    scene.background = null; // 背景透過

    // カメラの設定
    const camera = new THREE.PerspectiveCamera(
      45,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 8.7);
    camera.lookAt(0, 0, 0);

    // レンダラーの設定
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0xffffff, 0);
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.78;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    containerRef.current.appendChild(renderer.domElement);

    // 環境マップ（スタジオ照明風IBL）
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envMap = pmremGenerator.fromScene(new RoomEnvironment()).texture;
    scene.environment = envMap;
    envMapRef.current = envMap;
    pmremGenerator.dispose();

    // ライティング（柔らかいぬいぐるみ撮影寄り）
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.52);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff8ef, 0.82);
    keyLight.position.set(1.5, 4.5, 5.5);
    keyLight.castShadow = true;
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 30;
    keyLight.shadow.camera.left = -5;
    keyLight.shadow.camera.right = 5;
    keyLight.shadow.camera.top = 5;
    keyLight.shadow.camera.bottom = -5;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.radius = 4;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdfe8ff, 0.28);
    fillLight.position.set(-4, 2.5, 3);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.18);
    rimLight.position.set(-1, 2.5, -5);
    scene.add(rimLight);

    const bounceLight = new THREE.HemisphereLight(0xffffff, 0x242424, 0.24);
    scene.add(bounceLight);

    // 床（グリッド）は非表示

    sceneRef.current = {
      scene,
      camera,
      renderer,
      model: null,
      animationId: 0
    };

    // リサイズハンドラ
    const handleResize = () => {
      if (!containerRef.current || !sceneRef.current) return;
      const { camera, renderer } = sceneRef.current;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      updateNodeSpaceFraming(camera, width, height, sceneRef.current.model);
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    // 空間全体を回すポインターコントロール
    let previousPointerPosition = { x: 0, y: 0 };
    let pointerStartPosition = { x: 0, y: 0 };
    let pointerTravel = 0;
    const rotation = { x: 0, y: 0 };
    const rotationVelocity = { x: 0, y: 0 };
    let elapsedTime = 0;
    let previousAnimationTime = performance.now() * 0.001;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const handlePointerDown = (event: PointerEvent) => {
      event.preventDefault();
      if (sceneRef.current?.model) {
        rotation.x = sceneRef.current.model.rotation.x;
        rotation.y = sceneRef.current.model.rotation.y;
      }
      isDraggingRef.current = true;
      renderer.domElement.setPointerCapture(event.pointerId);
      previousPointerPosition = { x: event.clientX, y: event.clientY };
      pointerStartPosition = previousPointerPosition;
      pointerTravel = 0;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingRef.current || !sceneRef.current?.model) return;

      const deltaX = event.clientX - previousPointerPosition.x;
      const deltaY = event.clientY - previousPointerPosition.y;
      pointerTravel += Math.hypot(deltaX, deltaY);
      rotationVelocity.y = deltaX * 0.00038;
      rotationVelocity.x = deltaY * 0.0003;
      rotation.y += deltaX * 0.0042;
      rotation.x += deltaY * 0.003;
      rotation.x = Math.max(-1.18, Math.min(1.18, rotation.x));

      sceneRef.current.model.rotation.y = rotation.y;
      sceneRef.current.model.rotation.x = rotation.x;

      previousPointerPosition = { x: event.clientX, y: event.clientY };
    };

    const handlePointerUp = (event: PointerEvent) => {
      isDraggingRef.current = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }

      const tapDistance = Math.hypot(
        event.clientX - pointerStartPosition.x,
        event.clientY - pointerStartPosition.y
      );
      const ball = nodeSpaceAnimationsRef.current.ball;
      if (ball && pointerTravel < 10 && tapDistance < 10) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.intersectObject(ball.group, true).length > 0) {
          onActivateRef.current?.();
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!sceneRef.current) return;
      sceneRef.current.camera.position.z += e.deltaY * 0.01;
      sceneRef.current.camera.position.z = Math.max(3, Math.min(20, sceneRef.current.camera.position.z));
    };

    if (ENABLE_MODEL_INTERACTION) {
      renderer.domElement.style.touchAction = 'none';
      renderer.domElement.addEventListener('pointerdown', handlePointerDown);
      renderer.domElement.addEventListener('pointermove', handlePointerMove);
      renderer.domElement.addEventListener('pointerup', handlePointerUp);
      renderer.domElement.addEventListener('pointercancel', handlePointerUp);
      renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });
    }

    // まばたき管理変数
    let lastBlinkTime = performance.now();
    let nextBlinkInterval = 2000 + Math.random() * 3000;
    let blinkProgress = -1;
    let blinkCount = 0;      // 現在何回目のまばたきか
    const BLINKS_PER_SET = 2; // 1セットあたりのまばたき回数

    // 浮遊アニメーション用の基準Y位置
    let floatBaseY = 0;
    let floatBaseYSet = false;
    const pathPoint = new THREE.Vector3();
    const worldPoint = new THREE.Vector3();
    const cueRotation = new THREE.Quaternion();
    const cueEuler = new THREE.Euler();
    const ballRotation = new THREE.Quaternion();
    const ballEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const labelExclusions = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];

    // アニメーションループ
    const animate = () => {
      if (!sceneRef.current) return;

      const { scene, camera, renderer, model } = sceneRef.current;
      const nowSeconds = performance.now() * 0.001;
      const deltaTime = Math.min(0.05, Math.max(0, nowSeconds - previousAnimationTime));
      previousAnimationTime = nowSeconds;
      elapsedTime += deltaTime;
      const time = elapsedTime;

      // 浮遊アニメーション（ゆっくり上下にぷかぷか）
      if (model) {
        if (!floatBaseYSet) {
          floatBaseY = model.position.y;
          floatBaseYSet = true;
        }
        model.position.y = floatBaseY + Math.sin(time * 0.72) * 0.045;

        if (!isDraggingRef.current) {
          const frameScale = Math.min(1, deltaTime * 60);
          rotation.y += rotationVelocity.y * frameScale;
          rotation.x = Math.max(
            -1.18,
            Math.min(1.18, rotation.x + rotationVelocity.x * frameScale)
          );
          model.rotation.set(rotation.x, rotation.y, 0);
          const damping = Math.pow(0.945, deltaTime * 60);
          rotationVelocity.x *= damping;
          rotationVelocity.y *= damping;
        }
      }

      const ball = nodeSpaceAnimationsRef.current.ball;
      if (ball) {
        if (time >= ball.nextSaccadeAt) {
          const horizontalDirection = ball.random() < 0.5 ? -1 : 1;
          ball.targetGaze.set(
            (ball.random() - 0.5) * 0.38,
            horizontalDirection * (0.32 + ball.random() * 0.34)
          );
          ball.nextSaccadeAt = time + 1.8 + ball.random() * 3.4;
        }

        const saccadeCatchUp = 1 - Math.exp(-deltaTime * 20);
        ball.currentGaze.lerp(ball.targetGaze, saccadeCatchUp);
        const microPitch = Math.sin(time * 10.7) * 0.009 + Math.sin(time * 17.9 + 0.8) * 0.005;
        const microYaw = Math.sin(time * 8.9 + 1.3) * 0.012 + Math.sin(time * 14.3) * 0.006;
        const microRoll = Math.sin(time * 11.8 + 2.1) * 0.006;
        ballEuler.set(
          ball.currentGaze.x + microPitch,
          ball.currentGaze.y + microYaw,
          microRoll
        );
        ballRotation.setFromEuler(ballEuler);
        ball.group.quaternion.copy(ball.baseQuaternion).multiply(ballRotation);

        const beatPhase = (time % 1.18) / 1.18;
        const firstBeat = Math.exp(-Math.pow((beatPhase - 0.08) / 0.045, 2));
        const secondBeat = Math.exp(-Math.pow((beatPhase - 0.2) / 0.06, 2));
        const release = Math.exp(-Math.pow((beatPhase - 0.31) / 0.075, 2));
        const heartbeatScale = 1 + firstBeat * 0.021 + secondBeat * 0.014 - release * 0.006;
        ball.group.scale.copy(ball.baseScale).multiplyScalar(heartbeatScale);
      }

      nodeSpaceAnimationsRef.current.cues.forEach((cue) => {
        cue.group.position.set(
          cue.basePosition.x + Math.sin(time * (0.19 + cue.index * 0.006) + cue.phase) * cue.drift.x,
          cue.basePosition.y + Math.cos(time * (0.23 + cue.index * 0.005) + cue.phase) * cue.drift.y,
          cue.basePosition.z + Math.sin(time * (0.16 + cue.index * 0.004) + cue.phase * 1.4) * cue.drift.z
        );
        cueEuler.set(
          Math.sin(time * 0.21 + cue.phase) * 0.055,
          time * cue.spinSpeed + cue.phase * 0.18,
          Math.cos(time * 0.17 + cue.phase) * 0.045
        );
        cueRotation.setFromEuler(cueEuler);
        cue.group.quaternion.copy(cue.baseQuaternion).multiply(cueRotation);
      });

      nodeSpaceAnimationsRef.current.nodes.forEach((node) => {
        const floatX =
          Math.sin(time * (0.17 + node.index * 0.013) + node.phase) * node.drift.x +
          Math.cos(time * 0.41 + node.phase * 1.7) * node.drift.x * 0.35;
        const floatY =
          Math.cos(time * (0.21 + node.index * 0.011) + node.phase) * node.drift.y +
          Math.sin(time * 0.12 + node.phase * 0.6) * node.drift.y * 0.38;
        const floatZ =
          Math.sin(time * (0.14 + node.index * 0.009) + node.phase * 1.25) * node.drift.z +
          Math.cos(time * 0.33 + node.phase) * node.drift.z * 0.24;
        node.currentPosition.set(
          node.basePosition.x + floatX,
          node.basePosition.y + floatY,
          node.basePosition.z + floatZ
        );
        node.endpointDot.position.copy(node.currentPosition);
        node.glow.position.copy(node.currentPosition);
        node.sprite.position.copy(node.currentPosition).add(node.labelOffset);
        const breath = 1 + Math.sin(time * (0.55 + node.index * 0.025) + node.phase) * 0.022;
        node.sprite.scale.copy(node.spriteBaseScale).multiplyScalar(breath);
        const glowScale = (node.index % 3 === 0 ? 0.32 : 0.24) * (
          0.86 + Math.sin(time * 0.72 + node.phase) * 0.14
        );
        node.glow.scale.set(glowScale, glowScale, 1);
      });

      const path = nodeSpaceAnimationsRef.current.path;
      if (path) {
        const nodes = nodeSpaceAnimationsRef.current.nodes;
        const linePosition = path.line.geometry.getAttribute('position');
        const glowPosition = path.glowLine.geometry.getAttribute('position');
        nodes.forEach((node, index) => {
          linePosition.setXYZ(index, node.currentPosition.x, node.currentPosition.y, node.currentPosition.z);
          glowPosition.setXYZ(index, node.currentPosition.x, node.currentPosition.y, node.currentPosition.z);
        });
        linePosition.needsUpdate = true;
        glowPosition.needsUpdate = true;

        path.pulses.forEach((pulse, index) => {
          const progress = (time * pulse.speed + pulse.phase) % 1;
          const pathProgress = progress * (nodes.length - 1);
          const segmentIndex = Math.min(nodes.length - 2, Math.floor(pathProgress));
          const segmentProgress = pathProgress - segmentIndex;
          pathPoint.lerpVectors(
            nodes[segmentIndex].currentPosition,
            nodes[segmentIndex + 1].currentPosition,
            segmentProgress
          );
          pulse.mesh.position.copy(pathPoint);
          const pulseScale = 0.72 + Math.pow(Math.sin(progress * Math.PI), 2) * 0.58;
          pulse.mesh.scale.setScalar(pulseScale);
          (pulse.mesh.material as THREE.MeshBasicMaterial).opacity =
            (0.46 + Math.sin(time * 1.4 + index) * 0.16) * Math.sin(progress * Math.PI);
        });
      }

      model?.updateMatrixWorld(true);
      const viewHeightAtCenter = 2 * camera.position.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const ballRadiusY = EIGHT_BALL_SIZE / viewHeightAtCenter;
      const ballRadiusX = ballRadiusY / camera.aspect;
      labelExclusions[0].set(-ballRadiusX, -ballRadiusY, ballRadiusX, ballRadiusY);
      nodeSpaceAnimationsRef.current.sprites.forEach((item, index) => {
        item.sprite.position.set(
          item.basePosition.x + Math.cos(time * 0.38 + item.phase) * 0.025,
          item.basePosition.y + Math.sin(time * 0.55 + item.phase) * 0.065,
          item.basePosition.z
        );
        item.sprite.scale.copy(item.baseScale).multiplyScalar(
          1 + Math.sin(time * 0.31 + item.phase) * 0.012
        );
        item.sprite.getWorldPosition(worldPoint);
        const depth = -pathPoint.copy(worldPoint).applyMatrix4(camera.matrixWorldInverse).z;
        const viewHeight = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const viewWidth = viewHeight * camera.aspect;
        const maxWidth = viewWidth * (camera.aspect < 1 ? 0.72 : 0.37);
        if (item.sprite.scale.x > maxWidth) item.sprite.scale.multiplyScalar(maxWidth / item.sprite.scale.x);
        const halfWidth = item.sprite.scale.x / viewWidth;
        const halfHeight = item.sprite.scale.y / viewHeight;
        worldPoint.project(camera);
        worldPoint.x = THREE.MathUtils.clamp(worldPoint.x, -0.94 + halfWidth, 0.94 - halfWidth);
        const side = index === 0 ? -1 : 1;
        worldPoint.y = side * THREE.MathUtils.clamp(Math.abs(worldPoint.y), ballRadiusY + halfHeight + 0.06, 0.93 - halfHeight);
        labelExclusions[index + 1].set(worldPoint.x - halfWidth, worldPoint.y - halfHeight, worldPoint.x + halfWidth, worldPoint.y + halfHeight);
        worldPoint.unproject(camera);
        item.sprite.position.copy(model!.worldToLocal(worldPoint));
      });

      nodeSpaceAnimationsRef.current.field?.update(time, camera, renderer.domElement.height, renderer.getPixelRatio());

      if (model?.userData.isNodeSpace) {
        model.updateMatrixWorld(true);
        nodeSpaceAnimationsRef.current.nodes.forEach((node) => {
          node.sprite.getWorldPosition(worldPoint);
          const relativeDepth = clamp01(0.5 + (camera.position.z - camera.position.distanceTo(worldPoint)) / 4.8);
          (node.sprite.material as THREE.SpriteMaterial).opacity = 0.56 + relativeDepth * 0.44;
          (node.endpointDot.material as THREE.MeshBasicMaterial).opacity = 0.5 + relativeDepth * 0.5;
          (node.glow.material as THREE.SpriteMaterial).opacity = 0.07 + relativeDepth * 0.17;
        });
      }

      // 腕のふわふわアニメーション（胴体に寄せた状態 + ゆらゆら）
      if (armBonesRef.current.left) {
        armBonesRef.current.left.rotation.x = -0.8 + Math.sin(time * 1.5) * 0.15;
      }
      if (armBonesRef.current.right) {
        armBonesRef.current.right.rotation.x = -0.6 + Math.sin(time * 1.5 + Math.PI) * 0.15;
      }

      // まばたき処理
      const now = performance.now();
      if (blinkProgress < 0 && now - lastBlinkTime > nextBlinkInterval) {
        blinkProgress = 0;
        blinkCount = 0;
        lastBlinkTime = now;
      }

      if (blinkProgress >= 0 && blinkMeshesRef.current.length > 0) {
        blinkProgress += 0.12;
        const value = blinkProgress < 0.5
          ? blinkProgress * 2       // 0→1 閉じる
          : 2 - blinkProgress * 2;  // 1→0 開く

        blinkMeshesRef.current.forEach(mesh => {
          if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
            const idx = mesh.morphTargetDictionary['Blink'];
            if (idx !== undefined) {
              mesh.morphTargetInfluences[idx] = Math.max(0, Math.min(1, value));
            }
          }
        });

        if (blinkProgress >= 1) {
          blinkCount++;
          // まだ回数が残っていれば短い間隔で次のまばたきを開始
          if (blinkCount < BLINKS_PER_SET) {
            blinkProgress = -0.3; // 少し間を空けてから次のまばたき
          } else {
            blinkProgress = -1;
            nextBlinkInterval = 2000 + Math.random() * 3000;
          }
          // 目を確実に開いた状態にリセット
          blinkMeshesRef.current.forEach(mesh => {
            if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
              const idx = mesh.morphTargetDictionary['Blink'];
              if (idx !== undefined) {
                mesh.morphTargetInfluences[idx] = 0;
              }
            }
          });
        }
      }

      // 2回目のまばたき待機中（短い間隔）
      if (blinkProgress > -1 && blinkProgress < 0) {
        blinkProgress += 0.04;
        if (blinkProgress >= 0) {
          blinkProgress = 0;
        }
      }

      renderer.render(scene, camera);
      sceneRef.current.animationId = requestAnimationFrame(animate);
    };

    animate();

    // クリーンアップ
    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animationId);
        if (ENABLE_MODEL_INTERACTION) {
          renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
          renderer.domElement.removeEventListener('pointermove', handlePointerMove);
          renderer.domElement.removeEventListener('pointerup', handlePointerUp);
          renderer.domElement.removeEventListener('pointercancel', handlePointerUp);
          renderer.domElement.removeEventListener('wheel', handleWheel);
        }
        if (sceneRef.current.model) disposeObject3D(sceneRef.current.model);
        renderer.dispose();
        envMapRef.current?.dispose();
        envMapRef.current = null;
        if (containerRef.current?.contains(renderer.domElement)) {
          containerRef.current.removeChild(renderer.domElement);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!sceneRef.current || !modelUrl) return;

    const { scene } = sceneRef.current;
    const isEightBall = /eight-ball\.glb(?:[?#]|$)/i.test(modelUrl);
    const usesPlushCatStyling = !isEightBall;
    let cancelled = false;

    // 既存のモデルを削除
    if (sceneRef.current.model) {
      scene.remove(sceneRef.current.model);
      disposeObject3D(sceneRef.current.model);
      sceneRef.current.model = null;
    }
    nodeSpaceAnimationsRef.current = { ball: null, cues: [], field: null, nodes: [], path: null, sprites: [] };

    // まばたきメッシュ・腕ボーン参照をリセット
    blinkMeshesRef.current = [];
    armBonesRef.current = { left: null, right: null };

    // GLBモデルのロード
    setIsLoading(true);
    setError('');

    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      async (gltf) => {
        if (!sceneRef.current || cancelled) return;

        const object = gltf.scene;

        // モデルのサイズを正規化
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = (isEightBall ? EIGHT_BALL_SIZE : 3.7) / maxDim;
        object.scale.setScalar(scale);

        // モデルを中央に配置
        const center = box.getCenter(new THREE.Vector3());
        object.position.x = -center.x * scale;
        object.position.y = -center.y * scale + (isEightBall ? 0 : -0.35);
        object.position.z = -center.z * scale;

        // デバッグ: 全オブジェクト名と型を表示
        object.traverse((child) => {
          console.log(`[${child.type}] "${child.name}"`);
        });

        if (usesPlushCatStyling) {
          // ボーンの検出（腕）
          object.traverse((child) => {
            if (child instanceof THREE.Bone) {
              if (child.name === 'Bone002') {
                armBonesRef.current.left = child;
                console.log('Left arm bone found:', child.name);
              }
              if (child.name === 'Bone004') {
                armBonesRef.current.right = child;
                console.log('Right arm bone found:', child.name);
              }
            }
          });
        }

        const meshes: THREE.Mesh[] = [];

        // シャドウ・マテリアル調整・モーフターゲット検出
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            meshes.push(child);
            child.castShadow = true;
            child.receiveShadow = true;

            if (usesPlushCatStyling) {
              // デバッグ: 全メッシュのモーフターゲットを表示
              if (child.morphTargetDictionary) {
                console.log(`Mesh "${child.name}" morph targets:`, Object.keys(child.morphTargetDictionary));
              }

              // モーフターゲット「Blink」を持つメッシュを検出
              if (child.morphTargetDictionary && 'Blink' in child.morphTargetDictionary) {
                blinkMeshesRef.current.push(child);
                console.log('Blink morph target found on:', child.name);
              }
            }
          }
        });

        if (isEightBall) {
          meshes.forEach(tuneEightBallMaterial);
        }

        if (usesPlushCatStyling) {
          meshes.forEach((mesh) => {
            const originalGeometry = mesh.geometry;
            mesh.geometry = smoothPlushGeometry(originalGeometry);
            originalGeometry.dispose();
            pushEarsBack(mesh.geometry);

            const normalAttribute = mesh.geometry.getAttribute('normal');
            if (normalAttribute) normalAttribute.needsUpdate = true;

            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((material) => {
              if (material instanceof THREE.MeshStandardMaterial) {
                tunePlushMaterial(material, envMapRef.current);
              }
            });

            if (mesh.geometry.getAttribute('position')) {
              addSurfaceFur(mesh, createLightTextureMask(materials));
            }
          });
        }

        // 初期回転を適用（デザインに合わせた傾き）
        object.rotation.x = -0.04;
        object.rotation.y = isEightBall ? 0.3 : 0.02;
        object.rotation.z = 0;

        if (isEightBall) {
          const nodeSpace = new THREE.Group();
          nodeSpace.name = 'eight_ball_node_space';
          nodeSpace.userData.isNodeSpace = true;
          nodeSpace.add(object);
          const animations = addEightBallNodeSpace(nodeSpace, object);

          if (!sceneRef.current || cancelled) {
            disposeObject3D(nodeSpace);
            return;
          }

          nodeSpaceAnimationsRef.current = animations;
          scene.add(nodeSpace);
          sceneRef.current.model = nodeSpace;
          if (containerRef.current) {
            updateNodeSpaceFraming(
              sceneRef.current.camera,
              containerRef.current.clientWidth,
              containerRef.current.clientHeight,
              nodeSpace
            );
          }
        } else {
          scene.add(object);
          sceneRef.current.model = object;
        }
        setIsLoading(false);

        console.log('Model loaded. Blink meshes found:', blinkMeshesRef.current.length);
      },
      (progress) => {
        if (progress.total > 0) {
          console.log('Loading:', (progress.loaded / progress.total * 100).toFixed(1) + '%');
        }
      },
      (error) => {
        console.error('Error loading GLB:', error);
        setError('モデルの読み込みに失敗しました');
        setIsLoading(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [modelUrl]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-red-400 text-lg">{error}</div>
        </div>
      )}

    </div>
  );
}
