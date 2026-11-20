import { useEffect, useState } from 'react';
import { api, loginUrl, ApiRequestError } from '@/lib/api';
import { saveLoginIntent, takeLoginIntent, peekLoginIntent } from '@/lib/login-intent';
import type { WorkMeta } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

export function PublishDialog({ open, onOpenChange, resultAssetId, snapshot, parentWorkId, onPublished }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resultAssetId: string;
  snapshot: { prompt: string; negative_prompt?: string; model: string; ratio: string };
  parentWorkId?: string;
  onPublished?: (w: WorkMeta) => void;
}) {
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [allowFork, setAllowFork] = useState(true);
  const [busy, setBusy] = useState(false);

  // 登录回程：恢复 401 前未发布的标题与标签（仅消费发布类草稿，避免吞掉评论/举报）
  useEffect(() => {
    if (!open) return;
    if (peekLoginIntent()?.kind !== 'publish') return;
    const intent = takeLoginIntent();
    if (intent?.kind !== 'publish') return;
    setTitle(intent.title);
    setTags(intent.tags);
    toast.success('已恢复上次未发布的草稿');
  }, [open]);

  async function submit() {
    if (!title.trim()) { toast.error('请给作品起个标题'); return; }
    setBusy(true);
    try {
      const r = await api.publishWork({
        result_asset_id: resultAssetId,
        title: title.trim(),
        tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 12),
        allow_fork: allowFork,
        parent_work_id: parentWorkId,
        skill_snapshot: snapshot,
      });
      toast.success('已发布到社区');
      onOpenChange(false); setTitle(''); setTags('');
      onPublished?.(r.work);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        saveLoginIntent({ kind: 'publish', title: title.trim(), tags });
        toast.error('发布需要先登录');
        window.location.href = loginUrl();
        return;
      }
      toast.error(e instanceof Error ? e.message : '发布失败');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{parentWorkId ? '发布 fork 作品到社区' : '发布作品到社区'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">只公开这张生成作品与配方，原图不公开。发布前进行自动审核；模型不可用时会降级为规则检查。</p>
          <div>
            <Label htmlFor="pub-title" className="text-xs">标题</Label>
            <Input id="pub-title" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 100))} placeholder="例如：雨夜霓虹·我的聚餐照" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="pub-tags" className="text-xs">标签（逗号分隔，可选）</Label>
            <Input id="pub-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="夜景,人像,提亮" className="mt-1" />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={allowFork} onChange={(e) => setAllowFork(e.target.checked)} />
            允许他人 fork（套用配方再创作）
          </label>
          <Button className="w-full" disabled={busy} onClick={() => void submit()}>{busy ? '审核发布中…' : '发布'}</Button>
        </div>
        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}
