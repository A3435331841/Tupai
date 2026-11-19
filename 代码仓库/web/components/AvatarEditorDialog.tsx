import { useEffect, useRef, useState } from 'react';
import { BotAvatar, AVATAR_PALETTE, AVATAR_SHAPE_COUNT } from './BotAvatar';
import type { AvatarSpec } from './BotAvatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

/**
 * Bot 头像编辑弹层：预设造型 / 颜色 / 字母，文生成像（一步到位，本地 mock，预留后端接口位），本地上传。
 * 主脑形象默认锁定为图派标志拟人脸，仅可通过生成 / 上传覆盖，或一键重置回标志。
 */

type Tab = 'preset' | 'generate' | 'upload';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function hashSeed(seed: string): number {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function mockAvatar(seed: string): { variant: number; color: string } {
  const h = hashSeed(seed || 'tupai');
  return {
    variant: h % AVATAR_SHAPE_COUNT,
    color: AVATAR_PALETTE[h % AVATAR_PALETTE.length],
  };
}

export function AvatarEditorDialog({
  open,
  botName,
  spec,
  defaultSpec,
  onClose,
  onApply,
}: {
  open: boolean;
  botName: string;
  spec: AvatarSpec;
  defaultSpec: AvatarSpec;
  onClose: () => void;
  onApply: (next: AvatarSpec) => void;
}) {
  const [tab, setTab] = useState<Tab>('preset');
  const [draft, setDraft] = useState<AvatarSpec>(spec);
  const [genText, setGenText] = useState('');
  const [generating, setGenerating] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(spec);
      setTab(spec.kind === 'logo' ? 'generate' : 'preset');
      setGenText('');
      setGenerating(false);
    }
  }, [open, spec]);

  const isLogo = draft.kind === 'logo';

  function reset() {
    setDraft({ ...defaultSpec, image: null });
  }

  function pickUpload(f: File | null) {
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
      toast.error('仅支持 JPG / PNG / WebP 图片');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast.error('图片超过 5MB 上限');
      return;
    }
    const url = URL.createObjectURL(f);
    setDraft((old) => {
      if (old.image) URL.revokeObjectURL(old.image);
      return { ...old, image: url };
    });
  }

  async function generateAvatar() {
    setGenerating(true);
    // 预留后端文生接口位：真实环境在此调用文生能力并回传图片 URL。
    // 当前本地 mock：按描述种子挑一个造型与配色，一步出形象，不跳多步。
    await new Promise((r) => setTimeout(r, 600));
    const picked = mockAvatar(genText || `${botName} 形象`);
    setDraft((old) => ({
      ...old,
      kind: 'letter',
      variant: picked.variant,
      color: picked.color,
      image: null,
    }));
    setGenerating(false);
    toast.success('已按描述生成一个形象，满意就确定');
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑 {botName} 的头像</DialogTitle>
        </DialogHeader>

        {/* 预览 */}
        <div className="flex flex-col items-center gap-2 py-2">
          <BotAvatar spec={draft} size={84} motion={generating ? 'busy' : 'idle'} />
          <span className="text-[11px] text-muted-foreground">
            {isLogo ? '图派标志拟人脸 · 可生成或上传自定义形象' : '选中形象后点确定生效'}
          </span>
        </div>

        {/* Tab */}
        <div className="flex items-center gap-1 rounded-full bg-[#F1E7D9] p-1 text-[13px]">
          {([['preset', '预设'], ['generate', '生成'], ['upload', '上传']] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-full px-3 py-1.5 transition-colors ${tab === t ? 'bg-white font-semibold text-[#1F1A17] shadow-sm' : 'text-[#7A6C60]'}`}
            >
              {label}
            </button>
          ))}
          <button type="button" onClick={reset} className="px-3 text-[12px] text-[#8C7D6C] hover:text-[#B4502A]">重置</button>
        </div>

        {tab === 'preset' && (
          <div className="space-y-4">
            {isLogo ? (
              <p className="py-3 text-center text-[12px] text-muted-foreground">主脑形象由标志固定，可在「生成 / 上传」中替换。</p>
            ) : (
              <>
                <div>
                  <Label className="text-xs">造型（13 款）</Label>
                  <div className="mt-2 grid grid-cols-5 gap-2">
                    {Array.from({ length: AVATAR_SHAPE_COUNT }, (_, v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, variant: v, image: null }))}
                        className={`grid place-items-center rounded-xl border p-1 transition-colors ${draft.variant === v ? 'border-[#B4502A] bg-[#FBF4EC] ring-1 ring-[#B4502A]/30' : 'border-[#EADCC8] hover:bg-[#F6ECDF]'}`}
                        aria-label={`造型 ${v + 1}`}
                      >
                        <BotAvatar spec={{ ...draft, variant: v }} size={34} />
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">颜色</Label>
                  <div className="mt-2 flex flex-wrap gap-2.5">
                    {AVATAR_PALETTE.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, color: c, image: null }))}
                        className={`size-7 rounded-full transition-transform ${draft.color === c ? 'ring-2 ring-[#1F1A17] ring-offset-2' : 'hover:scale-110'}`}
                        style={{ background: c }}
                        aria-label={`颜色 ${c}`}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <Label htmlFor="avatar-letter" className="text-xs">字母标识（A–Z）</Label>
                  <Input
                    id="avatar-letter"
                    value={draft.letter}
                    maxLength={1}
                    onChange={(e) => setDraft((d) => ({ ...d, letter: (e.target.value || 'A').toUpperCase().replace(/[^A-Z]/g, '') }))}
                    className="mt-1 h-9 w-20 text-center text-base font-bold"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'generate' && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="avatar-gen" className="text-xs">用一句话描述形象（性格 / 颜色 / 气质）</Label>
              <Input
                id="avatar-gen"
                value={genText}
                onChange={(e) => setGenText(e.target.value.slice(0, 80))}
                placeholder={`例如：${botName}，机灵、暖橙色、圆滚滚`}
                className="mt-1"
              />
            </div>
            <Button className="w-full" disabled={generating} onClick={() => void generateAvatar()}>
              {generating ? '生成中…' : '一步生成头像'}
            </Button>
            <p className="text-[11px] leading-5 text-muted-foreground">
              生成结果会替换当前形象；真实文生能力接入后将直接出图。
            </p>
          </div>
        )}

        {tab === 'upload' && (
          <div className="space-y-3">
            <input
              ref={uploadRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => { pickUpload(e.target.files?.[0] ?? null); e.target.value = ''; }}
            />
            <Button variant="outline" className="w-full" onClick={() => uploadRef.current?.click()}>
              选择本地图片
            </Button>
            {draft.image ? (
              <p className="text-center text-[11px] text-muted-foreground">已选用本地图片，确定后生效（仅本会话保留）</p>
            ) : (
              <p className="text-center text-[11px] text-muted-foreground">方形头像效果最佳，支持 JPG / PNG / WebP，≤5MB</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button className="se-btn-dark" onClick={() => { onApply(draft); onClose(); }}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
