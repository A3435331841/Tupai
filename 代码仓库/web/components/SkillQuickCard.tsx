import { api, downloadText } from '@/lib/api';
import type { SkillRecord } from '@/lib/types';
import { Button } from '@/components/ui/button';

/**
 * 资产库右侧「我的配方」快捷卡（纯展示 + 复用已有导出 API）
 * 不改配方数据契约；JSON / SKILL.md 导出沿用 Studio 既有逻辑。
 */
export function SkillQuickCard({
  skills,
  loading,
  onUse,
  onError,
}: {
  skills: SkillRecord[];
  loading?: boolean;
  onUse?: (skill: SkillRecord) => void;
  onError?: (e: unknown) => void;
}) {
  async function exportMd(skill: SkillRecord) {
    try {
      const text = await api.skillMd(skill.skill_id);
      downloadText(text, `${(skill.title || '配方').replace(/[\\/:*?"<>|]/g, '_')}.SKILL.md`, 'text/markdown');
    } catch (e) {
      onError?.(e);
    }
  }

  function exportJson(skill: SkillRecord) {
    const { skill_id: _id, ...rest } = skill;
    downloadText(JSON.stringify(rest, null, 2), `${(skill.title || '配方').replace(/[\\/:*?"<>|]/g, '_')}.json`, 'application/json');
  }

  return (
    <section className="site-flow-card rounded-2xl p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold text-foreground">我的配方</h3>
        <span className="text-[11px] text-muted-foreground">{skills.length} 套</span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-secondary/60" />)}
        </div>
      ) : skills.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
          还没有保存的配方。在创作台出片后点「存为配方」即可复用。
        </p>
      ) : (
        <ul className="space-y-2">
          {skills.slice(0, 8).map((skill) => (
            <li key={skill.skill_id} className="rounded-lg border border-border/70 bg-background/50 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-medium text-foreground" title={skill.title}>{skill.title}</p>
                <span className="shrink-0 text-[10px] text-muted-foreground">{skill.params?.aspect || '3:4'}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                {skill.notes || skill.prompt}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {onUse && (
                  <Button size="sm" variant="secondary" className="h-7 px-2 text-[11px]" onClick={() => onUse(skill)}>
                    复用
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => exportJson(skill)}>
                  {'{ }'} JSON
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void exportMd(skill)}>
                  SKILL.md
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default SkillQuickCard;
