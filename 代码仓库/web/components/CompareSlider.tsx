import { useState } from 'react';
import { MoveHorizontal } from 'lucide-react';

type CompareSliderProps = {
  before: string;
  after: string;
  className?: string;
  beforeClassName?: string;
  beforeLabel?: string;
  afterLabel?: string;
  hint?: string;
};

export function CompareSlider({
  before,
  after,
  className,
  beforeClassName,
  beforeLabel = '原图',
  afterLabel = 'AI 生成',
  hint,
}: CompareSliderProps) {
  const [pos, setPos] = useState(50);

  return (
    <div className={`group relative select-none overflow-hidden bg-secondary focus-within:ring-2 focus-within:ring-primary/40 ${className || ''}`}>
      <img src={after} alt={afterLabel} className="absolute inset-0 size-full object-cover" draggable={false} />

      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        aria-hidden="true"
      >
        <img
          src={before}
          alt={beforeLabel}
          className={`absolute inset-0 size-full object-cover ${beforeClassName || ''}`}
          draggable={false}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/18 via-transparent to-amber-950/10" />
      </div>

      <span className="pointer-events-none absolute left-3 top-3 z-20 rounded-full bg-stone-950/70 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-white backdrop-blur-md sm:left-4 sm:top-4">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-3 top-3 z-20 rounded-full border border-white/50 bg-white/85 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-stone-800 backdrop-blur-md sm:right-4 sm:top-4">
        {afterLabel}
      </span>

      <div className="pointer-events-none absolute inset-y-0 z-20 w-px -translate-x-1/2 bg-white/95 shadow-[0_0_18px_rgba(0,0,0,.28)]" style={{ left: `${pos}%` }} />
      {/* 把手用 clamp 约束在框内，避免拖到两端被 overflow-hidden 裁掉一半 */}
      <div
        className="pointer-events-none absolute top-1/2 z-20 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/80 bg-white text-stone-800 shadow-[0_8px_24px_rgba(0,0,0,.28)] transition-transform duration-200 group-hover:scale-105 sm:size-12"
        style={{ left: `clamp(1.5rem, ${pos}%, calc(100% - 1.5rem))` }}
      >
        <MoveHorizontal className="size-5" aria-hidden="true" />
      </div>

      {hint && (
        <span className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-stone-950/58 px-3 py-1.5 text-[10px] text-white backdrop-blur-md sm:bottom-4 sm:text-xs">
          {hint}
        </span>
      )}

      <input
        type="range"
        min={2}
        max={98}
        value={pos}
        onChange={(event) => setPos(Number(event.target.value))}
        aria-label="修前修后对比滑杆"
        aria-valuetext={`修后 ${pos}%`}
        className="absolute inset-0 z-30 size-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}
