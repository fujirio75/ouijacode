import { useEffect, useRef } from 'react';

// Pixel offsets from screen center (x, y) so eyes stay fixed relative to sphere
const EYE_POSITIONS = [
  { x: -180, y: -120, size: 40 },
  { x: 140, y: -160, size: 35 },
  { x: -220, y: 30, size: 30 },
  { x: 200, y: 10, size: 45 },
  { x: -30, y: -200, size: 28 },
  { x: 80, y: 100, size: 38 },
  { x: -100, y: 130, size: 32 },
  { x: 10, y: -60, size: 36 },
  { x: -160, y: -40, size: 34 },
  { x: 170, y: -90, size: 30 },
  { x: -50, y: 60, size: 42 },
];

const BLINKS_PER_SET = 2;

interface BlinkState {
  lastBlinkTime: number;
  nextBlinkInterval: number;
  blinkProgress: number;
  blinkCount: number;
}

export function EyesOverlay() {
  const eyeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const blinkStatesRef = useRef<BlinkState[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const now = performance.now();
    blinkStatesRef.current = EYE_POSITIONS.map(() => ({
      lastBlinkTime: now + Math.random() * 2000,
      nextBlinkInterval: 2000 + Math.random() * 3000,
      blinkProgress: -1,
      blinkCount: 0,
    }));

    const animate = () => {
      const now = performance.now();
      const states = blinkStatesRef.current;

      for (let i = 0; i < states.length; i++) {
        const state = states[i];
        const el = eyeRefs.current[i];
        if (!el) continue;

        if (state.blinkProgress < 0 && now - state.lastBlinkTime > state.nextBlinkInterval) {
          state.blinkProgress = 0;
          state.blinkCount = 0;
          state.lastBlinkTime = now;
        }

        if (state.blinkProgress >= 0) {
          state.blinkProgress += 0.12;
          const scaleY = state.blinkProgress < 0.5
            ? 1 - state.blinkProgress * 2
            : (state.blinkProgress - 0.5) * 2;

          el.style.transform = `scaleY(${Math.max(0.05, scaleY)})`;

          if (state.blinkProgress >= 1) {
            state.blinkCount++;
            el.style.transform = 'scaleY(1)';

            if (state.blinkCount < BLINKS_PER_SET) {
              state.blinkProgress = -0.3;
            } else {
              state.blinkProgress = -1;
              state.nextBlinkInterval = 2000 + Math.random() * 3000;
            }
          }
        }

        if (state.blinkProgress > -1 && state.blinkProgress < 0) {
          state.blinkProgress += 0.04;
          if (state.blinkProgress >= 0) {
            state.blinkProgress = 0;
          }
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-10 pointer-events-none">
      {EYE_POSITIONS.map((eye, i) => (
        <div
          key={i}
          ref={(el) => { eyeRefs.current[i] = el; }}
          style={{
            position: 'absolute',
            left: `calc(50% + ${eye.x}px - ${eye.size / 2}px)`,
            top: `calc(50% + ${eye.y}px - ${eye.size / 2}px)`,
            width: eye.size,
            height: eye.size,
            borderRadius: '50%',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transformOrigin: 'center center',
          }}
        >
          <div
            style={{
              width: '60%',
              height: '60%',
              borderRadius: '50%',
              background: '#000000',
            }}
          />
        </div>
      ))}
    </div>
  );
}
