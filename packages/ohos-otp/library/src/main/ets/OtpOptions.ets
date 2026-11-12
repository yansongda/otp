/**
 * 平台类型层（ArkTS）：enum + 严格 DTO。
 *
 * 所有 interface 均 extends core 的对应 DTO（基础类型），
 * 因此把平台 DTO 传给 core 的公开类/函数是合法赋值，消费者零改动。
 */
import {
  HmacOptions as CoreHmacOptions,
  HotpOptions as CoreHotpOptions,
  OtpAuthParams as CoreOtpAuthParams,
  TotpOptions as CoreTotpOptions
} from './core/options';

/**
 * 算法枚举（字符串值，RFC 6238 §1.2）。
 */
export enum OtpAlgorithm {
  SHA1 = 'SHA1',
  SHA256 = 'SHA256',
  SHA512 = 'SHA512'
}

/**
 * OTP 类型枚举（otpauth URI 的 type 参数）。
 */
export enum OtpType {
  TOTP = 'totp',
  HOTP = 'hotp'
}

/** HMAC 通用选项（HOTP/TOTP 共用基类字段）。 */
export interface HmacOptions extends CoreHmacOptions {
  algorithm?: OtpAlgorithm;
}

/** TOTP 选项（RFC 6238）。 */
export interface TotpOptions extends CoreTotpOptions {
  algorithm?: OtpAlgorithm;
}

/** HOTP 选项（RFC 4226）。 */
export interface HotpOptions extends CoreHotpOptions {
  algorithm?: OtpAlgorithm;
}

/** verify 校验选项（字段与 core 一致，直接复用）。 */
export { VerifyOptions } from './core/options';

/** 解析选项（字段与 core 一致，直接复用）。 */
export { ParseOptions } from './core/options';

/** otpauth URI 解析/构建的中间参数形态。 */
export interface OtpAuthParams extends CoreOtpAuthParams {
  type: OtpType;
  algorithm: OtpAlgorithm;
}
