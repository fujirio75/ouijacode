import { useCallback, useEffect, useState } from 'react';
import { BookOpen, ExternalLink, Github, MessageCircle, X } from 'lucide-react';
import { ModelViewer } from '@/app/components/ModelViewer';

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;

const DEFAULT_MODEL = assetPath(`models/${import.meta.env.VITE_MODEL_FILE ?? 'eight-ball.glb'}`);
const BLOG_URL = import.meta.env.VITE_BLOG_URL ?? '';
const GITHUB_URL = import.meta.env.VITE_GITHUB_URL ?? 'https://github.com/fujirio75';
const VRCHAT_URL = import.meta.env.VITE_VRCHAT_URL ?? '';

export function FixDesign() {
  const [isLinksOpen, setIsLinksOpen] = useState(false);
  const openLinks = useCallback(() => setIsLinksOpen(true), []);

  useEffect(() => {
    if (!isLinksOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsLinksOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLinksOpen]);

  const links = [
    { href: BLOG_URL, icon: BookOpen, label: 'Blog', note: '制作と日々の記録' },
    { href: GITHUB_URL, icon: Github, label: 'GitHub', note: 'コードとプロジェクト' },
    { href: VRCHAT_URL, icon: MessageCircle, label: 'VRChat', note: '仕事のご依頼、ご相談はこちらから' }
  ];

  return (
    <main className="node-space-root relative h-dvh min-h-screen w-full overflow-hidden bg-[#fbfbf9]">
      <ModelViewer modelUrl={DEFAULT_MODEL} onActivate={openLinks} />

      {isLinksOpen && (
        <div
          className="absolute inset-0 z-20 flex items-end justify-center bg-black/20 p-3 backdrop-blur-sm sm:items-center sm:p-6"
          onPointerDown={() => setIsLinksOpen(false)}
          role="presentation"
        >
          <section
            aria-labelledby="links-title"
            aria-modal="true"
            className="w-full max-w-md rounded-[2rem] border border-black/10 bg-white/95 p-5 shadow-[0_30px_100px_rgba(0,0,0,0.22)] sm:p-6"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="mb-5 flex items-center justify-between">
              <h1 className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-black/50" id="links-title">
                Links
              </h1>
              <button
                aria-label="閉じる"
                className="grid size-10 place-items-center rounded-full bg-black/[0.05] text-black transition hover:bg-black hover:text-white"
                onClick={() => setIsLinksOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <nav aria-label="外部リンク" className="grid gap-2.5">
              {links.map(({ href, icon: Icon, label, note }) => {
                const isReady = Boolean(href);
                return (
                  <a
                    aria-disabled={!isReady}
                    className={`group flex min-h-20 items-center gap-4 rounded-2xl border px-4 py-3.5 transition ${
                      isReady
                        ? 'border-black/10 bg-white hover:-translate-y-0.5 hover:border-[#c8102e]/40 hover:shadow-lg'
                        : 'cursor-not-allowed border-black/[0.06] bg-black/[0.025] opacity-45'
                    }`}
                    href={isReady ? href : undefined}
                    key={label}
                    onClick={(event) => {
                      if (!isReady) event.preventDefault();
                    }}
                    rel="noreferrer"
                    target={isReady ? '_blank' : undefined}
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#c8102e] text-white">
                      <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[1.05rem] font-semibold tracking-tight text-black">{label}</span>
                      <span className="mt-0.5 block text-sm text-black/50">{isReady ? note : 'URL準備中'}</span>
                    </span>
                    {isReady && (
                      <ExternalLink
                        aria-hidden="true"
                        className="text-black/35 transition group-hover:text-[#c8102e]"
                        size={18}
                      />
                    )}
                  </a>
                );
              })}
            </nav>
          </section>
        </div>
      )}
    </main>
  );
}
