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

/** 预设可选色板（Grok 中性 + 亮蓝主色） */
export const AVATAR_PALETTE = [
  '#2F7CF6', '#1C1917', '#8A5A34', '#E0342B', '#EA580C', '#D9A93F',
  '#2F7D5B', '#2FA89A', '#2F6FA8', '#6A4A96', '#D6487E', '#8C7D6C', '#B4502A',
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
    case 8: // 圆润三角
      return (
        <path
          d="M50 20 C58 20 61 25 64 32 L80 68 C84 77 78 82 68 82 H32 C22 82 16 77 20 68 L36 32 C39 25 42 20 50 20 Z"
          fill={fill}
        />
      );
    case 9: // 圆角菱形
      return (
        <path
          d="M50 18 C56 30 68 42 82 50 C68 58 56 70 50 82 C44 70 32 58 18 50 C32 42 44 30 50 18 Z"
          fill={fill}
        />
      );
    case 10: // 圆润六瓣星
      return (
        <g fill={fill}>
          <circle cx="50" cy="50" r="15" />
          <circle cx="50" cy="31" r="12" />
          <circle cx="66" cy="40" r="12" />
          <circle cx="66" cy="60" r="12" />
          <circle cx="50" cy="69" r="12" />
          <circle cx="34" cy="60" r="12" />
          <circle cx="34" cy="40" r="12" />
        </g>
      );
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
    case 12: // 圆润盾
      return (
        <path
          d="M50 16 C62 16 74 22 80 28 V52 C80 70 66 82 50 88 C34 82 20 70 20 52 V28 C26 22 38 16 50 16 Z"
          fill={fill}
        />
      );;
    default:
      return <circle cx="50" cy="50" r="38" fill={fill} />;
  }
}

/* --------------------------------- 双杠眼睛 --------------------------------- */

function DashEyes() {
  const eyes = [
    { cx: 38, rot: -6 },
    { cx: 62, rot: 6 },
  ];
  return (
    <g className="bot-eyes">
      {eyes.map((e, i) => (
        <g key={i} transform={`translate(${e.cx} 44)`}>
          <g className="bot-eye">
            <ellipse rx="4.6" ry="9.5" fill="#FFFFFF" transform={`rotate(${e.rot})`} />
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
  tilt = true,
  badge,
}: {
  spec: AvatarSpec;
  size?: number;
  motion?: BotAvatarMotion;
  className?: string;
  style?: CSSProperties;
  /** Grok 式整体微倾斜（编辑网格可关掉） */
  tilt?: boolean;
  /** 右下角徽标（星形 / 在线点） */
  badge?: 'star' | 'dot';
}) {
  const badgeEl = badge ? (
    <span
      className="absolute grid place-items-center rounded-full text-white"
      style={{
        right: -size * 0.06, bottom: -size * 0.02, width: size * 0.34, height: size * 0.34,
        background: badge === 'star' ? '#F59E0B' : '#2F7CF6',
        boxShadow: '0 0 0 2px #fff',
      }}
    >
      {badge === 'star' ? (
        <svg width={size * 0.2} height={size * 0.2} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17l-6.1 3.6 1.4-6.8L2.2 9.1l6.9-.8z" /></svg>
      ) : null}
    </span>
  ) : null;

  if (spec.image) {
    return (
      <span className={`relative inline-block shrink-0 ${className ?? ''}`} style={{ width: size, height: size, ...style }}>
        <img
          src={spec.image}
          alt="Bot 头像"
          width={size}
          height={size}
          className="bot-avatar-img size-full"
          style={{ objectFit: 'cover', borderRadius: '9999px' }}
        />
        {badgeEl}
      </span>
    );
  }

  return (
    <span className={`relative inline-block shrink-0 ${className ?? ''}`} style={{ width: size, height: size, ...style }}>
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className="bot-avatar size-full"
        data-motion={motion}
        role="img"
        aria-label="Bot 头像"
      >
        <g transform={tilt ? 'rotate(-8 50 50)' : undefined}>
          <ShapeBody variant={spec.variant} color={spec.color} />
          <DashEyes />
        </g>
      </svg>
      {badgeEl}
    </span>
  );
}

/** 群会话簇头像：3 个小 blob 交叠（Grok 群聊形态） */
export function BotGroupAvatar({ specs, size = 40 }: { specs: AvatarSpec[]; size?: number }) {
  const mini = size * 0.62;
  const pos = [
    { left: 0, top: size * 0.16 },
    { left: size * 0.36, top: 0 },
    { left: size * 0.3, top: size * 0.4 },
  ];
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {specs.slice(0, 3).map((s, i) => (
        <span key={i} className="absolute" style={{ left: pos[i].left, top: pos[i].top, zIndex: i }}>
          <BotAvatar spec={s} size={mini} tilt={false} />
        </span>
      ))}
    </span>
  );
}
