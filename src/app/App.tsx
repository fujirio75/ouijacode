import { MarsSphere } from '@/app/components/MarsSphere';
import { EyesOverlay } from '@/app/components/EyesOverlay';

export default function App() {
  return (
    <div className="w-screen h-screen bg-black relative overflow-hidden">
      {/* Layer 1: 3D Sphere */}
      <MarsSphere />

      {/* Layer 2: 2D Eyes */}
      <EyesOverlay />

      {/* Layer 3: UI Text */}
      <div
        className="fixed inset-0 z-20 flex flex-col justify-between pointer-events-none"
        style={{ fontFamily: "'Space Mono', monospace" }}
      >
        {/* Header */}
        <div className="flex items-center gap-4 p-6 text-white text-xs uppercase tracking-widest">
          <span>ouija</span>
          <span>game engineering</span>
          <span>code</span>
        </div>

        {/* Footer */}
        <div>
          <div className="w-full h-px bg-white/30" />
          <div className="flex items-center justify-between p-6 text-white text-[10px] uppercase tracking-widest">
            <a href="#" className="pointer-events-auto">X</a>
            <span className="text-center max-w-xl">
              ouija code is a game engineer who builds simple, thoughtful interactive experiences with a minimalist, detail-driven approach. He enjoys shaping quiet, refined gameplay feel—tight controls and polished performance. Developed by Rio Fujimoto.
            </span>
            <span>number: 0000000000000</span>
          </div>
        </div>
      </div>
    </div>
  );
}
