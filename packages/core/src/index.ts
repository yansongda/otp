/**
 * core 主干入口：协议实现 + 门面 + crypto 接口 + 错误工厂。
 *
 * 刻意不导出 ./pure-js：ohos 的 Index.ets 只消费本入口，
 * 避免纯 JS SHA 被拖进 HAR 编译图（hvigor 会编译模块内全部 .ts）。
 */

export type { HashFunction, HmacProvider, RandomSource } from "./crypto";
export {
  registerHmac,
  registerRandom,
} from "./crypto";
export type { OtpErrorFactory } from "./errors";
/** 错误码取值随 barrel 导出：平台错误类必须复用本表，不得再抄一份。 */
export { OtpErrorCode, setErrorFactory } from "./errors";
export { HOTP } from "./hotp";
export type {
  HmacOptions,
  HotpOptions,
  HotpVerifyOptions,
  OtpAuthParams,
  ParseOptions,
  TotpOptions,
  TotpVerifyOptions,
  VerifyOptions,
} from "./options";
/** 漂移窗口上限随 barrel 导出：调用方做输入预校验时不得再硬编码 1000 / 10。 */
export { MAX_VERIFY_WINDOW } from "./options";
export { OTPAuthURI } from "./otpauth-uri";
export { Secret } from "./secret";
export { TOTP } from "./totp";
