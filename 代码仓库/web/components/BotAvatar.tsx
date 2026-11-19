import type { CSSProperties } from 'react';

/**
 * Grok 风拟人 Bot 头像：软胶 blob 球 + 一对白色竖杠眼睛。
 * - 13 款柔化造型，单色填充；眼睛为两条白色圆角短杠（无瞳孔、无字母）。
 * - 干活（busy）时双杠轻微扫视；待命偶尔眨眼；鼠标悬浮时眨眼并打量。
 * - image 存在时按上传 / 文生头像渲染，不再绘制造型与眼睛。
 */

export type AvatarSpec = {
  /** 预设造型 0–12 */
  variant: number;
  /** 造型主色 */
  color: string;
  /** 上传 / 文生头像 URL，存在即覆盖造型 */
  image?: string | null;
};

export const AVATAR_SHAPE_COUNT = 13;

/** 预设可选色板（与杂志风角色色对齐） */
export const AVATAR_PALETTE = [
  '#1C1917', '#8A5A34', '#E0342B', '#EA580C', '#D9A93F', '#2F7D5B',
  '#2FA89A', '#2F6FA8', '#6A4A96', '#D6487E', '#8C7D6C', '#B4502A',
];

/* ------------------------------- 13 款柔化 blob ------------------------------- */

function ShapeBody({ variant, color }: { variant: number; color: string }) {
  const fill = color;
  switch (variant % AVATAR_SHAPE_COUNT) {
    case 0: // 正圆
      return <circle cx="50" cy="50" r="38" fill={fill} />;
    case 1: // 软方块
      return <rect x="17" y="17" width="66" height="66" rx="28" fill={fill} />;
    case 2: // 云团
      return (
        <path
          d="M32 74 a17 17 0 0 1 -3-33 20 20 0 0 1 38-7 16 16 0 0 1 21 15 14 14 0 0 1 -9 25 Z"
          fill={fill}
        />
      );
    case 3: // 四瓣花
      return (
        <g fill={fill}>
          <circle cx="50" cy="33" r="17" />
          <circle cx="67" cy="50" r="17" />
          <circle cx="50" cy="67" r="17" />
          <circle cx="33" cy="50" r="17" />
        </g>
      );
    case 4: // 三瓣花
      return (
        <g fill={fill}>
          <circle cx="50" cy="34" r="17" />
          <circle cx="35" cy="63" r="17" />
          <circle cx="65" cy="63" r="17" />
        </g>
      );
    case 5: // 心形
      return <path d="M50 80 C20 58 14 37 26 26 C36 18 48 24 50 34 C52 24 64 18 74 26 C86 37 80 58 50 80 Z" fill={fill} />;
    case 6: // 水滴
      return <path d="M50 14 C70 40 78 54 78 66 A28 28 0 0 1 22 66 C22 54 30 40 50 14 Z" fill={fill} />;
    case 7: // 横胶囊
      return <rect x="19" y="35" width="62" height="30" rx="15" fill={fill} />;
    case 8: // 软三角
      return <path d="M50 18 C56 18 58 22 61 28 L83 74 C86 80 82 84 75 84 H25 C18 84 14 80 17 74 L39 28 C42 22 44 18 50 18 Z" fill={fill} />;
    case 9: // 菱形
      return <polygon points="50,16 82,50 50,84 18,50" fill={fill} />;
    case 10: // 爆炸星
      return <polygon points="50,12 58,34 80,26 66,46 88,54 66,62 76,84 54,70 50,90 46,70 24,84 34,62 12,54 34,46 20,26 42,34" fill={fill} />;
    case 11: // 五瓣花
      return (
        <g fill={fill}>
          <circle cx="50" cy="30" r="15" />
          <circle cx="69" cy="45" r="15" />
          <circle cx="62" cy="69" r="15" />
          <circle cx="38" cy="69" r="15" />
          <circle cx="31" cy="45" r="15" />
        </g>
      );
    case 12: // 盾牌
      return <path d="M50 14 L82 26 V52 C82 72 68 84 50 90 C32 84 18 72 18 52 V26 Z" fill={fill} />;
    default:
      return <circle cx="50" cy="50" r="38" fill={fill} />;
  }
}

/* --------------------------------- 双杠眼睛 --------------------------------- */

function DashEyes() {
  const eyes = [
    { cx: 38, rot: -8 },
    { cx: 62, rot: 8 },
  ];
  return (
    <g className="bot-eyes">
      {eyes.map((e, i) => (
        <g key={i} transform={`translate(${e.cx} 44)`}>
          <g className="bot-eye">
            <ellipse rx="2.6" ry="6" fill="#FFFFFF" transform={`rotate(${e.rot})`} />
          </g>
        </g>
      ))}
    </g>
  );
}

/* --------------------------------- 组件 --------------------------------- */

export type BotAvatarMotion = 'idle' | 'busy';

export function BotAvatar({
  spec,
  size = 34,
  motion = 'idle',
  className,
  style,
}: {
  spec: AvatarSpec;
  size?: number;
  motion?: BotAvatarMotion;
  className?: string;
  style?: CSSProperties;
}) {
  if (spec.image) {
    return (
      <img
        src={spec.image}
        alt="Bot 头像"
        width={size}
        height={size}
        className={`bot-avatar-img ${className ?? ''}`}
        style={{ objectFit: 'cover', borderRadius: '9999px', ...style }}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`bot-avatar ${className ?? ''}`}
      data-motion={motion}
      style={style}
      role="img"
      aria-label="Bot 头像"
    >
      <ShapeBody variant={spec.variant} color={spec.color} />
      <DashEyes />
    </svg>
  );
}
