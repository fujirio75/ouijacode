import * as THREE from 'three';

const PALETTE = [0xf21e3a, 0x00a9ce, 0xffc400, 0x08b879, 0x2356cf, 0xe80087, 0xff681c];

function seededRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function createDataParticles() {
  const count = 1880;
  const random = seededRandom(7319);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const kinds = new Float32Array(count);
  const flows = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let index = 0; index < count; index++) {
    const ambient = index < 360;
    const offset = index * 3;
    const lane = index < 1120 ? 0 : 1;
    const progress = random();
    const spread = 0.035 + Math.pow(Math.abs(progress - 0.5) * 2, 2) * 0.5;
    let x = (random() - 0.5) * 16;
    let y = (random() - 0.5) * 11;
    let z = (random() - 0.5) * 9;
    if (ambient && Math.hypot(x, y, z) < 2) x += x < 0 ? -2 : 2;
    positions[offset] = ambient ? x : (random() - 0.5) * 0.08;
    positions[offset + 1] = ambient ? y : (random() + random() - 1) * spread;
    positions[offset + 2] = ambient ? z : (random() + random() - 1) * spread;
    color.setHex(PALETTE[index % PALETTE.length]).toArray(colors, offset);
    sizes[index] = ambient ? 0.022 + Math.pow(random(), 3) * 0.09 : 0.009 + random() * 0.022;
    kinds[index] = ambient ? (index % 10 < 5 ? 0 : index % 10 < 8 ? 1 : 2) : 0;
    flows[offset] = ambient ? -1 : lane;
    flows[offset + 1] = progress;
    flows[offset + 2] = random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
  geometry.setAttribute('aFlow', new THREE.BufferAttribute(flows, 3));
  const material = new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: { uTime: { value: 0 }, uHeight: { value: 1000 }, uPixelRatio: { value: 1 } },
    vertexShader: `
      uniform float uTime;
      uniform float uHeight;
      uniform float uPixelRatio;
      attribute float aSize;
      attribute float aKind;
      attribute vec3 aFlow;
      varying vec3 vColor;
      varying float vKind;
      varying float vAlpha;

      void main() {
        vec3 point = position;
        float opacity = 0.9;
        if (aFlow.x >= 0.0) {
          float progress = fract(aFlow.y + uTime * (0.012 + aFlow.z * 0.003));
          float x = mix(-8.5, 8.5, progress);
          float lane = aFlow.x;
          point += vec3(
            x,
            mix(-0.24, 0.29, lane) * x + sin(x * 0.57 + lane * 2.0 + uTime * 0.07) * 0.55,
            -2.0 - lane * 0.8 + sin(x * 0.48 + lane * 2.5) * 1.25
          );
          opacity *= smoothstep(0.0, 0.08, progress) * (1.0 - smoothstep(0.92, 1.0, progress));
        } else {
          point += vec3(sin(uTime * 0.12 + aFlow.y * 20.0), cos(uTime * 0.16 + aFlow.z * 20.0), 0.0) * 0.09;
        }
        vec4 viewPosition = modelViewMatrix * vec4(point, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(aSize * projectionMatrix[1][1] * uHeight * 0.5 / max(-viewPosition.z, 0.1), uPixelRatio, 14.0 * uPixelRatio);
        vAlpha = opacity;
        vColor = color;
        vKind = aKind;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vKind;
      varying float vAlpha;

      void main() {
        vec2 point = abs(gl_PointCoord - 0.5);
        float distanceToEdge;
        if (vKind < 0.5) {
          distanceToEdge = max(point.x, point.y) - 0.43;
        } else if (vKind < 1.5) {
          distanceToEdge = min(max(point.x - 0.13, point.y - 0.45), max(point.x - 0.45, point.y - 0.13));
        } else {
          distanceToEdge = abs(point.x + point.y - 0.38) - 0.045;
        }
        float aa = max(fwidth(distanceToEdge), 0.008);
        float alpha = (1.0 - smoothstep(-aa, aa, distanceToEdge)) * vAlpha;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(vColor, alpha);
        #include <colorspace_fragment>
      }
    `
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'geometric_data_streams';
  // Flow positions are generated in the shader, outside the seed geometry's bounds.
  points.frustumCulled = false;
  return points;
}

function createLabel(text: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.font = '600 64px Arial, sans-serif';
  const textWidth = context.measureText(text).width;
  canvas.width = Math.ceil(textWidth + 28);
  context.font = '600 64px Arial, sans-serif';
  context.fillStyle = '#181818';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, toneMapped: false, transparent: true, depthWrite: false }));
  sprite.userData.aspect = canvas.width / canvas.height;
  sprite.scale.set(0.32 * canvas.width / canvas.height, 0.32, 1);
  return sprite;
}

export function createOrbitalField(root: THREE.Group) {
  const field = new THREE.Group();
  field.name = 'orbital_network';
  root.add(field);
  const particles = createDataParticles();
  field.add(particles);
  const point = new THREE.Vector3();
  const definitions = [
    { radius: [3.65, 2.75], rotation: [0.88, 0.22, -0.43], color: 0xf21e3a },
    { radius: [3.9, 2.72], rotation: [1.12, -0.36, 0.26], color: 0xbac0c6 },
    { radius: [3.75, 2.5], rotation: [-0.8, 0.48, 0.45], color: 0xc4c8cd }
  ];
  const rings = definitions.map((definition, index) => {
    const group = new THREE.Group();
    group.name = `orbital_path_${index}`;
    group.rotation.set(definition.rotation[0], definition.rotation[1], definition.rotation[2], 'ZXY');
    const vertices = [];
    for (let segment = 0; segment <= 256; segment++) {
      const angle = segment / 256 * Math.PI * 2;
      vertices.push(new THREE.Vector3(Math.cos(angle) * definition.radius[0], Math.sin(angle) * definition.radius[1], 0));
    }
    const material = new THREE.LineBasicMaterial({ color: definition.color, transparent: true, opacity: index === 0 ? 0.9 : 0.62, toneMapped: false, depthWrite: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices), material);
    group.add(line);
    field.add(group);
    return { group, definition };
  });

  // Short colored arc sections retain their thickness and occlusion in 3D.
  for (let index = 0; index < 72; index++) {
    if (index % 4 === 0) continue;
    const angle = index / 72 * Math.PI * 2;
    const curve = new THREE.EllipseCurve(0, 0, 3.75, 2.5, angle, angle + 0.022 + (index % 3) * 0.01);
    const points = curve.getPoints(4).map(p => new THREE.Vector3(p.x, p.y, 0));
    const segment = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 4, 0.009, 4, false),
      new THREE.MeshBasicMaterial({ color: PALETTE[index % PALETTE.length], toneMapped: false })
    );
    rings[2].group.add(segment);
  }

  const markerGeometry = new THREE.RingGeometry(0.032, 0.039, 20);
  const markers = Array.from({ length: 10 }, (_, index) => {
    const ring = rings[index % rings.length];
    const marker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: index % 3 === 0 ? 0xf21e3a : 0x9ca3a9, side: THREE.DoubleSide, toneMapped: false }));
    if (index % 2 === 0) {
      const diamond = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(0.1, 0, 0), new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(-0.1, 0, 0)]),
        new THREE.LineBasicMaterial({ color: 0xf21e3a, toneMapped: false })
      );
      marker.add(diamond);
    }
    field.add(marker);
    return { ring, marker, phase: index * 2.399, speed: (index % 2 ? 1 : -1) * 0.025 };
  });

  const labelDefinitions = [
    { text: 'Unity', ring: 0, angle: 2.35, offset: [-0.05, 0.68], color: 0xf21e3a },
    { text: 'TypeScript', ring: 2, angle: 0.2, offset: [0.48, 0.55], color: 0x00a9ce },
    { text: 'Three.js', ring: 1, angle: 3.62, offset: [-0.65, -0.1], color: 0x08b879 },
    { text: 'C#', ring: 0, angle: 5.78, offset: [0.55, -0.32], color: 0xffc400 }
  ];
  const labels = labelDefinitions.map(definition => {
    const label = createLabel(definition.text);
    const anchor = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: 0x242424, toneMapped: false }));
    const leader = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xb0b5ba, toneMapped: false }));
    const cross = new THREE.Group();
    const crossMaterial = new THREE.MeshBasicMaterial({ color: definition.color, toneMapped: false });
    cross.add(new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.021), crossMaterial), new THREE.Mesh(new THREE.PlaneGeometry(0.021, 0.11), crossMaterial));
    field.add(label, anchor, leader, cross);
    return { definition, label, anchor, leader, cross };
  });
  const localView = new THREE.Quaternion();
  const inverseWorld = new THREE.Quaternion();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const anchorPosition = new THREE.Vector3();
  const projectedLabel = new THREE.Vector3();
  const labelBounds = labels.map(() => new THREE.Vector4());
  const candidates = [[0, 0], [0, 0.14], [0, -0.14], [-0.2, 0], [0.2, 0], [-0.2, 0.16], [0.2, 0.16], [-0.2, -0.16], [0.2, -0.16], [0, 0.32], [0, -0.32]];

  return {
    update(time: number, camera: THREE.PerspectiveCamera, drawingHeight: number, pixelRatio: number, exclusions: THREE.Vector4[]) {
      particles.material.uniforms.uTime.value = time;
      particles.material.uniforms.uHeight.value = drawingHeight;
      particles.material.uniforms.uPixelRatio.value = pixelRatio;
      rings.forEach(({ group, definition }, index) => {
        group.rotation.set(definition.rotation[0] + Math.sin(time * 0.09 + index) * 0.045, definition.rotation[1], definition.rotation[2] + Math.sin(time * 0.06 + index) * 0.035);
      });
      field.updateWorldMatrix(true, true);
      field.getWorldQuaternion(inverseWorld).invert();
      camera.getWorldQuaternion(localView).premultiply(inverseWorld);
      right.set(1, 0, 0).applyQuaternion(localView);
      up.set(0, 1, 0).applyQuaternion(localView);
      const positionOnRing = (ring: typeof rings[number], angle: number) => {
        point.set(Math.cos(angle) * ring.definition.radius[0], Math.sin(angle) * ring.definition.radius[1], 0);
        ring.group.localToWorld(point);
        return field.worldToLocal(point);
      };
      markers.forEach(({ ring, marker, phase, speed }) => {
        marker.position.copy(positionOnRing(ring, phase + time * speed));
        marker.quaternion.copy(localView);
      });
      labels.forEach(({ definition, label, anchor, leader, cross }, labelIndex) => {
        anchorPosition.copy(positionOnRing(rings[definition.ring], definition.angle));
        anchor.position.copy(anchorPosition);
        cross.position.copy(anchorPosition).addScaledVector(right, definition.offset[0]).addScaledVector(up, definition.offset[1]);
        cross.quaternion.copy(localView);
        label.position.copy(cross.position).addScaledVector(up, 0.23);
        projectedLabel.copy(label.position);
        field.localToWorld(projectedLabel);
        const depth = -point.copy(projectedLabel).applyMatrix4(camera.matrixWorldInverse).z;
        const worldHeight = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const labelHeight = 28 * pixelRatio / drawingHeight;
        label.scale.set(worldHeight * labelHeight * label.userData.aspect, worldHeight * labelHeight, 1);
        projectedLabel.project(camera);
        const halfWidth = labelHeight * label.userData.aspect / camera.aspect;
        const halfHeight = labelHeight;
        let bestScore = Infinity;
        let bestX = projectedLabel.x;
        let bestY = projectedLabel.y;
        candidates.forEach(([dx, dy]) => {
          const x = THREE.MathUtils.clamp(projectedLabel.x + dx, -0.96 + halfWidth, 0.96 - halfWidth);
          const y = THREE.MathUtils.clamp(projectedLabel.y + dy, -0.91 + halfHeight, 0.94 - halfHeight);
          let score = (x - projectedLabel.x) ** 2 + (y - projectedLabel.y) ** 2;
          const overlap = (rect: THREE.Vector4) => x + halfWidth + 0.025 > rect.x && x - halfWidth - 0.025 < rect.z && y + halfHeight > rect.y && y - halfHeight - 0.08 < rect.w;
          exclusions.forEach(rect => { if (overlap(rect)) score += 10; });
          labelBounds.slice(0, labelIndex).forEach(rect => { if (overlap(rect)) score += 10; });
          if (score < bestScore) { bestScore = score; bestX = x; bestY = y; }
        });
        projectedLabel.set(bestX, bestY, projectedLabel.z).unproject(camera);
        label.position.copy(field.worldToLocal(projectedLabel));
        cross.position.copy(label.position).addScaledVector(up, -worldHeight * labelHeight * 0.75);
        cross.scale.setScalar(worldHeight * 8 * pixelRatio / drawingHeight / 0.11);
        labelBounds[labelIndex].set(bestX - halfWidth, bestY - halfHeight - 0.08, bestX + halfWidth, bestY + halfHeight);
        const positions = leader.geometry.getAttribute('position');
        positions.setXYZ(0, anchorPosition.x, anchorPosition.y, anchorPosition.z);
        point.copy(cross.position).lerp(anchorPosition, 0.15);
        positions.setXYZ(1, point.x, point.y, point.z);
        positions.needsUpdate = true;
        leader.frustumCulled = false;
      });
    }
  };
}
