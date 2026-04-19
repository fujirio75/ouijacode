import { ModelViewer } from '@/app/components/ModelViewer';

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;

const DEFAULT_MODEL = assetPath('models/chara.glb');

const BG_DARK = '#272727';
const RED = '#FF5656';

/**
 * FIX_DESIGN フレームの実装 — Figmaデザイン忠実再現
 * レイヤー順: w3ロゴ(後ろ) → 3Dモデル(猫) → Software(手前)
 */
export function FixDesign() {
  return (
    <div
      className="fixdesign-root relative flex h-dvh min-h-screen w-full flex-col overflow-hidden"
      style={{ backgroundColor: BG_DARK }}
    >
      {/* 3Dステージは footer を除いた残り高さを埋める */}
      <main className="fixdesign-stage relative min-h-0 flex-1">
        {/* レイヤー1: w3 ストロークロゴ（最背面） */}
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
          <img
            src={assetPath('w3-logo.svg')}
            alt=""
            aria-hidden="true"
            className="fixdesign-w3-logo"
          />
        </div>

        {/* レイヤー2: 3Dモデル（猫）— 中間レイヤー、画面いっぱい */}
        <div className="fixdesign-model-layer absolute inset-0 z-10">
          <ModelViewer modelUrl={DEFAULT_MODEL} />
        </div>

      </main>
      {/* ヘッダー: w3 | game engineering | software (SVGアウトライン) */}
      <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-[3.75%] py-[32px]">
        <img src={assetPath('header-w3.svg')} alt="w3" className="h-[11px]" />
        <img src={assetPath('header-game-engineering.svg')} alt="game engineering" className="h-[14px]" />
        <img src={assetPath('header-software.svg')} alt="software" className="h-[11px]" />
      </header>

      {/* 区切り線 + フッター */}
      <div className="fixdesign-footer-shell relative z-30 shrink-0">
        <div className="fixdesign-footer-software pointer-events-none absolute inset-x-0 flex justify-center">
          <img
            src={assetPath('software-large.svg')}
            alt="Software"
            className="fixdesign-software-logo"
          />
        </div>

        <div
          className="mx-[3.75%]"
          style={{
            height: '1px',
            backgroundColor: RED,
            opacity: 0.33,
          }}
        />

        <footer className="fixdesign-footer flex items-start justify-between px-[3.75%] py-5" style={{ color: RED }}>
          {/* ソーシャルアイコン */}
          <div className="flex items-center gap-3">
            <a href="#" aria-label="X (Twitter)">
              <img src={assetPath('icon-x.svg')} alt="X" className="h-[15px] w-[15px]" />
            </a>
          </div>

          {/* 説明テキスト */}
          <div
            className="max-w-[660px] text-center"
            style={{
              fontFamily: "'Sofia Pro', sans-serif",
              fontWeight: 500,
              fontSize: '11px',
              letterSpacing: '0.22px',
              lineHeight: '140%',
              color: RED,
            }}
          >
            <p>
              w3 software is a game engineer who builds simple, thoughtful interactive experiences with a minimalist, detail-driven approach.
            </p>
            <p>
              He enjoys shaping quiet, refined gameplay feel—tight controls and polished performance.
            </p>
          </div>

          {/* number */}
          <div
            className="fixdesign-footer-number text-right"
            style={{
              fontFamily: "'Sofia Pro', sans-serif",
              fontWeight: 500,
              fontSize: '11px',
              letterSpacing: '0.22px',
              lineHeight: '140%',
              color: RED,
            }}
          >
            <div>number:</div>
            <div>0000000000000</div>
          </div>
        </footer>
      </div>
    </div>
  );
}
