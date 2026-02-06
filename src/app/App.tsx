import { useState } from 'react';
import { ModelViewer, TextureFiles } from '@/app/components/ModelViewer';
import { Upload, Image } from 'lucide-react';

// デフォルトのモデルとテクスチャ
const DEFAULT_MODEL = '/models/Meshy_AI_Plush_Feline_Trio_0128172350_texture.fbx';
const DEFAULT_TEXTURES: TextureFiles = {
  diffuse: '/models/Meshy_AI_Plush_Feline_Trio_0128172350_texture.png',
  // normal: '/models/Meshy_AI_Plush_Feline_Trio_0128172350_texture_normal.png',
  // metallic: '/models/Meshy_AI_Plush_Feline_Trio_0128172350_texture_metallic.png',
  // roughness: '/models/Meshy_AI_Plush_Feline_Trio_0128172350_texture_roughness.png',
};

export default function App() {
  const [modelUrl, setModelUrl] = useState<string>(DEFAULT_MODEL);
  const [textures, setTextures] = useState<TextureFiles>(DEFAULT_TEXTURES);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.endsWith('.fbx')) {
      const url = URL.createObjectURL(file);
      setModelUrl(url);
    } else {
      alert('FBXファイルを選択してください');
    }
  };

  const handleTextureChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newTextures: TextureFiles = { ...textures };
    
    Array.from(files).forEach(file => {
      const url = URL.createObjectURL(file);
      const name = file.name.toLowerCase();
      
      if (name.includes('normal')) {
        newTextures.normal = url;
      } else if (name.includes('metallic_roughness') || name.includes('metallic-roughness')) {
        newTextures.metallicRoughness = url;
      } else if (name.includes('metallic')) {
        newTextures.metallic = url;
      } else if (name.includes('roughness')) {
        newTextures.roughness = url;
      } else if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) {
        // デフォルトはdiffuse/base colorとして扱う
        newTextures.diffuse = url;
      }
    });
    
    setTextures(newTextures);
  };

  return (
    <div className="size-full flex flex-col bg-gray-900">
      {/* ヘッダー */}
      <div className="p-6 bg-gray-950 border-b border-gray-800">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">3D Model Viewer</h1>
          
          <div className="flex items-center gap-4">
            <label
              htmlFor="texture-upload"
              className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg cursor-pointer transition-colors"
            >
              <Image className="w-5 h-5" />
              テクスチャを選択
            </label>
            <input
              id="texture-upload"
              type="file"
              accept=".png,.jpg,.jpeg"
              multiple
              onChange={handleTextureChange}
              className="hidden"
            />
            
            <label
              htmlFor="file-upload"
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer transition-colors"
            >
              <Upload className="w-5 h-5" />
              FBXファイルを選択
            </label>
            <input
              id="file-upload"
              type="file"
              accept=".fbx"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>
      </div>

      {/* テクスチャ情報 */}
      {Object.keys(textures).length > 0 && (
        <div className="px-6 py-2 bg-gray-950 border-b border-gray-800">
          <div className="max-w-7xl mx-auto flex items-center gap-4 text-sm text-gray-400">
            <span>読み込み済みテクスチャ:</span>
            {textures.diffuse && <span className="text-green-400">Diffuse</span>}
            {textures.normal && <span className="text-blue-400">Normal</span>}
            {textures.metallic && <span className="text-yellow-400">Metallic</span>}
            {textures.roughness && <span className="text-orange-400">Roughness</span>}
            {textures.metallicRoughness && <span className="text-pink-400">Metallic-Roughness</span>}
          </div>
        </div>
      )}

      {/* 3Dビュー */}
      <div className="flex-1 relative">
        {modelUrl ? (
          <ModelViewer modelUrl={modelUrl} textures={textures} />
        ) : (
          <div className="size-full flex items-center justify-center">
            <div className="text-center">
              <Upload className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400 text-lg mb-2">FBXファイルをアップロードしてください</p>
              <p className="text-gray-600 text-sm">
                上部のボタンからファイルを選択すると、3Dモデルが表示されます
              </p>
            </div>
          </div>
        )}
      </div>

      {/* フッター情報 */}
      {modelUrl && (
        <div className="p-4 bg-gray-950 border-t border-gray-800">
          <div className="max-w-7xl mx-auto text-center text-gray-400 text-sm">
            モデルが読み込まれました - マウスで操作できます
          </div>
        </div>
      )}
    </div>
  );
}
