/**
 * 分区标题（纯展示组件，零业务逻辑）
 * 复用 globals.css 已有的 site-section-heading 设计类。
 */
export function SectionHeading({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="site-section-heading mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="font-display text-lg font-bold tracking-tight text-foreground sm:text-xl">
        {title}
      </h2>
      {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      {children}
    </div>
  );
}

export default SectionHeading;
