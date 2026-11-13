/**
 * 对外 DTO 与内部常量。
 *
 * 跨 .ets 边界的签名只用基础类型（ArkTS 不支持字面量类型 / as const），
 * 平台层各自提供更严格的类型（TS 字面量联合 / ArkTS enum）。
 * 内部类型（ALGORITHMS / AlgorithmName 等）只在 .ts 内使用，不进入 barrel。
 */

/** HMAC 通用选项（HOTP / TOTP 共用字段）。 */
export interface HmacOptions {
  /** 必填；base32，宽松解析（容忍大小写 / 空白 / 填充）。 */
  secret: string;
  /** 默认 SHA1。 */
  algorithm?: string;
  /** 默认 6；仅允许 6 | 7 | 8（RFC 4226 §5.3）。 */
  digits?: number;
  /** 默认 0 = 不强制；设 128 启用 RFC 4226 §4 R6 校验。 */
  minSecretBits?: number;
}

/** TOTP 选项（RFC 6238）。 */
export interface TotpOptions extends HmacOptions {
  /** 默认 30（RFC 6238 §5.2 推荐值），正整数秒。 */
  period?: number;
  /** 默认 0（RFC 6238 §4.1 的 T0，单位秒）。 */
  t0?: number;
  /** 默认 0；时钟偏移补偿，仅 TOTP 有效。 */
  clockOffsetMs?: number;
  /** 仅用于 toURI()。 */
  issuer?: string;
  /** 仅用于 toURI()。 */
  account?: string;
}

/** HOTP 选项（RFC 4226）。 */
export interface HotpOptions extends HmacOptions {
  /** 默认 0。 */
  counter?: number;
  /** 仅用于 toURI()。 */
  issuer?: string;
  /** 仅用于 toURI()。 */
  account?: string;
}

/** verify 校验选项。 */
export interface VerifyOptions {
  /** epoch ms，仅 TOTP，默认 Date.now()。 */
  timestamp?: number;
  /** 仅 HOTP，默认构造时的 counter。 */
  counter?: number;
  /** 漂移窗口（步），默认 0。 */
  window?: number;
}

/** 解析选项（Secret.fromBase32 与 OTPAuthURI.parse 共用）。 */
export interface ParseOptions {
  /** true：要求归一化后为规范 base32，否则 INVALID_BASE32_PADDING。 */
  strict?: boolean;
}

/** otpauth URI 解析 / 构建的中间参数形态。 */
export interface OtpAuthParams {
  type: string;
  secret: string;
  algorithm: string;
  digits: number;
  period?: number;
  counter?: number;
  issuer?: string;
  account?: string;
  label?: string;
}

/** 内部常量：现代 TS（as const / 字面量），不跨 .ets 边界（barrel 不导出）。 */
export const OtpAlgorithm = {
  SHA1: "SHA1",
  SHA256: "SHA256",
  SHA512: "SHA512",
} as const;
export type OtpAlgorithm = (typeof OtpAlgorithm)[keyof typeof OtpAlgorithm];
export type AlgorithmName = OtpAlgorithm;

export const OtpType = {
  TOTP: "totp",
  HOTP: "hotp",
} as const;
export type OtpType = (typeof OtpType)[keyof typeof OtpType];

export const ALGORITHMS = [
  OtpAlgorithm.SHA1,
  OtpAlgorithm.SHA256,
  OtpAlgorithm.SHA512,
] as const;

export const ALLOWED_DIGITS = [6, 7, 8] as const;
export type DigitCount = (typeof ALLOWED_DIGITS)[number];

/**
 * 默认值唯一来源（ArkTS 不支持 `as const` 对象字面量，故用独立常量）。
 * 构造器、URI parse / build 必须共用，禁止再写字面量 30 / 6 / 0。
 */
export const DEFAULT_ALGORITHM: AlgorithmName = "SHA1";
export const DEFAULT_DIGITS = 6;
export const DEFAULT_PERIOD = 30;
export const DEFAULT_COUNTER = 0;
export const DEFAULT_T0 = 0;
export const DEFAULT_CLOCK_OFFSET_MS = 0;
export const DEFAULT_MIN_SECRET_BITS = 0;

/**
 * verify 漂移窗口上限（单位 = 时间步，双向）。
 * 不设上限时 window 来自外部输入即可放大成 HMAC 计算炸弹：
 * window = 10^5 需要 2×10^5 次 HMAC（本机 ≈ 220ms，小程序纯 JS 更慢）。
 * 1000 步覆盖 TOTP 默认周期下的 ±8.3 小时，远超时钟漂移的实际量级。
 */
export const MAX_VERIFY_WINDOW = 1000;
