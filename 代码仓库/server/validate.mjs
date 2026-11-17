// 图派 TuPai · 集中参数校验原语
// 设计目标：非法输入一律返回明确 4xx，取代散落在 routes.mjs 里的「静默改写 / || 默认值」。
// 所有函数失败即 fail('invalid_input', ...)，与既有错误信封 { error: { code, message } } 完全一致。
// 本模块不依赖任何外部包，纯 JS，可被 Deno 直接 import。

import { fail } from './util.mjs';

/** 字符串：类型 / 长度 / 必填。返回 trim 后的值。 */
export function vStr(value, field, { max = 200, min = 0, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('invalid_input', 400, `缺少 ${field}`);
    return '';
  }
  if (typeof value !== 'string') fail('invalid_input', 400, `${field} 必须是字符串`);
  const s = value.trim();
  if (s.length < min) fail('invalid_input', 400, `${field} 太短`);
  if (s.length > max) fail('invalid_input', 400, `${field} 过长`);
  return s;
}

/** 可空字符串：空值返回 fallback，非空值走 vStr 校验。 */
export function vStrOr(value, field, fallback = null, opts = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  return vStr(value, field, opts);
}

/** 严格整数：非法（含 NaN / 小数 / 非数字串）一律 400，不再静默取默认。 */
export function vInt(value, field, { min = -Infinity, max = Infinity, fallback = undefined, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('invalid_input', 400, `缺少 ${field}`);
    if (fallback !== undefined) return fallback;
    return undefined;
  }
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : NaN);
  if (!Number.isInteger(n)) fail('invalid_input', 400, `${field} 必须是整数`);
  if (n < min || n > max) fail('invalid_input', 400, `${field} 超出范围（${min}–${max}）`);
  return n;
}

/** 枚举：必须命中白名单之一。 */
export function vOneOf(value, field, values, fallback = undefined) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    fail('invalid_input', 400, `缺少 ${field}`);
  }
  if (!values.includes(value)) fail('invalid_input', 400, `${field} 取值无效，可选：${values.join(' / ')}`);
  return value;
}

/** ID 正则：prefix + 24 位 hex 或标准 UUID（session）。 */
export function vId(value, field, prefix) {
  const s = vStr(value, field, { max: 80, required: true });
  const re = prefix === 'uuid'
    ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    : new RegExp(`^${prefix}_[0-9a-f]{24}$`, 'i');
  if (!re.test(s)) fail('invalid_input', 400, `${field} 格式不正确`);
  return s.toLowerCase();
}

/** 对象（非数组）：用于 skill_snapshot / body 子结构。 */
export function vObject(value, field, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) fail('invalid_input', 400, `缺少 ${field}`);
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) fail('invalid_input', 400, `${field} 必须是对象`);
  return value;
}

/** 字符串数组：限制长度与元素类型，用于 tags / item_ids。 */
export function vStringArray(value, field, { max = 12, itemMax = 100, required = false } = {}) {
  if (!Array.isArray(value)) {
    if (required) fail('invalid_input', 400, `${field} 必须是数组`);
    return [];
  }
  if (value.length > max) fail('invalid_input', 400, `${field} 最多 ${max} 项`);
  return value.map((x, i) => {
    if (typeof x !== 'string') fail('invalid_input', 400, `${field}[${i}] 必须是字符串`);
    return x.trim().slice(0, itemMax);
  }).filter(Boolean);
}

/** 布尔：缺省取 fallback。 */
export function vBool(value, field, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') fail('invalid_input', 400, `${field} 必须是布尔值`);
  return value;
}

/** 业务枚举白名单（与 lib/types.ts 的取值语义一致，供路由直接引用）。 */
export const KIND_VALUES = ['original', 'result', 'reference'];
export const SORT_VALUES = ['new', 'hot'];
export const STATUS_VALUES = ['published', 'withdrawn', 'removed', 'pending'];
