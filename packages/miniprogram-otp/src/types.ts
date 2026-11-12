/**
 * 平台类型层（TS 侧，现代写法）：const 对象 + 字面量联合 + 严格 DTO。
 *
 * core 的跨边界签名只用基础类型（ArkTS 不支持字面量类型）；
 * 平台在这里收紧类型，并通过 index.ts 的构造签名桥接给消费者。
 */

export const OtpAlgorithm = {
  SHA1: "SHA1",
  SHA256: "SHA256",
  SHA512: "SHA512",
} as const;

export type OtpAlgorithm = (typeof OtpAlgorithm)[keyof typeof OtpAlgorithm];

export const OtpType = {
  TOTP: "totp",
  HOTP: "hotp",
} as const;

export type OtpType = (typeof OtpType)[keyof typeof OtpType];

/** HMAC 通用选项。 */
export interface HmacOptions {
  secret: string;
  algorithm?: OtpAlgorithm;
  digits?: 6 | 7 | 8;
  minSecretBits?: number;
}

/** TOTP 选项（RFC 6238）。 */
export interface TotpOptions extends HmacOptions {
  period?: number;
  t0?: number;
  clockOffsetMs?: number;
  issuer?: string;
  account?: string;
}

/** HOTP 选项（RFC 4226）。 */
export interface HotpOptions extends HmacOptions {
  counter?: number;
  issuer?: string;
  account?: string;
}

/** verify 校验选项。 */
export interface VerifyOptions {
  timestamp?: number;
  counter?: number;
  window?: number;
}

/** 解析选项。 */
export interface ParseOptions {
  strict?: boolean;
}

/** otpauth URI 解析 / 构建的中间参数形态。 */
export interface OtpAuthParams {
  type: OtpType;
  secret: string;
  algorithm: OtpAlgorithm;
  digits: number;
  period?: number;
  counter?: number;
  issuer?: string;
  account?: string;
  label?: string;
}
