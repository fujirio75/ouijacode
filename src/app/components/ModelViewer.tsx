import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export interface TextureFiles {
  diffuse?: string;
  normal?: string;
  metallic?: string;
  roughness?: string;
  metallicRoughness?: string;
}

interface ModelViewerProps {
  modelUrl?: string;
  textures?: TextureFiles;
}

export function ModelViewer({ modelUrl, textures }: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const isDraggingRef = useRef(false);
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
    scene.background = new THREE.Color(0x1a1a1a);

    // カメラの設定
    const camera = new THREE.PerspectiveCamera(
      45,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 2, 8);
    camera.lookAt(0, 0, 0);

    // レンダラーの設定
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    // 床（グリッド）
    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
    gridHelper.position.y = -2;
    scene.add(gridHelper);

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

    // アニメーションループ
    const animate = () => {
      if (!sceneRef.current) return;
      
      const { scene, camera, renderer, model } = sceneRef.current;

      // 自動回転
      if (autoRotate && model) {
        model.rotation.y += 0.005;
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

    // FBXモデルのロード
    setIsLoading(true);
    setError('');

    // テクスチャのロード
    const textureLoader = new THREE.TextureLoader();
    const loadedTextures: {
      diffuse?: THREE.Texture;
      normal?: THREE.Texture;
      metallic?: THREE.Texture;
      roughness?: THREE.Texture;
      metallicRoughness?: THREE.Texture;
    } = {};

    const texturePromises: Promise<void>[] = [];

    if (textures?.diffuse) {
      texturePromises.push(
        new Promise((resolve) => {
          textureLoader.load(textures.diffuse!, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            loadedTextures.diffuse = texture;
            resolve();
          }, undefined, () => resolve());
        })
      );
    }

    if (textures?.normal) {
      texturePromises.push(
        new Promise((resolve) => {
          textureLoader.load(textures.normal!, (texture) => {
            loadedTextures.normal = texture;
            resolve();
          }, undefined, () => resolve());
        })
      );
    }

    if (textures?.metallic) {
      texturePromises.push(
        new Promise((resolve) => {
          textureLoader.load(textures.metallic!, (texture) => {
            loadedTextures.metallic = texture;
            resolve();
          }, undefined, () => resolve());
        })
      );
    }

    if (textures?.roughness) {
      texturePromises.push(
        new Promise((resolve) => {
          textureLoader.load(textures.roughness!, (texture) => {
            loadedTextures.roughness = texture;
            resolve();
          }, undefined, () => resolve());
        })
      );
    }

    if (textures?.metallicRoughness) {
      texturePromises.push(
        new Promise((resolve) => {
          textureLoader.load(textures.metallicRoughness!, (texture) => {
            loadedTextures.metallicRoughness = texture;
            resolve();
          }, undefined, () => resolve());
        })
      );
    }

    const loader = new FBXLoader();
    
    Promise.all(texturePromises).then(() => {
      loader.load(
        modelUrl,
        (object) => {
          if (!sceneRef.current) return;

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

          // テクスチャとシャドウの設定
          object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;

              // テクスチャがある場合は新しいPBRマテリアルを作成
              if (Object.keys(loadedTextures).length > 0) {
                const newMaterial = new THREE.MeshStandardMaterial({
                  map: loadedTextures.diffuse || null,
                  normalMap: loadedTextures.normal || null,
                  metalnessMap: loadedTextures.metallic || loadedTextures.metallicRoughness || null,
                  roughnessMap: loadedTextures.roughness || loadedTextures.metallicRoughness || null,
                  metalness: 0.0,
                  roughness: 0.8,
                  side: THREE.DoubleSide,
                });

                // 既存のマテリアルを破棄
                if (Array.isArray(child.material)) {
                  child.material.forEach(m => m.dispose());
                } else {
                  child.material.dispose();
                }

                child.material = newMaterial;
              }
            }
          });

          scene.add(object);
          sceneRef.current.model = object;
          setIsLoading(false);
        },
        (progress) => {
          console.log('Loading:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => {
          console.error('Error loading FBX:', error);
          setError('モデルの読み込みに失敗しました');
          setIsLoading(false);
        }
      );
    });
  }, [modelUrl, textures]);

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

      <div className="absolute bottom-4 left-4 text-white text-sm bg-black/50 px-4 py-2 rounded">
        <p>マウスドラッグ: 回転</p>
        <p>マウスホイール: ズーム</p>
      </div>
    </div>
  );
}