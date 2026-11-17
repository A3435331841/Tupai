import { useEffect, useMemo, useRef, useState } from 'react';
import { setPendingFile } from '@/lib/handoff';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

const SAMPLE = '/samples/demo-night.jpg';
const DEMO_TEXT = '想要胶片感的旅行照，傍晚暖光，人物不变';
const SLOGAN = ['拍照不好看，也能有拿得出手的作品', '废片变作品，原图可以只留给自己'];
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// 时间轴：0.7s 起扫光，慢扫 2.1s 揭示成片，2.9s logo 与标语逐字浮现，4.3s 行动点上浮
const SWEEP_AT = 700;
const SWEEP_DUR = 2100;
const TEXT_AT = 2900;
const CTA_AT = 4300;
const HANDOFF_AT = SWEEP_AT + SWEEP_DUR + 350;

const stillMode = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Landing({ navigate }: { navigate: (to: string) => void }) {
  const [phase, setPhase] = useState(0); // 0 废片 · 1 扫光 · 2 成片 · 3 文字 · 4 行动点
  const [run, setRun] = useState(0);
  const [src, setSrc] = useState(SAMPLE);
  const [text, setText] = useState('');
  const [hovering, setHovering] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const handoffRef = useRef<number | null>(null);

  // logo 与两行标语共用一个字符序号，浮现顺序就是 图派 → 标语一 → 标语二
  const lines = useMemo(() => {
    let n = 0;
    return ['图派', ...SLOGAN].map((line) => ({
      chars: Array.from(line).map((ch) => ({ ch, i: n++ })),
    }));
  }, []);

  useEffect(() => {
    if (stillMode()) { setPhase(4); return; }
    setPhase(0);
    const timers = [
      window.setTimeout(() => setPhase(1), SWEEP_AT),
      window.setTimeout(() => setPhase(2), SWEEP_AT + SWEEP_DUR),
      window.setTimeout(() => setPhase(3), TEXT_AT),
      window.setTimeout(() => setPhase(4), CTA_AT),
    ];
    return () => timers.forEach(clearTimeout);
  }, [run]);

  useEffect(() => () => {
    if (handoffRef.current !== null) clearTimeout(handoffRef.current);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  // 类名移除→添加会让 CSS 动画从头播放，比重新挂载图片更稳（不会闪白）
  function replay(nextSrc: string) {
    if (!stillMode()) setPhase(0);
    setSrc(nextSrc);
    setRun((r) => r + 1);
  }

  function enterStudio(to: string) {
    if (handoffRef.current !== null) clearTimeout(handoffRef.current);
    if (stillMode()) { navigate(to); return; }
    handoffRef.current = window.setTimeout(() => navigate(to), HANDOFF_AT);
  }

  function pickImage(file: File | null) {
    if (!file) return;
    const mime = (file.type || '').split(';')[0].trim().toLowerCase();
    if (!OK_TYPES.includes(mime)) { toast.error('仅支持 JPG / PNG / WebP 图片'); return; }
    if (file.size > 15 * 1024 * 1024) { toast.error('图片超过 15MB 上限'); return; }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(file);
    setPendingFile(file);
    replay(objectUrlRef.current);
    enterStudio('/studio');
  }

  function playSample() {
    setPendingFile(null);
    replay(SAMPLE);
    enterStudio('/studio?demo=night');
  }

  // 只写自定义属性、且读矩形先于写，不会触发强制重排；每帧重新取矩形，滚动后光轨仍跟手
  function onMove(e: React.MouseEvent) {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--tp-px', `${e.clientX - rect.left}px`);
    el.style.setProperty('--tp-py', `${e.clientY - rect.top}px`);
  }

  const charSpan = (ch: string, i: number) => (
    <span
      key={i}
      className={cn('inline-block', phase >= 3 ? 'tp-char' : 'opacity-0')}
      style={{ '--i': i } as React.CSSProperties}
    >
      {ch}
    </span>
  );

  return (
    <div
      ref={frameRef}
      className={cn(
        'relative isolate -mt-14 min-h-dvh w-full overflow-hidden bg-secondary',
        phase >= 1 && 'tp-run',
      )}
      data-paused={hovering}
      style={{ '--tp-dur': `${SWEEP_DUR}ms` } as React.CSSProperties}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onMouseMove={onMove}
    >
      {/* 下层：铺满整屏的平淡偏暗废片 */}
      <div className="absolute inset-0">
        <img src={src} alt="待优化的日常照片" className="tp-dim size-full object-cover" draggable={false} />
        <div className="tp-haze absolute inset-0" />
      </div>
      {/* 上层：精致成片，clip-path 跟着光带露出 */}
      <div className="tp-reveal pointer-events-none absolute inset-0">
        <img src={src} alt="优化后的成片" className="tp-gloss size-full object-cover" draggable={false} />
      </div>
      <div className="tp-band pointer-events-none absolute inset-0 mix-blend-screen" />
      <div
        className="tp-trail pointer-events-none absolute left-0 top-0 mix-blend-screen transition-opacity duration-500"
        style={{ opacity: hovering ? 1 : 0 }}
      />
      {phase >= 2 && <div className="tp-breathe pointer-events-none absolute inset-0" />}
      {/* 压暗层随文字一起淡入，转场过程中保持画面本色 */}
      <div className="tp-scrim pointer-events-none absolute inset-0" style={{ opacity: phase >= 2 ? 1 : 0 }} />

      <div className="tp-ink relative z-10 flex min-h-dvh flex-col items-center px-4 pt-20 pb-8 text-center text-white">
        <div className="flex flex-1 items-center justify-center">
          <h1
            className="flex flex-col items-center gap-4 leading-relaxed tracking-tight"
            aria-label={`图派。${SLOGAN[0]}。${SLOGAN[1]}。`}
          >
            <span className="flex items-center gap-3">
              <span className={cn('grid size-11 place-items-center rounded-xl bg-primary text-xl font-bold text-primary-foreground', phase >= 3 ? 'tp-rise' : 'opacity-0')}>
                派
              </span>
              <span className="text-4xl font-bold sm:text-6xl">{lines[0].chars.map(({ ch, i }) => charSpan(ch, i))}</span>
            </span>
            <span className="flex flex-col gap-1 text-lg font-semibold sm:text-2xl">
              {lines.slice(1).map((line, li) => (
                <span key={li} className="block">
                  {line.chars.map(({ ch, i }) => charSpan(ch, i))}
                </span>
              ))}
            </span>
          </h1>
        </div>

        <div className={cn('w-full max-w-md', phase >= 4 ? 'tp-rise' : 'opacity-0')}>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pickImage(f || null); }}
          />
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" onClick={() => fileRef.current?.click()}>上传照片试试</Button>
            <Button size="lg" variant="outline" className="text-foreground" onClick={playSample}>一键试玩 · 样例废片</Button>
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/studio?demo=text&text=${encodeURIComponent(text.trim() || DEMO_TEXT)}`);
            }}
          >
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={DEMO_TEXT}
              aria-label="一句话描述想要的照片"
              className="bg-background text-foreground placeholder:text-muted-foreground"
            />
            <Button type="submit" variant="secondary" className="shrink-0">文字试玩</Button>
          </form>
          <div className="mt-2">
            <Button variant="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={() => navigate('/studio')}>
              开始创作
            </Button>
          </div>
          <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-white/75">
            <li>✓ 游客免登录全流程</li>
            <li>✓ 原图全程私密，不公开</li>
            <li>✓ 结果带 AI 生成标识</li>
            <li>✓ 配方导出 JSON + SKILL.md</li>
          </ul>
          <p className="mt-2 text-[11px] text-white/55">转场为演示示意（画面调色模拟）· 真实出图在创作台</p>
        </div>
      </div>

      <span className="absolute left-3 top-16 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/90">原图</span>
      <span className={cn('absolute right-3 top-16 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/90 transition-opacity duration-1000', phase >= 2 ? 'opacity-100' : 'opacity-0')}>
        AI 成片 · 示意
      </span>
    </div>
  );
}
