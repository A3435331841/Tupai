import { useEffect, useRef } from 'react';
import { ArrowRight, Lock } from 'lucide-react';

/**
 * 无限循环画廊（从设计稿原型移植到 React 产品）
 *
 * 设计要点：
 * - 动画用 requestAnimationFrame + 直接写 DOM style，不走 setState，保证 60fps 且连点不卡
 * - 选中态：卡片平滑归中 + 放大 + 信息层；点击其它卡自然切换；点空白/关闭/Esc 恢复
 * - 快速连点：pointerdown 时锁定命中目标（downHit），pointerup 用它决策，
 *   避免卡片放大后 elementFromPoint 漂移导致状态错乱
 * - 滑动浏览中（is-sliding）淡出角标与名称，停止 240ms 后自动恢复
 */

export type GalleryItem = {
  id: string;
  src: string;
  title: string;
  /** 有值则「做同款」带 template 深链进创作台 */
  templateId?: string;
  /** 是否原创图（显示 AI 示意角标） */
  ai?: boolean;
};

const CARD_W = 'clamp(150px,15vw,210px)';

export function GalleryRail({
  items,
  onUse,
  ariaLabel = '模板作品无限画廊',
}: {
  items: GalleryItem[];
  onUse: (item: GalleryItem) => void;
  ariaLabel?: string;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);
  // 可变状态全部放 ref，避免动画循环触发 React 重渲染
  const state = useRef({
    offset: 0,
    targetOffset: 0,
    selected: -1 as number,
    hover: -1 as number,
    playing: true,
    dragging: false,
    lastX: 0,
    downX: 0,
    downY: 0,
    moved: false,
    vel: 0,
    mouseX: 0,
    mouseY: 0,
    tx: 0,
    ty: 0,
    downHit: null as null | { use: boolean; close: boolean; idx: number },
    sliding: 0,
    raf: 0,
  });

  const N = items.length;

  // 空闲预加载：首屏只加载内圈，随后后台把其余图取完，避免循环滚入时闪白
  useEffect(() => {
    if (N === 0) return;
    const timer = window.setTimeout(() => {
      items.forEach((item) => {
        const img = new Image();
        img.decoding = 'async';
        img.src = item.src;
      });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [items, N]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || N === 0) return;
    const s = state.current;

    const wrapD = (d: number) => ((d + N / 2) % N + N) % N - N / 2;
    const gap = () => {
      const w = nodeRefs.current[0]?.offsetWidth || 180;
      return Math.max(w * 1.22, w + 26);
    };

    let slideTimer = 0;
    const markSliding = () => {
      s.sliding = 1;
      rail.classList.add('is-sliding');
      window.clearTimeout(slideTimer);
      slideTimer = window.setTimeout(() => {
        s.sliding = 0;
        rail.classList.remove('is-sliding');
      }, 240);
    };

    const select = (i: number) => {
      if (s.selected === i) return deselect();
      if (s.selected >= 0) nodeRefs.current[s.selected]?.classList.remove('is-selected');
      // 归位目标：基于当前 offset 的循环最短距离
      s.targetOffset = s.offset + wrapD(i - s.offset);
      s.selected = i;
      nodeRefs.current[i]?.classList.add('is-selected');
      rail.classList.add('has-selected');
      s.tx = 0;
      s.ty = 0;
    };
    const deselect = () => {
      if (s.selected < 0) return;
      nodeRefs.current[s.selected]?.classList.remove('is-selected');
      s.selected = -1;
      rail.classList.remove('has-selected');
    };
    const useSelected = () => {
      if (s.selected >= 0) onUse(items[s.selected]);
    };

    const tick = () => {
      if (s.selected >= 0) {
        s.offset += (s.targetOffset - s.offset) * 0.14;
        if (Math.abs(s.targetOffset - s.offset) < 0.0008) s.offset = s.targetOffset;
      } else if (s.playing && !s.dragging) {
        s.offset += 0.0022 + s.vel;
        s.vel *= 0.94;
      }
      s.mouseX += (s.tx - s.mouseX) * 0.06;
      s.mouseY += (s.ty - s.mouseY) * 0.06;

      const railW = rail.clientWidth;
      const cx = railW / 2;
      const g = gap();
      const spread = (railW * 0.62) / g;

      for (let i = 0; i < N; i++) {
        const el = nodeRefs.current[i];
        if (!el) continue;
        const d = wrapD(i - s.offset);
        const x = d * g;
        const ad = Math.abs(d);
        const norm = Math.min(ad / spread, 1);
        let scale = 1 - norm * 0.42;
        let bright = 1 - norm * 0.55;
        let blur = norm * 2.4;
        let op = 1 - norm * 0.72;
        let z = Math.round(100 - ad * 10);
        let px = 0;
        let py = 0;
        let rotY = 0;
        let rotX = 0;

        const isSel = s.selected === i;
        const isHover = s.selected < 0 && s.hover === i && ad < 0.85;

        if (s.selected >= 0) {
          if (isSel) {
            scale = 1.2;
            bright = 1;
            blur = 0;
            op = 1;
            z = 200;
          } else {
            // 选中时其余卡：略微缩小 + 压暗，让焦点落在中间（替代大面积蒙层）
            scale *= 0.93;
            bright *= 0.52;
            z = Math.min(z, 80);
            px = s.mouseX * 4;
            py = s.mouseY * 3;
          }
        } else {
          const pf = isHover ? 1 : 0.75;
          px = s.mouseX * (16 + norm * 26) * (1 - norm * 0.4) * pf;
          py = s.mouseY * (10 + norm * 8) * pf;
          rotY = s.mouseX * (4 + norm * 6) * pf;
          rotX = -s.mouseY * 3 * pf;
          if (isHover) {
            scale += 0.07;
            bright = Math.min(1, bright + 0.12);
            z = Math.max(z, 92);
          }
        }

        el.style.transform = `translate(-50%,-50%) translate(${x + px}px,${py}px) scale(${scale}) rotateY(${rotY}deg) rotateX(${rotX}deg)`;
        el.style.filter = `brightness(${bright}) blur(${blur}px)`;
        el.style.opacity = String(op);
        el.style.zIndex = String(z);
        el.style.cursor = isSel ? 'default' : 'pointer';

        const shade = el.querySelector<HTMLElement>('[data-shade]');
        if (shade) shade.style.opacity = isSel ? '0' : String(norm * 0.18);
        const cap = el.querySelector<HTMLElement>('[data-cap]');
        if (cap) cap.style.opacity = s.selected < 0 && norm < 0.35 ? '1' : '0';
      }

      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);

    /* ---------- 事件 ---------- */
    const onPointerMove = (e: PointerEvent) => {
      const r = rail.getBoundingClientRect();
      s.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      s.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (s.dragging) {
        const dx = e.clientX - s.lastX;
        s.lastX = e.clientX;
        if (Math.abs(e.clientX - s.downX) > 4 || Math.abs(e.clientY - s.downY) > 4) s.moved = true;
        if (s.moved) {
          markSliding();
          if (s.selected >= 0) deselect();
          s.offset -= dx / gap();
          s.vel = -(dx / gap()) * 0.5;
        }
        return;
      }
      // hover 检测
      const el = (e.target as HTMLElement)?.closest<HTMLElement>('[data-i]');
      s.hover = el ? Number(el.dataset.i) : -1;
    };

    const onPointerDown = (e: PointerEvent) => {
      s.dragging = true;
      s.lastX = e.clientX;
      s.downX = e.clientX;
      s.downY = e.clientY;
      s.moved = false;
      const t = e.target as HTMLElement;
      const item = t.closest<HTMLElement>('[data-i]');
      s.downHit = {
        use: Boolean(t.closest('[data-use]')),
        close: Boolean(t.closest('[data-close]')),
        idx: item ? Number(item.dataset.i) : -1,
      };
      rail.setPointerCapture(e.pointerId);
    };

    const onPointerUp = () => {
      s.dragging = false;
      const hit = s.downHit;
      s.downHit = null;
      if (s.moved || !hit) return;
      if (hit.use) return useSelected();
      if (hit.close) return deselect();
      if (hit.idx >= 0) select(hit.idx);
      else deselect();
    };

    const onPointerLeave = () => {
      s.tx = 0;
      s.ty = 0;
      s.hover = -1;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return deselect();
      if (s.selected >= 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const next = (s.selected + (e.key === 'ArrowLeft' ? -1 : 1) + N) % N;
        select(next);
      }
      if (s.selected >= 0 && e.key === 'Enter') {
        e.preventDefault();
        useSelected();
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        markSliding();
        if (s.selected >= 0) deselect();
        s.offset += e.deltaY * 0.0025;
        s.vel = 0;
      }
    };

    rail.addEventListener('pointermove', onPointerMove);
    rail.addEventListener('pointerdown', onPointerDown);
    rail.addEventListener('pointerup', onPointerUp);
    rail.addEventListener('pointercancel', onPointerUp);
    rail.addEventListener('pointerleave', onPointerLeave);
    rail.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(s.raf);
      window.clearTimeout(slideTimer);
      rail.removeEventListener('pointermove', onPointerMove);
      rail.removeEventListener('pointerdown', onPointerDown);
      rail.removeEventListener('pointerup', onPointerUp);
      rail.removeEventListener('pointercancel', onPointerUp);
      rail.removeEventListener('pointerleave', onPointerLeave);
      rail.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [N, items, onUse]);

  return (
    <div
      ref={railRef}
      tabIndex={0}
      role="list"
      aria-label={ariaLabel}
      className="group/rail relative w-full select-none overflow-hidden outline-none"
      style={{ height: 'clamp(400px,48vw,540px)', perspective: '1400px', touchAction: 'pan-y' }}
    >
      {/* 中央聚焦暗化层：范围收窄并完全过渡到透明，避免在大容器里出现灰色矩形边 */}
      <div
        className="pointer-events-none absolute inset-0 z-[150] opacity-0 transition-opacity duration-300 [.has-selected_&]:opacity-100"
        style={{
          background:
            'radial-gradient(ellipse 34% 62% at 50% 50%, rgba(28,25,23,.34), rgba(28,25,23,.10) 62%, transparent 88%)',
        }}
      />

      {items.map((item, i) => (
        <div
          key={item.id}
          data-i={i}
          ref={(el) => {
            nodeRefs.current[i] = el;
          }}
          role="listitem"
          className="absolute left-1/2 top-1/2 overflow-hidden rounded-md bg-secondary shadow-[0_20px_50px_-24px_rgba(40,25,15,.5)] will-change-transform [&.is-selected]:z-[200] [&.is-selected]:shadow-[0_0_0_2px_var(--primary),0_34px_76px_-18px_rgba(40,25,15,.72)]"
          style={{ width: CARD_W, aspectRatio: '3 / 4' }}
        >
          {/* 内圈卡片优先加载，避免循环滚入时闪白；远端按需加载 */}
          <img
            src={item.src}
            alt={item.title}
            draggable={false}
            loading={i < 8 ? 'eager' : 'lazy'}
            decoding="async"
            className="size-full object-cover"
          />
          <span data-shade className="pointer-events-none absolute inset-0 bg-stone-900 opacity-0" />

          {item.ai && (
            <span className="absolute left-2 top-2 z-[2] rounded bg-paper/90 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-foreground transition-opacity [.is-sliding_&]:opacity-0">
              AI 示意
            </span>
          )}

          {/* 名称条（非选中时显示） */}
          <span data-cap
            className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-stone-950/78 to-transparent px-2.5 pb-2.5 pt-6 text-center text-[11px] font-semibold text-white transition-opacity [.is-sliding_&]:opacity-0">
            {item.title}
          </span>

          {/* 选中信息层 */}
          <button data-close aria-label="关闭"
            className="absolute right-2 top-2 z-[4] grid size-6 place-items-center rounded-full bg-stone-950/62 text-base leading-none text-white opacity-0 transition-opacity hover:bg-primary [.is-selected_&]:opacity-100">
            ×
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] translate-y-2.5 bg-gradient-to-t from-stone-950/94 via-stone-950/80 to-transparent px-3 pb-3 pt-8 text-center opacity-0 transition-all duration-300 [.is-selected_&]:pointer-events-auto [.is-selected_&]:translate-y-0 [.is-selected_&]:opacity-100">
            <p className="font-display text-sm font-bold text-white">{item.title}</p>
            <p className="mx-auto mt-1 flex items-center justify-center gap-1 text-[10px] text-white/70">
              <Lock className="size-2.5" /> 原图私密 · 结果带 AI 标识
            </p>
            <button data-use
              className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground transition hover:bg-primary/90">
              用这张做同款 <ArrowRight className="size-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default GalleryRail;
