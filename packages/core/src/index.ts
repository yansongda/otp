/**
 * core 主干入口：协议实现 + 门面 + crypto 接口 + 错误工厂。
 *
 * 刻意不导出 ./pure-js：ohos 的 Index.ets 只消费本入口，
 * 避免纯 JS SHA 被拖进 HAR 编译图（hvigor 会编译模块内全部 .ts）。
 */
export { setErrorFactory } from "./errors";
export type { OtpErrorFactory, OtpFailureCode } from "./errors";
export {
  registerHmac,
  registerRandom,
} from "./crypto";
export type { HashFunction, HmacProvider, RandomSource } from "./crypto";
export { Secret } from "./secret";
export { HOTP } from "./hotp";
export { TOTP } from "./totp";
export { OTPAuthURI } from "./otpauth-uri";
export type {
  HmacOptions,
  HotpOptions,
  OtpAuthParams,
  ParseOptions,
  TotpOptions,
  VerifyOptions,
} from "./options";
