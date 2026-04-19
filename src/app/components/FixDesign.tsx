import { ModelViewer } from '@/app/components/ModelViewer';

const DEFAULT_MODEL = '/models/chara.glb';

const BG_DARK = '#272727';
const RED = '#FF5656';

/**
 * FIX_DESIGN フレームの実装 — Figmaデザイン忠実再現
 * レイヤー順: w3ロゴ(後ろ) → 3Dモデル(猫) → Software(手前)
 */
export function FixDesign() {
  return (
    <div
      className="relative h-dvh min-h-screen w-full overflow-hidden"
      style={{ backgroundColor: BG_DARK }}
    >
      {/* 3Dステージを viewport 全体に広げ、ヘッダー/フッターは上に重ねる */}
      <main className="absolute inset-0">
        {/* レイヤー1: w3 ストロークロゴ（最背面） */}
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
          <img
            src="/w3-logo.svg"
            alt=""
            aria-hidden="true"
            className="w-[83%] max-w-[1071px]"
          />
        </div>

        {/* レイヤー2: 3Dモデル（猫）— 中間レイヤー、画面いっぱい */}
        <div className="absolute inset-0 z-10">
          <ModelViewer modelUrl={DEFAULT_MODEL} />
        </div>

        {/* レイヤー3: "Software" SVG（最前面 — 猫の手前） */}
        <div
          className="pointer-events-none absolute z-20"
          style={{
            bottom: 'clamp(120px, 17vh, 180px)',
            left: '50%',
            transform: 'translateX(-35%)',
          }}
        >
          <img
            src="/software-large.svg"
            alt="Software"
            className="w-[clamp(230px,36vw,458px)]"
          />
        </div>
      </main>

      {/* ヘッダー: w3 | game engineering | software (SVGアウトライン) */}
      <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-[3.75%] py-[4.3%]">
        <img src="/header-w3.svg" alt="w3" className="h-[11px]" />
        <img src="/header-game-engineering.svg" alt="game engineering" className="h-[14px]" />
        <img src="/header-software.svg" alt="software" className="h-[11px]" />
      </header>

      {/* 区切り線 + フッターを前面オーバーレイ */}
      <div className="absolute inset-x-0 bottom-0 z-30">
        <div
          className="mx-[3.75%]"
          style={{
            height: '1px',
            backgroundColor: RED,
            opacity: 0.33,
          }}
        />

        <footer
          className="flex items-start justify-between px-[3.75%] py-5"
          style={{ color: RED }}
        >
          {/* ソーシャルアイコン */}
          <div className="flex items-center gap-3">
            <a href="#" aria-label="X (Twitter)">
              <img src="/icon-x.svg" alt="X" className="h-[15px] w-[15px]" />
            </a>
            <a href="#" aria-label="Instagram">
              <img src="/icon-twitch.svg" alt="Instagram" className="h-[17px] w-[17px]" />
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
              ouija code is a game engineer who builds simple, thoughtful interactive experiences with a minimalist, detail-driven approach.
            </p>
            <p>
              He enjoys shaping quiet, refined gameplay feel—tight controls and polished performance. Developed by Rio Fujimoto.
            </p>
          </div>

          {/* number */}
          <div
            className="text-right"
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
