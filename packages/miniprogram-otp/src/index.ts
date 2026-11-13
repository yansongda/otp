/**
 * @yansongda/miniprogram-otp 公开入口。
 *
 * 实现全部来自 @yansongda/otp-core（唯一源码）；本文件只做三件事：
 * 1) 注册纯 JS HMAC 兜底实现（微信小程序无同步 WebCrypto）；
 * 2) 注册平台错误工厂，使 core 抛出的就是本包的 OtpError；
 * 3) 类型桥：core 的宽松签名 → 平台严格 DTO（构造签名参数逆变位置，无需断言）。
 */
import {
  HOTP as CoreHOTP,
  OTPAuthURI as CoreOTPAuthURI,
  Secret as CoreSecret,
  TOTP as CoreTOTP,
  type HmacProvider,
  setErrorFactory,
} from "@yansongda/otp-core";
import { installPureJsHmac } from "@yansongda/otp-core/pure-js";
import type { OtpErrorCode } from "./errors";
import { OtpError } from "./errors";
import type {
  HotpOptions,
  HotpVerifyOptions,
  OtpAuthParams,
  ParseOptions,
  TotpOptions,
  TotpVerifyOptions,
} from "./types";

// 幂等注册；只构造对象并注册，不发起任何 HMAC 计算
installPureJsHmac();
setErrorFactory(
  (code: string): Error => new OtpError(code as OtpErrorCode, code),
);

export { OtpError, OtpErrorCode } from "./errors";
export type {
  HmacOptions,
  HotpOptions,
  HotpVerifyOptions,
  OtpAuthParams,
  ParseOptions,
  TotpOptions,
  TotpVerifyOptions,
  VerifyOptions,
} from "./types";
export { OtpAlgorithm, OtpType } from "./types";

// ---- 类型桥：实例类型复用 core，构造签名收紧到平台 DTO ----

// verify 选项按类收窄：HOTP 不认 timestamp、TOTP 不认 counter（core 会静默忽略这两个字段）
export type HOTP = Omit<CoreHOTP, "verify"> & {
  verify(token: string, options?: HotpVerifyOptions): number | null;
};
export const HOTP: {
  new (options: HotpOptions, provider?: HmacProvider): HOTP;
  fromURI(uri: string): HOTP;
} = CoreHOTP;

export type TOTP = Omit<CoreTOTP, "verify"> & {
  verify(token: string, options?: TotpVerifyOptions): number | null;
};
export const TOTP: {
  new (options: TotpOptions, provider?: HmacProvider): TOTP;
  fromURI(uri: string): TOTP;
} = CoreTOTP;

export type Secret = CoreSecret;
export const Secret: typeof CoreSecret = CoreSecret;

export const OTPAuthURI: {
  parse(uri: string, options?: ParseOptions): OtpAuthParams;
  build(params: OtpAuthParams): string;
} = CoreOTPAuthURI as unknown as {
  parse(uri: string, options?: ParseOptions): OtpAuthParams;
  build(params: OtpAuthParams): string;
};
