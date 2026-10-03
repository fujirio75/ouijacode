import { ModelViewer } from '@/app/components/ModelViewer';

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;

const DEFAULT_MODEL = assetPath(`models/${import.meta.env.VITE_MODEL_FILE ?? 'eight-ball.glb'}`);
const W3_LOGO = assetPath('w3-logo.svg');
const SOFTWARE_LOGO = assetPath('software-large.svg');

export function FixDesign() {
  return (
    <main className="node-space-root relative h-dvh min-h-screen w-full overflow-hidden bg-white">
      <ModelViewer
        modelUrl={DEFAULT_MODEL}
        softwareLogoUrl={SOFTWARE_LOGO}
        w3LogoUrl={W3_LOGO}
      />
    </main>
  );
}
