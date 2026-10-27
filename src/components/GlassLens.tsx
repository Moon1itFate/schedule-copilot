import LiquidGlass from 'liquid-glass-react';
import { useLayoutEffect, useRef } from 'react';

/** Keep optics separate from content so refraction never distorts labels or hit targets. */
export function GlassLens({ radius = 28 }: { radius?: number }) {
  const lens = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { surface.current = lens.current?.parentElement ?? null; }, []);
  return (
    <div ref={lens} className="liquid-lens" aria-hidden="true">
      <LiquidGlass
        className="liquid-lens-surface"
        cornerRadius={radius}
        displacementScale={36}
        blurAmount={0.12}
        saturation={125}
        aberrationIntensity={1.2}
        elasticity={0.06}
        mouseContainer={surface}
        overLight
        mode="standard"
        padding="0"
        style={{ position: 'absolute', width: '100%', height: '100%', top: '50%', left: '50%' }}
      >
        <span className="liquid-lens-fill" />
      </LiquidGlass>
    </div>
  );
}
