import { useRef, useState } from 'react';
import { MoveHorizontal } from 'lucide-react';

type HomeCompareProps = {
  before: string;
  after: string;
  initial?: number;
};

function clamp(value: number) {
  return Math.max(2, Math.min(98, value));
}

export function HomeCompare({ before, after, initial = 76 }: HomeCompareProps) {
  const [progress, setProgress] = useState(initial);
  const [engaged, setEngaged] = useState(false);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const position = progress + '%';

  function setFromPointer(clientX: number, element: HTMLElement) {
    const bounds = element.getBoundingClientRect();
    setProgress(clamp(((clientX - bounds.left) / bounds.width) * 100));
  }

  return (
    <div className="relative">
      <div className="relative w-full bg-[#fffdf8] p-2.5 shadow-[0_30px_76px_-46px_rgba(58,35,20,.62)]">
        <div
          className={
            'relative aspect-[5/4] touch-none overflow-hidden bg-[#eee5d9] ' +
            (dragging ? 'cursor-none' : 'cursor-ew-resize')
          }
          onPointerEnter={() => setEngaged(true)}
          onPointerLeave={() => {
            if (!draggingRef.current) setEngaged(false);
          }}
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
          onPointerUp={() => {
            draggingRef.current = false;
            setDragging(false);
            setEngaged(false);
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
            setDragging(false);
            setEngaged(false);
          }}
          title="左右拖动调整亮度"
        >
          <img
            src={after}
            alt="提亮后的作品预览"
            className="absolute inset-0 size-full object-cover"
            draggable={false}
          />
          <img
            src={before}
            alt="原片预览"
            className="absolute inset-0 size-full object-cover"
            style={{ opacity: 1 - progress / 100 }}
            draggable={false}
          />

          <div
            className={
              'pointer-events-none absolute inset-y-0 z-10 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/80 to-transparent transition-opacity duration-300 ' +
              (dragging ? 'opacity-0' : 'opacity-100')
            }
            style={{ left: position }}
          />
          <div
            className={
              'pointer-events-none absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ' +
              (dragging ? 'scale-90 opacity-0' : 'scale-100 opacity-100')
            }
            style={{ left: position }}
          >
            <span className="grid size-10 place-items-center rounded-full border border-white/85 bg-[#fffaf2]/92 text-[#9d482c] shadow-[0_8px_24px_rgba(47,28,16,.22)] backdrop-blur-md">
              <MoveHorizontal className="size-4" />
            </span>
            <span
              className={
                'absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-stone-950/50 px-2.5 py-1 text-[9px] font-medium tracking-wide text-white/90 backdrop-blur-sm transition-opacity duration-200 ' +
                (engaged ? 'opacity-0' : 'opacity-100')
              }
            >
              拖动调光
            </span>
          </div>

          <span
            className={
              'pointer-events-none absolute right-2.5 top-2.5 z-10 rounded-sm bg-white/82 px-2 py-1 text-[9px] font-semibold tracking-[0.08em] text-stone-700 backdrop-blur-sm transition-opacity duration-300 ' +
              (engaged ? 'opacity-0' : 'opacity-100')
            }
          >
            AI 示意图
          </span>

          <input
            type="range"
            min={2}
            max={98}
            value={progress}
            onChange={(event) => setProgress(Number(event.target.value))}
            aria-label="拖动调整作品亮度，对比原图"
            className="absolute inset-0 z-30 size-full cursor-inherit opacity-0"
          />
        </div>

        <div
          data-testid="home-compare-proof"
          className={
            'pointer-events-none absolute bottom-3 left-3 z-20 hidden items-end gap-1 transition-all duration-500 sm:flex ' +
            (engaged ? 'translate-y-3 opacity-0' : 'translate-y-0 opacity-100')
          }
          aria-hidden="true"
        >
          <div className="-rotate-[6deg] bg-[#fffdf8] p-1.5 shadow-[0_16px_32px_-18px_rgba(44,28,17,.62)]">
            <span className="relative block h-40 w-32 overflow-hidden">
              <img
                src={before}
                alt=""
                className="size-full object-cover brightness-[.55] saturate-[.56] contrast-[.96]"
                draggable={false}
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/68 to-transparent px-2 pb-1.5 pt-7 font-display text-xs text-white">
                原图
              </span>
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
              <img
                src={after}
                alt=""
                className="size-full object-cover"
                draggable={false}
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-7 font-display text-xs text-white">
                作品
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
