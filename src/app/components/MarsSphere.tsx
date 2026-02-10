import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const vertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform vec3 colorPaper;
  uniform vec3 colorRust;
  uniform vec3 colorForest;
  uniform vec3 colorInk;
  uniform float time;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute( permute( permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
  }

  void main() {
    vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
    float lightIntensity = dot(vNormal, lightDir);
    vec3 pos = vPosition;
    float angle = time * 0.1;
    mat3 rotY = mat3(cos(angle), 0.0, sin(angle), 0.0, 1.0, 0.0, -sin(angle), 0.0, cos(angle));
    vec3 noisePos = rotY * pos * 2.5;
    float noiseVal = snoise(noisePos);
    vec3 finalColor = colorPaper;
    if (noiseVal > 0.1) {
      finalColor = colorRust;
      if (lightIntensity < 0.2) {
        finalColor = colorForest;
      }
    } else {
      if (lightIntensity < -0.2) {
        finalColor = colorInk;
      }
    }
    float viewDot = dot(normalize(vNormal), vec3(0,0,1));
    if (viewDot < 0.4 && viewDot > 0.0) {
      finalColor = colorInk;
    }
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// Eye config: [theta (longitude), phi (latitude from top), lerpSpeed]
// theta: 0=front, PI/2=right, PI=back, -PI/2=left
// phi: 0=top, PI/2=equator, PI=bottom
const EYE_CONFIGS: [number, number, number][] = [
  [0.3, 1.1, 0.025],            // eye 1: front-right, slightly above equator
  [Math.PI * 0.7, 0.8, 0.035],  // eye 2: back-right, upper
  [-Math.PI * 0.4, 2.1, 0.03],  // eye 3: left, below equator
  [Math.PI * 1.2, 1.0, 0.04],   // eye 4: back-left, near equator
  [-0.6, 0.6, 0.028],           // eye 5: front-left, upper
  [Math.PI * 0.5, 2, 0.032],    // eye 6: right, below equator
  [Math.PI * 1.5, 1.2, 0.038],  // eye 7: back, slightly below equator
  [0.1, 2, 0.027],              // eye 8: front, lower
  // New eyes positioned between existing ones
  [Math.PI * 0.25, 2.2, 0.033], // eye 9: between 1 and 6
  [-Math.PI * 0.1, 1.5, 0.029], // eye 10: between 5 and 1
  [Math.PI * 0.95, 1.1, 0.036], // eye 11: between 2 and 4
];

export function MarsSphere() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    sphere: THREE.Mesh;
    material: THREE.ShaderMaterial;
    eyes: THREE.Group[];
    eyeLocalOffsets: THREE.Vector3[];
    animationId: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(
      30,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      8,
      100
    );
    camera.position.z = 12;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);

    const uniforms = {
      time: { value: 0 },
      colorPaper: { value: new THREE.Color('#888888') },
      colorRust: { value: new THREE.Color('#000000') },
      colorForest: { value: new THREE.Color('#000000') },
      colorInk: { value: new THREE.Color('#000000') },
    };

    const sphereRadius = 2;
    const geometry = new THREE.IcosahedronGeometry(sphereRadius, 10);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
    });

    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    // --- Eyes (4 eyes at scattered positions) ---
    const createEye = (theta: number, phi: number): { group: THREE.Group; localOffset: THREE.Vector3 } => {
      const eyeGroup = new THREE.Group();

      const eyeballGeo = new THREE.SphereGeometry(0.3, 20, 20);
      const eyeballMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const eyeball = new THREE.Mesh(eyeballGeo, eyeballMat);
      eyeGroup.add(eyeball);

      const pupilGeo = new THREE.SphereGeometry(0.24, 20, 20);
      const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.z = 0.1;
      eyeGroup.add(pupil);

      // Spherical coordinates: place eyes embedded in the sphere surface
      const r = sphereRadius * 0.95;
      const localOffset = new THREE.Vector3(
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.cos(theta)
      );

      eyeGroup.position.copy(localOffset);

      // Face outward from sphere center
      eyeGroup.lookAt(
        localOffset.x * 2,
        localOffset.y * 2,
        localOffset.z * 2
      );

      return { group: eyeGroup, localOffset };
    };

    const eyes: THREE.Group[] = [];
    const eyeLocalOffsets: THREE.Vector3[] = [];

    for (const [hAngle, vAngle] of EYE_CONFIGS) {
      const { group, localOffset } = createEye(hAngle, vAngle);
      eyes.push(group);
      eyeLocalOffsets.push(localOffset);
      scene.add(group);
    }

    // Add light for eyes
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    sceneRef.current = {
      renderer,
      scene,
      camera,
      sphere,
      material,
      eyes,
      eyeLocalOffsets,
      animationId: 0,
    };

    const handleResize = () => {
      if (!containerRef.current || !sceneRef.current) return;
      const { camera, renderer } = sceneRef.current;
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };

    window.addEventListener('resize', handleResize);

    // Independent blink state for each eye
    const eyeBlinkStates = eyes.map(() => ({
      lastBlinkTime: performance.now() + Math.random() * 2000,
      nextBlinkInterval: 2000 + Math.random() * 3000,
      blinkProgress: -1,
      blinkCount: 0,
    }));
    const BLINKS_PER_SET = 2;

    const targetPos = new THREE.Vector3();

    const animate = () => {
      if (!sceneRef.current) return;
      const { scene, camera, renderer, sphere, material, eyes, eyeLocalOffsets } = sceneRef.current;

      material.uniforms.time.value += 0.005;
      sphere.rotation.y -= 0.002;

      // --- Update eye positions with inertia ---
      sphere.updateMatrixWorld();
      for (let i = 0; i < eyes.length; i++) {
        // Compute target position by applying sphere's world matrix to local offset
        targetPos.copy(eyeLocalOffsets[i]);
        targetPos.applyMatrix4(sphere.matrixWorld);

        // Lerp toward target with per-eye speed
        const lerpSpeed = EYE_CONFIGS[i][2];
        eyes[i].position.lerp(targetPos, lerpSpeed);

        // Update orientation to face outward
        const outward = eyes[i].position.clone().multiplyScalar(2);
        eyes[i].lookAt(outward);
      }

      // --- Independent blink animation for each eye ---
      const now = performance.now();
      for (let i = 0; i < eyes.length; i++) {
        const blinkState = eyeBlinkStates[i];

        if (blinkState.blinkProgress < 0 && now - blinkState.lastBlinkTime > blinkState.nextBlinkInterval) {
          blinkState.blinkProgress = 0;
          blinkState.blinkCount = 0;
          blinkState.lastBlinkTime = now;
        }

        if (blinkState.blinkProgress >= 0) {
          blinkState.blinkProgress += 0.12;
          const scaleY = blinkState.blinkProgress < 0.5
            ? 1 - blinkState.blinkProgress * 2
            : (blinkState.blinkProgress - 0.5) * 2;

          eyes[i].scale.y = Math.max(0.05, scaleY);

          if (blinkState.blinkProgress >= 1) {
            blinkState.blinkCount++;
            eyes[i].scale.y = 1;

            if (blinkState.blinkCount < BLINKS_PER_SET) {
              blinkState.blinkProgress = -0.3;
            } else {
              blinkState.blinkProgress = -1;
              blinkState.nextBlinkInterval = 2000 + Math.random() * 3000;
            }
          }
        }

        // Rest phase between double blinks
        if (blinkState.blinkProgress > -1 && blinkState.blinkProgress < 0) {
          blinkState.blinkProgress += 0.04;
          if (blinkState.blinkProgress >= 0) {
            blinkState.blinkProgress = 0;
          }
        }
      }

      renderer.render(scene, camera);
      sceneRef.current.animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animationId);
        renderer.dispose();
        geometry.dispose();
        material.dispose();
        if (containerRef.current?.contains(renderer.domElement)) {
          containerRef.current.removeChild(renderer.domElement);
        }
      }
    };
  }, []);

  return <div ref={containerRef} className="fixed inset-0 z-[1] pointer-events-none" />;
}
