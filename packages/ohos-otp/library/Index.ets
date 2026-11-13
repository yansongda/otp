/**
 * @yansongda/otp 全量 barrel（唯一对外入口）。
 *
 * 实现全部来自 packages/core（经 sync-core 同步为 ./src/main/ets/core）；
 * 本文件只负责：注册 crypto 实现、注册平台错误工厂、导出公开符号。
 * internal/* 与 HmacProvider 一律不导出（测试经深路径 import）。
 */
import { setErrorFactory } from './src/main/ets/core/errors';
import { OtpError, asOtpErrorCode } from './src/main/ets/OtpError';
import { installCryptoDefaults } from './src/main/ets/internal/CryptoSource';

// 幂等注册；只构造对象并注册，不发起任何 crypto 调用
installCryptoDefaults();
setErrorFactory((code: string): Error => new OtpError(asOtpErrorCode(code), code, code));

export { OtpError, OtpErrorCode } from './src/main/ets/OtpError';
export {
  OtpAlgorithm,
  OtpType,
  HmacOptions,
  TotpOptions,
  HotpOptions,
  HotpVerifyOptions,
  TotpVerifyOptions,
  VerifyOptions,
  ParseOptions,
  OtpAuthParams,
  MAX_VERIFY_WINDOW
} from './src/main/ets/OtpOptions';
export { Secret } from './src/main/ets/Secret';
export { HOTP } from './src/main/ets/HOTP';
export { TOTP } from './src/main/ets/TOTP';
export { OTPAuthURI } from './src/main/ets/OTPAuthURI';
