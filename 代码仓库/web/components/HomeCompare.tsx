import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

/**
 * 首页对比组件（定稿：B · 光晕显影）。
 * 素材：hero-street-raw.webp（灰暗废片）→ hero-street.webp（黄金时刻成品），同场景强对比。
 *
 * 交互：竖向分割线带暖色羽化光带，随拖动「显影」；松手磁性吸附到 2 / 25 / 50 / 75 / 98（含两端边界，
 * 拖到边界停靠在边界、不回弹；边界为硬端点，不做 spring 缩放反馈）。
 * 相纸 proof 保持用户确认的位置（lg:-left-24 lg:bottom-0），交互时淡出、松手回归。
 */

type HomeCompareProps = {
  before: string;
  after: string;
  initial?: number;
};

/** 含两端边界的停靠点：拖到最左/最右会停在 2/98，不会弹回 25/75 */
const SNAP_POINTS = [2, 25, 50, 75, 98];
const EDGE_MIN = 2;
const EDGE_MAX = 98;

function clamp(value: number) {
  return Math.max(EDGE_MIN, Math.min(EDGE_MAX, value));
}

export function HomeCompare({ before, after, initial = 52 }: HomeCompareProps) {
  const [progress, setProgress] = useState(initial);
  const [engaged, setEngaged] = useState(false);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const progressRef = useRef(initial);
  const position = progress + '%';

  // 单一写入口：同步 ref 与 state，避免 endDrag 闭包读到旧 progress
  const applyProgress = useCallback((value: number) => {
    const next = clamp(value);
    progressRef.current = next;
    setProgress(next);
  }, []);

  const setFromPointer = useCallback((clientX: number, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    applyProgress(((clientX - bounds.left) / bounds.width) * 100);
  }, [applyProgress]);

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    setEngaged(false);
    const current = progressRef.current;
    // 边界区（≤2 或 ≥98）直接停靠端点，不进入 spring 回弹；中间区吸附到最近停靠点
    const atEdge = current <= EDGE_MIN || current >= EDGE_MAX;
    const snap = atEdge
      ? current
      : SNAP_POINTS.reduce((best, cur) => (Math.abs(cur - current) < Math.abs(best - current) ? cur : best), 50);
    if (snap !== current) applyProgress(snap);
  }, [applyProgress]);

  useEffect(() => {
    window.addEventListener('pointerup', endDrag);
    return () => window.removeEventListener('pointerup', endDrag);
  }, [endDrag]);

  return (
    <div className="relative">
      <div className="relative w-full bg-[#fffdf8] p-2.5 shadow-[0_30px_76px_-46px_rgba(58,35,20,.62)]">
        <div
          className={`relative aspect-[5/4] touch-none overflow-hidden bg-[#eee5d9] ${dragging ? 'cursor-none' : 'cursor-ew-resize'}`}
          onPointerDown={(event) => {
            draggingRef.current = true;
            setDragging(true);
            setEngaged(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            setFromPointer(event.clientX, event.currentTarget);
          }}
          onPointerMove={(event) => {
            if (draggingRef.current) setFromPointer(event.clientX, event.currentTarget);
          }}
          onPointerEnter={() => setEngaged(true)}
          onPointerLeave={() => { if (!draggingRef.current) setEngaged(false); }}
          title="左右拖动，对比原图与作品"
        >
          {/* 成品为底，原图覆盖左侧 */}
          <img src={after} alt="成品预览" className="absolute inset-0 size-full object-cover" draggable={false} />
          <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }}>
            <img src={before} alt="原图预览" className="size-full object-cover" draggable={false} />
            <span className="pointer-events-none absolute bottom-2.5 left-2.5 z-10 rounded bg-stone-950/55 px-2 py-1 text-[10px] font-semibold tracking-wide text-white/90 backdrop-blur-sm">原图</span>
          </div>
          <span className="pointer-events-none absolute bottom-2.5 right-2.5 z-10 rounded bg-primary/85 px-2 py-1 text-[10px] font-semibold tracking-wide text-white backdrop-blur-sm">作品</span>

          {/* 暖色羽化光带：扫过处像被显影点亮 */}
          <div
            className="pointer-events-none absolute inset-y-0 z-20 w-24 -translate-x-1/2 transition-opacity duration-200"
            style={{
              left: position,
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,236,210,.06) 30%, rgba(255,214,160,.38) 50%, rgba(255,236,210,.06) 70%, transparent 100%)',
              opacity: dragging ? 1 : 0.75,
            }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 z-20 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[#fff5e6] to-transparent"
            style={{ left: position }}
          />
          <span className="pointer-events-none absolute right-2.5 top-2.5 z-10 rounded-sm bg-white/82 px-2 py-1 text-[9px] font-semibold tracking-[0.08em] text-stone-700 backdrop-blur-sm">AI 示意图</span>

          <input
            type="range"
            min={2}
            max={98}
            value={progress}
            onChange={(event) => applyProgress(Number(event.target.value))}
            aria-label="拖动对比原图与作品"
            className="absolute inset-0 z-40 size-full cursor-inherit opacity-0"
          />
        </div>

        {/* 圆形把手：放在 overflow-hidden 图片层之外，避免拖到两端被裁切；
            用相框 padding(10px) 作为可移动区间的边界，保证完整浮在图上、不被裁掉 */}
        <div
          className="pointer-events-none absolute top-1/2 z-30 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `calc(10px + (100% - 20px) * ${progress / 100})` }}
        >
          <span className={`grid size-11 place-items-center rounded-full border-2 border-white/90 bg-[#c0562f]/90 text-white shadow-[0_0_24px_rgba(192,86,47,.7)] backdrop-blur transition-transform duration-300 ${dragging ? 'scale-110' : 'scale-100'}`}>
            <Sparkles className="size-4" />
          </span>
        </div>

        {/* 相纸 proof：位置保持用户确认版，交互时淡出 */}
        <div
          data-testid="home-compare-proof"
          className={
            'pointer-events-none absolute bottom-3 left-3 z-20 hidden items-end gap-1 transition-all duration-500 sm:flex lg:-left-24 lg:bottom-0 ' +
            (engaged ? 'translate-y-3 opacity-0' : 'translate-y-0 opacity-100')
          }
          aria-hidden="true"
        >
          <div className="-rotate-[6deg] bg-[#fffdf8] p-1.5 shadow-[0_16px_32px_-18px_rgba(44,28,17,.62)]">
            <span className="relative block h-40 w-32 overflow-hidden">
              <img src={before} alt="" className="size-full object-cover" draggable={false} />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/68 to-transparent px-2 pb-1.5 pt-7 font-display text-xs text-white">原图</span>
            </span>
          </div>
          <svg className="relative z-30 -mx-4 mb-11 h-11 w-16 shrink-0 drop-shadow-[0_1px_2px_rgba(44,28,17,.35)]" viewBox="0 0 64 38" fill="none">
            <path d="M4 30C17 7 40 5 57 18" stroke="#fffaf0" strokeWidth="4" strokeLinecap="round" />
            <path d="m50 11 9 7-9 6" stroke="#fffaf0" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 30C17 7 40 5 57 18" stroke="#b5522f" strokeWidth="1.6" strokeLinecap="round" />
            <path d="m51 12 7 5-7 5" stroke="#b5522f" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="-ml-1 translate-y-2 rotate-[4deg] bg-[#fffdf8] p-1.5 shadow-[0_18px_34px_-18px_rgba(44,28,17,.64)]">
            <span className="relative block h-44 w-36 overflow-hidden">
              <img src={after} alt="" className="size-full object-cover" draggable={false} />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-7 font-display text-xs text-white">作品</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
