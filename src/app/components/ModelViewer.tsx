import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface ModelViewerProps {
  modelUrl?: string;
}

export function ModelViewer({ modelUrl }: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const isDraggingRef = useRef(false);
  const blinkMeshesRef = useRef<THREE.Mesh[]>([]);
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
    scene.background = null;

    // カメラの設定
    const camera = new THREE.PerspectiveCamera(
      45,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0.6, 5);
    camera.lookAt(0, 0.4, 0);

    // レンダラーの設定
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    containerRef.current.appendChild(renderer.domElement);

    // ライティング
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7.5);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0x4477ff, 0.3);
    fillLight.position.set(-5, 5, -5);
    scene.add(fillLight);

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
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    // マウスコントロール
    let previousMousePosition = { x: 0, y: 0 };
    let rotation = { x: 0, y: 0 };
    let autoRotate = true;

    const handleMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      autoRotate = false;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !sceneRef.current?.model) return;

      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      rotation.y += deltaX * 0.005;
      rotation.x += deltaY * 0.005;
      rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotation.x));

      sceneRef.current.model.rotation.y = rotation.y;
      sceneRef.current.model.rotation.x = rotation.x;

      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      // 一定時間後に自動回転を再開
      setTimeout(() => {
        if (!isDraggingRef.current) {
          autoRotate = true;
        }
      }, 2000);
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!sceneRef.current) return;
      sceneRef.current.camera.position.z += e.deltaY * 0.01;
      sceneRef.current.camera.position.z = Math.max(3, Math.min(20, sceneRef.current.camera.position.z));
    };

    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('mouseleave', handleMouseUp);
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });

    // まばたき管理変数
    let lastBlinkTime = performance.now();
    let nextBlinkInterval = 2000 + Math.random() * 3000;
    let blinkProgress = -1;
    let blinkCount = 0;      // 現在何回目のまばたきか
    const BLINKS_PER_SET = 2; // 1セットあたりのまばたき回数

    // アニメーションループ
    const animate = () => {
      if (!sceneRef.current) return;

      const { scene, camera, renderer, model } = sceneRef.current;

      // ゆっくりと自動回転
      if (model && autoRotate) {
        model.rotation.y += 0.003;
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
        renderer.domElement.removeEventListener('mousedown', handleMouseDown);
        renderer.domElement.removeEventListener('mousemove', handleMouseMove);
        renderer.domElement.removeEventListener('mouseup', handleMouseUp);
        renderer.domElement.removeEventListener('mouseleave', handleMouseUp);
        renderer.domElement.removeEventListener('wheel', handleWheel);
        renderer.dispose();
        if (containerRef.current?.contains(renderer.domElement)) {
          containerRef.current.removeChild(renderer.domElement);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!sceneRef.current || !modelUrl) return;

    const { scene } = sceneRef.current;

    // 既存のモデルを削除
    if (sceneRef.current.model) {
      scene.remove(sceneRef.current.model);
      sceneRef.current.model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(material => material.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      sceneRef.current.model = null;
    }

    // まばたきメッシュ参照をリセット
    blinkMeshesRef.current = [];

    // GLBモデルのロード
    setIsLoading(true);
    setError('');

    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        if (!sceneRef.current) return;

        const object = gltf.scene;

        // モデルのサイズを正規化
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 4 / maxDim;
        object.scale.setScalar(scale);

        // モデルを中央に配置
        const center = box.getCenter(new THREE.Vector3());
        object.position.x = -center.x * scale;
        object.position.y = -center.y * scale;
        object.position.z = -center.z * scale;

        // モデルを少し傾ける（逆方向）
        object.rotation.z = -0.3; // 約-8.6度傾ける

        // デバッグ: 全オブジェクト名と型を表示
        object.traverse((child) => {
          console.log(`[${child.type}] "${child.name}"`);
        });

        // シャドウの設定 + モーフターゲットの検出
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;

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
        });

        scene.add(object);
        sceneRef.current.model = object;
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
  }, [modelUrl]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-white text-lg">モデル読み込み中...</div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-red-400 text-lg">{error}</div>
        </div>
      )}

    </div>
  );
}
