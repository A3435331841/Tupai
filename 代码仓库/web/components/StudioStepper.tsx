/**
 * 创作台步骤条（纯展示组件，零业务逻辑）
 * 由 Studio 的 stage 派生高亮，不持有第二套状态源。
 * 设计稿四步：放入照片 → 理解画面 → 选择方向 → 生成作品
 *
 * Stage 联合类型与 Studio.tsx 的 Stage 保持一致（此处独立声明以避免循环依赖）。
 */
export type StepStage = 'entry' | 'optimizing' | 'ready' | 'generating' | 'result';
export type StepKey = 'input' | 'understand' | 'direction' | 'generate';

const STEPS: { key: StepKey; label: string; stages: StepStage[] }[] = [
  { key: 'input', label: '放入照片', stages: ['entry'] },
  { key: 'understand', label: '理解画面', stages: ['optimizing'] },
  { key: 'direction', label: '选择方向', stages: ['ready'] },
  { key: 'generate', label: '生成作品', stages: ['generating', 'result'] },
];

function indexOfStage(stage: StepStage): number {
  const i = STEPS.findIndex((s) => s.stages.includes(stage));
  return i < 0 ? 0 : i;
}

export function StudioStepper({ stage, onJump }: { stage: StepStage; onJump?: (s: StepStage) => void }) {
  const current = indexOfStage(stage);
  return (
    <ol className="mb-5 flex w-full items-center gap-1 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 sm:gap-2 sm:px-4">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const clickable = done && Boolean(onJump);
        return (
          <li key={step.key} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onJump?.(step.stages[0])}
              aria-current={active ? 'step' : undefined}
              className={
                'flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-xs transition-colors sm:gap-2 sm:px-2 sm:text-sm ' +
                (active
                  ? 'font-semibold text-primary'
                  : done
                    ? 'text-foreground/80 hover:bg-secondary/60'
                    : 'text-muted-foreground/60') +
                (clickable ? ' cursor-pointer' : ' cursor-default')
              }
            >
              <span
                className={
                  'grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold sm:size-7 ' +
                  (active
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : done
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground')
                }
              >
                {done ? '✓' : i + 1}
              </span>
              <span className="truncate">{step.label}</span>
            </button>
            {i < STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className={'hidden h-px min-w-3 flex-1 sm:block ' + (i < current ? 'bg-primary/40' : 'bg-border')}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default StudioStepper;
