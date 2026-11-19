import type { CSSProperties } from 'react';

/**
 * 拟人化 Bot 头像（创作台多 Bot 编排台专用）。
 * - 主脑（kind=logo）：复用图派 P/T 咬合标志作脸，叠加一对小眼睛。
 * - 其他 Bot（kind=letter）：13 种预设造型之一 + A–Z 字母 + 一对小眼睛。
 * - 眼睛动效：干活（busy）时瞳孔四处扫视；待命偶尔眨眼；鼠标悬浮时眨眼并轻微打量。
 * - image 存在时按上传 / 文生头像渲染，不再绘制造型与眼睛。
 */

export type AvatarSpec = {
  kind: 'logo' | 'letter';
  /** 预设造型 0–12 */
  variant: number;
  /** 造型主色 */
  color: string;
  /** 字母标识（A–Z），letter 造型使用 */
  letter: string;
  /** 上传 / 文生头像 URL，存在即覆盖造型 */
  image?: string | null;
};

export const AVATAR_SHAPE_COUNT = 13;

/** 预设可选色板（与杂志风角色色对齐） */
export const AVATAR_PALETTE = [
  '#1C1917', '#8A5A34', '#E0342B', '#EA580C', '#D9A93F', '#2F7D5B',
  '#2FA89A', '#2F6FA8', '#6A4A96', '#D6487E', '#8C7D6C', '#B4502A',
];

/* ------------------------------- 13 种造型 ------------------------------- */

function ShapeBody({ variant, color }: { variant: number; color: string }) {
  const fill = color;
  switch (variant % AVATAR_SHAPE_COUNT) {
    case 0: // 圆
      return <circle cx="50" cy="50" r="38" fill={fill} />;
    case 1: // 圆角方块
      return <rect x="15" y="15" width="70" height="70" rx="24" fill={fill} />;
    case 2: // 三角
      return <polygon points="50,18 86,80 14,80" fill={fill} />;
    case 3: // 菱形
      return <polygon points="50,14 84,50 50,86 16,50" fill={fill} />;
    case 4: // 五角星
      return <polygon points="50,14 61,38 87,40 67,57 74,83 50,69 26,83 33,57 13,40 39,38" fill={fill} />;
    case 5: // 水滴
      return <path d="M50 14 C70 40 78 54 78 66 A28 28 0 0 1 22 66 C22 54 30 40 50 14 Z" fill={fill} />;
    case 6: // 云朵
      return <path d="M31 73 a17 17 0 0 1 -3-33 20 20 0 0 1 38-7 16 16 0 0 1 21 15 14 14 0 0 1 -9 25 Z" fill={fill} />;
    case 7: // 心形
      return <path d="M50 80 C20 58 14 37 26 26 C36 18 48 24 50 34 C52 24 64 18 74 26 C86 37 80 58 50 80 Z" fill={fill} />;
    case 8: // 六边形
      return <polygon points="50,14 82,32 82,68 50,86 18,68 18,32" fill={fill} />;
    case 9: // 高圆角方块
      return <rect x="18" y="18" width="64" height="64" rx="32" fill={fill} />;
    case 10: // 爆炸星
      return <polygon points="50,12 58,34 80,26 66,46 88,54 66,62 76,84 54,70 50,90 46,70 24,84 34,62 12,54 34,46 20,26 42,34" fill={fill} />;
    case 11: // 花瓣
      return (
        <g fill={fill}>
          <circle cx="50" cy="30" r="16" />
          <circle cx="70" cy="45" r="16" />
          <circle cx="62" cy="70" r="16" />
          <circle cx="38" cy="70" r="16" />
          <circle cx="30" cy="45" r="16" />
        </g>
      );
    case 12: // 盾牌
      return <path d="M50 14 L82 26 V52 C82 72 68 84 50 90 C32 84 18 72 18 52 V26 Z" fill={fill} />;
    default:
      return <circle cx="50" cy="50" r="38" fill={fill} />;
  }
}

/* ------------------------------- 主脑标志脸 ------------------------------- */

function LogoFace() {
  return (
    <g>
      {/* 深炭 P */}
      <path fill="#1C1917" d="M30 20 H62 C82 20 92 33 92 50 C92 67 82 80 62 80 H50 V66 H62 C73 66 78 59 78 50 C78 41 73 34 62 34 H30 Z" />
      {/* 橙色 T */}
      <path fill="#EA580C" d="M10 20 H58 V34 H50 V78 L42 92 L34 78 V34 H10 Z" />
    </g>
  );
}

/* --------------------------------- 眼睛 --------------------------------- */

function Eyes({ color }: { color: string }) {
  // 眼白固定白色，瞳孔固定深色；浅底色板靠深色描边勾勒眼白边缘
  const pupil = '#1F1A17';
  const eyeFill = '#FFFFFF';
  const eyes = [
    { cx: 39, cy: 42 },
    { cx: 61, cy: 42 },
  ];
  return (
    <g className="bot-eyes">
      {eyes.map((e, i) => (
        <g key={i} transform={`translate(${e.cx} ${e.cy})`}>
          <g className="bot-eye">
            <ellipse rx="7.5" ry="9.5" fill={eyeFill} stroke={pupil} strokeWidth="1.1" opacity="0.98" />
            <g className="bot-pupil">
              <circle r="3.8" fill={pupil} />
            </g>
          </g>
        </g>
      ))}
    </g>
  );
}

function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
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
        alt={spec.kind === 'logo' ? '主脑' : spec.letter}
        width={size}
        height={size}
        className={`bot-avatar-img ${className ?? ''}`}
        style={{ objectFit: 'cover', borderRadius: '9999px', ...style }}
      />
    );
  }

  const letterColor = spec.kind === 'letter' && isLight(spec.color) ? '#1F1A17' : '#FFFFFF';

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`bot-avatar ${className ?? ''}`}
      data-motion={motion}
      style={style}
      role="img"
      aria-label={spec.kind === 'logo' ? '主脑' : `${spec.letter} 号 Bot`}
    >
      {spec.kind === 'logo' ? <LogoFace /> : <ShapeBody variant={spec.variant} color={spec.color} />}
      {spec.kind === 'letter' && (
        <text
          x="50"
          y="72"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="28"
          fontWeight="800"
          fill={letterColor}
          opacity="0.92"
          style={{ fontFamily: 'inherit' }}
        >
          {spec.letter}
        </text>
      )}
      <Eyes color={spec.kind === 'logo' ? '#1C1917' : spec.color} />
    </svg>
  );
}
