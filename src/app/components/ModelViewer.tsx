import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

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
  softwareLogoUrl?: string;
  w3LogoUrl?: string;
}

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

type NodeSpaceAnimations = {
  field: THREE.Points | null;
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

const NODE_WHITE = 0xf4f4f2;
const EIGHT_BALL_SIZE = 2.9;

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
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  gradient.addColorStop(0.16, 'rgba(255, 255, 255, 0.42)');
  gradient.addColorStop(0.48, 'rgba(255, 255, 255, 0.1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createAmbientField(root: THREE.Group) {
  const count = 140;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const random = seededRandom(8317);

  for (let index = 0; index < count; index++) {
    let x = 0;
    let y = 0;
    let z = 0;
    do {
      x = (random() - 0.5) * 10.8;
      y = (random() - 0.5) * 6.8;
      z = (random() - 0.5) * 7.2;
    } while (x * x + y * y < 3.4);

    const offset = index * 3;
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
    const brightness = 0.2 + random() * 0.38;
    colors[offset] = brightness * 0.86;
    colors[offset + 1] = brightness * 0.91;
    colors[offset + 2] = brightness;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.3,
      size: 0.018,
      sizeAttenuation: true,
      transparent: true,
      vertexColors: true
    })
  );
  points.renderOrder = -1;
  root.add(points);
  return points;
}

function createTextSprite(text: string, height = 0.27) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Sprite(new THREE.SpriteMaterial({ color: NODE_WHITE }));

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
  if (!drawingContext) return new THREE.Sprite(new THREE.SpriteMaterial({ color: NODE_WHITE }));

  drawingContext.clearRect(0, 0, canvas.width, canvas.height);
  drawingContext.fillStyle = '#f7f7f4';
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

async function createWhiteSvgSprite(url: string, height: number) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load SVG: ${url}`);

  const source = await response.text();
  const viewBox = source.match(/viewBox="([^"]+)"/i)?.[1].split(/\s+/).map(Number);
  const aspect = viewBox && viewBox.length === 4 && viewBox[3] > 0
    ? viewBox[2] / viewBox[3]
    : 3;
  const whiteSource = source
    .replace(/#FF5656/gi, '#FFFFFF')
    .replace(/rgb\(255\s+86\s+86[^)]*\)/gi, '#FFFFFF');
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(whiteSource)}`;
  const texture = await new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(dataUrl, resolve, undefined, reject);
  });

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    depthWrite: false,
    transparent: true
  }));
  sprite.scale.set(height * aspect, height, 1);
  return sprite;
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
    color: NODE_WHITE,
    opacity: 0.88,
    transparent: true
  });
  const endpointDot = new THREE.Mesh(dotGeometry, dotMaterial);
  endpointDot.position.copy(position);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    blending: THREE.AdditiveBlending,
    color: 0xffffff,
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
      color: NODE_WHITE,
      depthWrite: false,
      opacity: 0.42,
      transparent: true
    })
  );
  line.frustumCulled = false;

  const glowLine = new THREE.Line(
    geometry.clone(),
    new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xffffff,
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
        blending: THREE.AdditiveBlending,
        color: 0xffffff,
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

async function addEightBallNodeSpace(
  root: THREE.Group,
  softwareLogoUrl?: string,
  w3LogoUrl?: string
) {
  const animations: NodeSpaceAnimations = {
    field: createAmbientField(root),
    nodes: [],
    path: null,
    sprites: []
  };
  const glowTexture = createGlowTexture();

  SKILL_NODES.forEach((definition, index) => {
    animations.nodes.push(createSkillNode(root, definition, glowTexture, index));
  });
  animations.path = createSkillPath(root, animations.nodes);

  const brandDefinitions = [
    {
      fallback: 'W3',
      height: 0.9,
      phase: 1.4,
      position: new THREE.Vector3(-2.15, -2.12, 0.82),
      url: w3LogoUrl
    },
    {
      fallback: 'Software',
      height: 0.72,
      phase: 4.1,
      position: new THREE.Vector3(2.02, 2.1, 0.64),
      url: softwareLogoUrl
    }
  ];

  for (const definition of brandDefinitions) {
    let sprite: THREE.Sprite;
    try {
      sprite = definition.url
        ? await createWhiteSvgSprite(definition.url, definition.height)
        : createTextSprite(definition.fallback, definition.height);
    } catch (error) {
      console.warn('SVG node label fell back to canvas text:', error);
      sprite = createTextSprite(definition.fallback, definition.height);
    }
    sprite.position.copy(definition.position);
    sprite.renderOrder = 3;
    root.add(sprite);
    animations.sprites.push({
      basePosition: definition.position.clone(),
      baseScale: sprite.scale.clone(),
      phase: definition.phase,
      sprite
    });
  }

  return animations;
}

function updateNodeSpaceFraming(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  model: THREE.Group | null
) {
  if (!model?.userData.isNodeSpace) return;

  const aspect = width / Math.max(height, 1);
  const isMobile = aspect < 0.65;
  const isPortrait = aspect < 0.95;
  const distance = isMobile ? 18.5 : isPortrait ? 12.2 : 9.6;
  const scale = isMobile ? 0.68 : isPortrait ? 0.9 : 1;
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  model.scale.setScalar(scale);
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

export function ModelViewer({ modelUrl, softwareLogoUrl, w3LogoUrl }: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const isDraggingRef = useRef(false);
  const blinkMeshesRef = useRef<THREE.Mesh[]>([]);
  const armBonesRef = useRef<{ left: THREE.Bone | null; right: THREE.Bone | null }>({ left: null, right: null });
  const envMapRef = useRef<THREE.Texture | null>(null);
  const nodeSpaceAnimationsRef = useRef<NodeSpaceAnimations>({ field: null, nodes: [], path: null, sprites: [] });
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    model: THREE.Group | null;
    animationId: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

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
    renderer.setClearColor(0x000000, 0);
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

    // 空間全体を回すポインターコントロール
    let previousPointerPosition = { x: 0, y: 0 };
    const rotation = { x: 0, y: 0 };
    const rotationVelocity = { x: 0, y: 0 };

    const handlePointerDown = (event: PointerEvent) => {
      event.preventDefault();
      isDraggingRef.current = true;
      renderer.domElement.setPointerCapture(event.pointerId);
      previousPointerPosition = { x: event.clientX, y: event.clientY };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingRef.current || !sceneRef.current?.model) return;

      const deltaX = event.clientX - previousPointerPosition.x;
      const deltaY = event.clientY - previousPointerPosition.y;
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

    // アニメーションループ
    const animate = () => {
      if (!sceneRef.current) return;

      const { scene, camera, renderer, model } = sceneRef.current;
      const time = performance.now() * 0.001; // 秒に変換

      // 浮遊アニメーション（ゆっくり上下にぷかぷか）
      if (model) {
        if (!floatBaseYSet) {
          floatBaseY = model.position.y;
          floatBaseYSet = true;
        }
        model.position.y = floatBaseY + Math.sin(time * 0.72) * 0.045;

        if (!isDraggingRef.current) {
          rotation.y += rotationVelocity.y + 0.00016 + Math.sin(time * 0.19) * 0.00005;
          rotation.x = Math.max(-1.18, Math.min(1.18, rotation.x + rotationVelocity.x));
          model.rotation.set(
            rotation.x + Math.sin(time * 0.16) * 0.022,
            rotation.y + Math.sin(time * 0.11) * 0.035,
            Math.sin(time * 0.13) * 0.008
          );
          rotationVelocity.x *= 0.945;
          rotationVelocity.y *= 0.945;
        }
      }

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

      nodeSpaceAnimationsRef.current.sprites.forEach((item) => {
        item.sprite.position.set(
          item.basePosition.x + Math.cos(time * 0.38 + item.phase) * 0.025,
          item.basePosition.y + Math.sin(time * 0.55 + item.phase) * 0.065,
          item.basePosition.z
        );
        item.sprite.scale.copy(item.baseScale).multiplyScalar(
          1 + Math.sin(time * 0.31 + item.phase) * 0.012
        );
      });

      const ambientField = nodeSpaceAnimationsRef.current.field;
      if (ambientField) {
        ambientField.rotation.y = time * 0.008;
        ambientField.rotation.x = Math.sin(time * 0.09) * 0.035;
        (ambientField.material as THREE.PointsMaterial).opacity =
          0.24 + Math.sin(time * 0.18) * 0.045;
      }

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
    nodeSpaceAnimationsRef.current = { field: null, nodes: [], path: null, sprites: [] };

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
        object.rotation.y = 0.02;
        object.rotation.z = 0;

        if (isEightBall) {
          const nodeSpace = new THREE.Group();
          nodeSpace.name = 'eight_ball_node_space';
          nodeSpace.userData.isNodeSpace = true;
          nodeSpace.add(object);
          const animations = await addEightBallNodeSpace(nodeSpace, softwareLogoUrl, w3LogoUrl);

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
  }, [modelUrl, softwareLogoUrl, w3LogoUrl]);

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
