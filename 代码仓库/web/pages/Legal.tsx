import { Card } from '@/components/ui/card';

export default function Legal() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">隐私与 AI 说明</h1>
      <p className="mt-2 text-sm text-muted-foreground">图派 TuPai · 简版说明 · 2026-11-17</p>
      <div className="mt-6 space-y-4 text-sm leading-6">
        <Card className="p-5">
          <h2 className="font-semibold">原图全程私密</h2>
          <p className="mt-2 text-muted-foreground">
            你上传的原图默认私有，仅你自己的会话可访问；分析原图时以加密通道内的 base64 直传 AI 服务，
            不在本站公开、不进入公开画廊、不用于展示。生成结果图同样默认私有，下载不需要公开原图。
          </p>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">AI 生成标识</h2>
          <p className="mt-2 text-muted-foreground">
            所有结果图均为 AI 生成或 AI 二次创作。页面展示带「AI 生成」角标，下载的图片会合成可见标识。
            发布到社交平台时，请遵守该平台关于 AI 生成内容的标注要求。
          </p>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">数据与配额</h2>
          <p className="mt-2 text-muted-foreground">
            游客身份由浏览器本地随机会话标识维持，不收集账号与个人身份信息。为防止滥用，
            每会话每日生成次数有限额。会话标识清除后，此前的私有资产将无法再访问。
          </p>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">第三方服务与开源致谢</h2>
          <p className="mt-2 text-muted-foreground">
            出图与视觉理解使用 Agnes 免费模型（agnes-image-2.5-flash / 2.1-flash / 3.0-flash）。
            模板视觉语法参考 open-image-prompts 风格卡（代码 MIT，元数据 CC-BY-4.0；提示词全部为图派原创重写，未搬运第三方源提示词与图片）。
            测试底图来自 Unsplash/Pexels 等公开授权图片。二期画册将复用 MIT 开源项目 create-photo-flipbook-ui。
          </p>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">能力边界</h2>
          <p className="mt-2 text-muted-foreground">
            图派走「改环境不改主体」路线：优化光线、背景与风格，保留人物脸部、表情与服装。
            不做证件照级保真承诺，不做瘦脸瘦身。优化是灵感参考而非像素级复刻；不满意可再生成或换一条候选。
          </p>
        </Card>
      </div>
    </div>
  );
}