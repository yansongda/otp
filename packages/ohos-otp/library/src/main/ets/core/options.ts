// AUTO-GENERATED from packages/core/src/options.ts. DO NOT EDIT. Run: bun run sync:core
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
  /**
   * 默认 0 = 不强制；设 128 启用 RFC 4226 §4 R6 校验。
   * 必须是非负安全整数：非法值（小数 / NaN / 负数 / 超 2^53-1）抛 INVALID_MIN_SECRET_BITS（fail-closed）。
   */
  minSecretBits?: number;
}

/** TOTP 选项（RFC 6238）。 */
export interface TotpOptions extends HmacOptions {
  /** 默认 30（RFC 6238 §5.2 推荐值），正整数秒。 */
  period?: number;
  /** 默认 0（RFC 6238 §4.1 的 T0，单位秒）。 */
  t0?: number;
  /**
   * 默认 0；时钟偏移补偿，仅 TOTP 有效。
   * 必须是安全整数毫秒（小数偏移无意义）：非法值抛 INVALID_CLOCK_OFFSET。
   */
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

/**
 * verify 校验选项（历史合并形态，兼容保留）。
 * 具体入口请使用下面按类收窄的 DTO：HOTP 不认 timestamp、TOTP 不认 counter。
 */
export interface VerifyOptions {
  /** epoch ms（安全整数），仅 TOTP，默认 Date.now()。 */
  timestamp?: number;
  /** 仅 HOTP，默认构造时的 counter。 */
  counter?: number;
  /** 漂移窗口（步），默认 0；必须为 [0, MAX_VERIFY_WINDOW] 内整数。 */
  window?: number;
}

/** HOTP.verify 选项：仅 counter / window（不接受 timestamp）。 */
export interface HotpVerifyOptions {
  /** 仅 HOTP，默认构造时的 counter。 */
  counter?: number;
  /** 漂移窗口（步），默认 0；必须为 [0, MAX_VERIFY_WINDOW] 内整数。 */
  window?: number;
}

/** TOTP.verify 选项：仅 timestamp / window（不接受 counter）。 */
export interface TotpVerifyOptions {
  /** epoch ms（安全整数），默认 Date.now()。 */
  timestamp?: number;
  /** 漂移窗口（步），默认 0；必须为 [0, MAX_VERIFY_WINDOW] 内整数。 */
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
 *
 * 动态验证码场景下 ±3 步已是极宽容值（默认 30s 周期 = ±90 秒），10 步（±5 分钟）
 * 进一步留足余量。上限的意义不是「业务可调」，而是把外部传入的 window 从一个
 * HMAC 计算炸弹收敛成有限、可预期的小常数：window = 10 → 至多 21 次 HMAC。
 */
export const MAX_VERIFY_WINDOW = 10;
