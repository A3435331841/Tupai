import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * 首页左侧内容区（Hero 文案与入口）——按 V4「杂志留白」设计稿定稿实现。
 * 本次调整（相对设计稿 v3）：
 *   1) 删除顶部文案「V4 · 杂志留白」；
 *   2) 将「AI 影像风格重塑」移到该行最左侧。
 * 其余文字、元素层级、间距与对齐均保持设计稿原样。
 * 右侧 HomeCompare 与首页其他区块不在本组件内，未改动。
 */
export default function HeroIntro({ navigate }: { navigate: (to: string) => void }) {
  return (
    <div>
      {/* Kicker：仅保留「AI 影像风格重塑」，左对齐，后接细线 */}
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-bold tracking-[0.16em] text-[#a84420]">AI 影像风格重塑</span>
        <span className="h-px w-12 bg-[#d8c8b6]" aria-hidden="true" />
      </div>

      {/* 主标题：两行，第二行橙棕强调 */}
      <h1 className="mt-4 text-[2.6rem] font-bold leading-[1.1] tracking-tight sm:mt-6 sm:text-[4.25rem]">
        让每张日常，<br />
        <span className="text-primary">都值得被收藏。</span>
      </h1>

      {/* 正文：「图派」橙棕强调 */}
      <p className="mt-4 text-[14px] leading-6 text-muted-foreground sm:mt-6 sm:text-[15px] sm:leading-7">
        随手拍的日常，交给<span className="font-semibold text-primary">图派</span>就好。
      </p>

      {/* 入口：黑色胶囊主按钮 + 文字链次入口 */}
      <div className="mt-5 flex flex-wrap items-center gap-5 sm:mt-8 sm:gap-6">
        <Button
          size="lg"
          onClick={() => navigate('/studio')}
          className="home-hero-primary h-12 gap-2 rounded-full px-6 text-[15px] font-semibold"
        >
          开始创作 <ArrowRight className="size-4" />
        </Button>
        <button
          type="button"
          onClick={() => navigate('/studio?demo=night&template=night-bright')}
          className="text-[13px] text-[#7a6a58] underline decoration-[#c9b9a6] underline-offset-4 transition-colors hover:text-primary"
        >
          夜景提亮 · 一键试玩
        </button>
      </div>
    </div>
  );
}
