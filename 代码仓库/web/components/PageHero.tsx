/**
 * 页面引导区（纯展示组件，零业务逻辑）
 * 复用 globals.css 已有的 site-hero / site-kicker / font-display 设计类。
 * 供资产库、社区等页面统一使用，与首页 Hero 保持同一视觉语言。
 */
export function PageHero({
  kicker,
  title,
  description,
  aside,
  children,
  compact = false,
}: {
  kicker: string;
  title: string;
  description?: string;
  aside?: React.ReactNode;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <section
      className={
        'site-hero relative mb-6 overflow-hidden rounded-2xl px-5 py-6 sm:px-8 sm:py-8 ' +
        (compact ? '' : 'lg:px-10 lg:py-10')
      }
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="site-kicker mb-3">{kicker}</p>
          <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-3xl lg:text-4xl">
            {title}
          </h1>
          {description && (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {description}
            </p>
          )}
        </div>
        {aside && <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div>}
      </div>
      {children && <div className="mt-6">{children}</div>}
    </section>
  );
}

export default PageHero;
