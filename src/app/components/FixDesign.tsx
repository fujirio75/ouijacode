import { ModelViewer } from '@/app/components/ModelViewer';
import { Twitter, Instagram } from 'lucide-react';

const DEFAULT_MODEL = '/models/chara.glb';

const YELLOW = '#E5C76B';
const BG_DARK = '#1a1a1a';

/**
 * FIX_DESIGN フレームの実装
 * 3DModel エリアには既存のキャラクター3D（chara.glb）を表示
 */
export function FixDesign() {
  return (
    <div
      className="flex min-h-screen w-full flex-col text-white"
      style={{ backgroundColor: BG_DARK }}
    >
      {/* ヘッダー: ouija | game engineering | code */}
      <header className="flex shrink-0 items-center justify-between px-6 py-5 uppercase tracking-wide" style={{ color: YELLOW }}>
        <span className="text-lg font-medium">ouija</span>
        <span className="text-lg font-medium">game engineering</span>
        <span className="text-lg font-medium">code</span>
      </header>

      {/* メイン: 大きなオーバーレイテキスト + 中央に3DModel */}
      <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4">
        {/* 背面レイヤー: 大きな ouija / code テキスト */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-4 sm:px-8 md:px-12">
          <span
            className="text-[clamp(4rem,15vw,12rem)] font-bold uppercase leading-none tracking-tight opacity-90"
            style={{ color: YELLOW }}
            aria-hidden
          >
            ouija
          </span>
          <span
            className="text-[clamp(4rem,15vw,12rem)] font-bold uppercase leading-none tracking-tight opacity-90"
            style={{ color: YELLOW }}
            aria-hidden
          >
            code
          </span>
        </div>

        {/* 前面レイヤー: 3DModel エリア（既存キャラクター3D） */}
        <section
          data-area="3DModel"
          className="relative z-10 h-[min(60vh,520px)] w-full max-w-lg overflow-hidden rounded-2xl"
          aria-label="3D Model"
        >
          <div className="h-full w-full">
            <ModelViewer modelUrl={DEFAULT_MODEL} />
          </div>
        </section>
      </main>

      {/* フッター: アイコン | 説明文 | number */}
      <footer className="flex shrink-0 flex-wrap items-end justify-between gap-6 px-6 py-6 text-sm text-white/90">
        <div className="flex items-center gap-4">
          <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="transition-opacity hover:opacity-80" aria-label="X (Twitter)">
            <Twitter size={20} strokeWidth={1.5} />
          </a>
          <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" className="transition-opacity hover:opacity-80" aria-label="Instagram">
            <Instagram size={20} strokeWidth={1.5} />
          </a>
        </div>
        <div className="max-w-xl text-center text-xs leading-relaxed">
          <p>
            ouija code is a game engineer who builds simple, thoughtful interactive experiences with a minimalist, detail-driven approach.
          </p>
          <p className="mt-1">
            He enjoys shaping quiet, refined gameplay feel—tight controls and polished performance. Developed by Rio Fujimoto.
          </p>
        </div>
        <div className="text-right text-xs">
          <div>number:</div>
          <div className="font-mono tracking-widest">0000000000000</div>
        </div>
      </footer>
    </div>
  );
}
