import { useState } from 'react';

export function CompareSlider({ before, after, className }: {
  before: string; after: string; className?: string;
}) {
  const [pos, setPos] = useState(50);
  return (
    <div className={`relative overflow-hidden select-none ${className || ''}`}>
      <img src={after} alt="生成结果" className="block w-full" draggable={false} />
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
        <img
          src={before}
          alt="原图"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ width: `${10000 / pos}%`, maxWidth: 'none' }}
          draggable={false}
        />
      </div>
      <div className="absolute inset-y-0 w-0.5 bg-white/90 shadow" style={{ left: `${pos}%` }} />
      <div
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white px-2 py-1 text-xs font-medium text-neutral-700 shadow"
        style={{ left: `${pos}%` }}
      >
        ⇔
      </div>
      <span className="absolute left-2 top-2 rounded bg-black/55 px-2 py-0.5 text-xs text-white">原图</span>
      <span className="absolute right-2 top-2 rounded bg-black/55 px-2 py-0.5 text-xs text-white">AI 生成</span>
      <input
        type="range" min={0} max={100} value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="修前修后对比滑杆"
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}