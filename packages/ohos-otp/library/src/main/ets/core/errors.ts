// AUTO-GENERATED from packages/core/src/errors.ts. DO NOT EDIT. Run: bun run sync:core
/**
 * 统一错误码 + core 默认错误类（仅无平台注册时兜底）。
 *
 * 公开 OtpError 由平台层拥有：ArkTS 用 enum code、TS 用字面量联合，两者类型不兼容。
 * 平台启动时 setErrorFactory 注入自己的构造器，core 抛出的仍是平台类（instanceof 成立）。
 * 本文件的 OtpError 不随 barrel 导出，仅用于 core 单测与默认兜底。
 */

export const OtpErrorCode = {
  EMPTY_SECRET: "EMPTY_SECRET",
  INVALID_BASE32_CHAR: "INVALID_BASE32_CHAR",
  // 严格 base32 专用：归一化后尾长 ∉ {0,2,4,5,7}，或末尾填充位非 0（宽松模式静默补 0）
  INVALID_BASE32_PADDING: "INVALID_BASE32_PADDING",
  SECRET_TOO_SHORT: "SECRET_TOO_SHORT",
  SECRET_TOO_WEAK: "SECRET_TOO_WEAK",
  INVALID_ALGORITHM: "INVALID_ALGORITHM",
  INVALID_DIGITS: "INVALID_DIGITS",
  INVALID_PERIOD: "INVALID_PERIOD",
  INVALID_T0: "INVALID_T0",
  INVALID_COUNTER: "INVALID_COUNTER",
  INVALID_TIMESTAMP: "INVALID_TIMESTAMP",
  INVALID_WINDOW: "INVALID_WINDOW",
  INVALID_TOKEN: "INVALID_TOKEN",
  CRYPTO_FAILED: "CRYPTO_FAILED",
  CRYPTO_NOT_INITIALIZED: "CRYPTO_NOT_INITIALIZED",
  INVALID_OTPAUTH_URI: "INVALID_OTPAUTH_URI",
  UNSUPPORTED_OTPAUTH_TYPE: "UNSUPPORTED_OTPAUTH_TYPE",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
} as const;

export type OtpErrorCode = (typeof OtpErrorCode)[keyof typeof OtpErrorCode];
export type OtpFailureCode = OtpErrorCode;

/** core 默认错误类（平台会用自己的 OtpError 覆盖工厂，故本类不对外导出）。 */
export class OtpError extends Error {
  readonly code: OtpFailureCode;

  constructor(code: OtpFailureCode, message: string = code) {
    super(message);
    this.name = "OtpError";
    Object.setPrototypeOf(this, OtpError.prototype);
    this.code = code;
  }
}

/** 平台错误工厂：入参为错误码字符串（基础类型，ArkTS 可直接实现）。 */
export type OtpErrorFactory = (code: string) => Error;

let errorFactory: OtpErrorFactory = (code: string): Error =>
  new OtpError(code as OtpFailureCode);

/** 平台注册公开错误类构造器（幂等覆盖）。 */
export function setErrorFactory(factory: OtpErrorFactory): void {
  errorFactory = factory;
}

/** 抛出平台错误；message 固定为错误码本身。 */
export function otpFail(code: OtpFailureCode): never {
  throw errorFactory(code);
}
