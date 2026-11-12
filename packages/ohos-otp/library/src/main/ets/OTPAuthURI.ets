/**
 * 平台类型外壳：实现见 core/otpauth-uri.ts。
 *
 * core 的 parse 返回 type/algorithm 为 string（ArkTS 不支持字面量类型），
 * 这里以 as 做一次类型投影，公开 API 仍返回平台严格的 OtpAuthParams。
 */
import { OTPAuthURI as CoreOTPAuthURI } from './core/otpauth-uri';
import { OtpAuthParams, ParseOptions } from './OtpOptions';

export class OTPAuthURI {
  static parse(uri: string, options?: ParseOptions): OtpAuthParams {
    return CoreOTPAuthURI.parse(uri, options) as OtpAuthParams;
  }

  static build(params: OtpAuthParams): string {
    return CoreOTPAuthURI.build(params);
  }
}
