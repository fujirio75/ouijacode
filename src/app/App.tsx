import { ModelViewer } from '@/app/components/ModelViewer';

const DEFAULT_MODEL = '/models/chara.glb';

export default function App() {
  return (
    <div className="size-full bg-gray-900">
      <ModelViewer modelUrl={DEFAULT_MODEL} />
    </div>
  );
}
