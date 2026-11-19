import { useState } from 'react';
import { ArrowRight, ImageUp, Sparkles, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * 第三屏「创作流程」（定稿：C · 磁悬浮卡）。
 * 真实链路：01 上传废片(hero-street-raw) → 02 选风格(胶片/夜景/杂志三张真实封面) → 03 得成品(hero-street，同场景强对比)。
 * 交互：卡片入场浮起；悬停时 3D 倾斜 + 暖色光晕跟随，指针位置驱动光点。
 */

/** 真实案例素材：同场景废片 → 成品 + 三种真实风格封面 */
const CASE = {
  raw: '/home/hero-street-raw.webp',
  result: '/home/hero-street.webp',
  styles: [
    { src: '/templates/film-daily.webp', label: '胶片' },
    { src: '/templates/night-bright.webp', label: '夜景' },
    { src: '/templates/magazine-cover.webp', label: '杂志' },
  ],
};

const STEPS = [
  { no: '01', title: '上传照片', desc: '只上传你要改的那一张，其余留在本地', Icon: ImageUp },
  { no: '02', title: '选择灵感', desc: '胶片、夜景、人像，挑一个方向', Icon: Sparkles },
  { no: '03', title: '收获作品', desc: '生成后继续微调，原图始终不公开', Icon: WandSparkles },
] as const;

/** 每一步的真实案例缩略图 */
function StepMedia({ step }: { step: number }) {
  if (step === 0) {
    return (
      <div className="relative h-20 w-full overflow-hidden rounded-lg border border-border/60 bg-secondary sm:h-28">
        <img src={CASE.raw} alt="上传的废片原图（真实案例）" className="size-full object-cover object-center" draggable={false} />
        <span className="absolute left-1.5 top-1.5 rounded bg-stone-950/65 px-1.5 py-0.5 text-[9px] font-semibold text-white/90">原图</span>
      </div>
    );
  }
  if (step === 1) {
    return (
      <div className="flex h-20 gap-1.5 sm:h-28">
        {CASE.styles.map((s, idx) => (
          <div key={s.label} className={`relative min-w-0 flex-1 overflow-hidden rounded-lg border bg-secondary ${idx === 0 ? 'border-primary/60 ring-1 ring-primary/30' : 'border-border/60'}`}>
            <img src={s.src} alt={`${s.label}风格示例（真实案例）`} className="size-full object-cover object-center" draggable={false} />
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-3 text-center text-[9px] font-medium text-white">{s.label}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="relative h-20 w-full overflow-hidden rounded-lg border border-primary/30 bg-secondary sm:h-28">
      <img src={CASE.result} alt="AI 生成的作品（真实案例）" className="size-full object-cover object-center" draggable={false} />
      <span className="absolute left-1.5 top-1.5 rounded bg-primary/85 px-1.5 py-0.5 text-[9px] font-semibold text-white">作品</span>
    </div>
  );
}

export default function WorkFlow({ navigate }: { navigate: (to: string) => void }) {
  const [tilt, setTilt] = useState<number | null>(null);

  return (
    <div className="workflow-root">
      <div className="snap-reveal text-center">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-primary">HOW IT WORKS</p>
        <h2 className="mt-2 font-display text-[1.75rem] sm:mt-3 sm:text-[2.6rem]">三步，把随手拍变成作品。</h2>
      </div>

      <div className="flow-c mx-auto mt-7 grid max-w-4xl grid-cols-1 gap-3 sm:mt-9 sm:grid-cols-3 sm:gap-5">
        {STEPS.map(({ no, title, desc, Icon }, i) => (
          <div
            key={no}
            className="flow-c-step group relative min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card/70 p-3 transition-transform duration-300 sm:p-4"
            style={{ transitionDelay: `${i * 120}ms`, transform: tilt === i ? 'perspective(800px) rotateY(-6deg) rotateX(3deg) translateY(-6px)' : undefined }}
            onMouseMove={(e) => { if (tilt === i) e.currentTarget.style.setProperty('--mx', `${e.nativeEvent.offsetX}px`); }}
            onMouseEnter={() => setTilt(i)}
            onMouseLeave={() => setTilt(null)}
          >
            <span className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-primary/10 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
            <StepMedia step={i} />
            <div className="mt-3 flex items-center justify-between">
              <Icon className="relative size-6 text-primary" strokeWidth={1.5} />
              <span className="font-display text-2xl font-bold text-foreground/85">{no}</span>
            </div>
            <h3 className="mt-1 text-base font-semibold sm:text-lg">{title}</h3>
            <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground sm:text-[13px] sm:leading-6">{desc}</p>
          </div>
        ))}
      </div>

      <div className="snap-reveal mt-5 flex justify-center pb-8 sm:mt-7 sm:pb-0">
        <Button size="lg" onClick={() => navigate('/studio')} className="shadow-[0_8px_22px_-10px_rgba(192,86,47,0.75)]">
          开始创作 <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
