/**
 * OtpError 错误模型测试：instanceof 双真 + 20 个枚举成员 + asOtpErrorCode 映射逐一断言（防枚举/映射漂移），
 * 以及 codeString 在「未知码兜底」场景下仍保留原始字符串。
 * 若 instanceof OtpError 断言失败，属设计性偏差，须停下上报，不静默改设计。
 */
import { describe, it, expect } from '@ohos/hypium';
import { OtpError, OtpErrorCode, asOtpErrorCode } from '../main/ets/OtpError';

export default function otpErrorTest() {
  describe('otpErrorTest', () => {
    it('otpError_instanceofAndFields', 0, () => {
      const err: OtpError = new OtpError(OtpErrorCode.INVALID_DIGITS, 'x');
      expect(err instanceof Error).assertTrue();
      expect(err instanceof OtpError).assertTrue();
      expect(err.name).assertEqual('OtpError');
      expect(err.code).assertEqual(OtpErrorCode.INVALID_DIGITS);
      expect(err.message).assertEqual('x');
    });

    it('otpErrorCode_all21MembersExactValues', 0, () => {
      const expected: string[] = [
        'EMPTY_SECRET', 'INVALID_BASE32_CHAR', 'INVALID_BASE32_PADDING',
        'SECRET_TOO_SHORT', 'SECRET_TOO_WEAK', 'INVALID_SECRET_LENGTH',
        'INVALID_MIN_SECRET_BITS', 'INVALID_ALGORITHM', 'INVALID_DIGITS',
        'INVALID_PERIOD', 'INVALID_T0', 'INVALID_COUNTER', 'INVALID_TIMESTAMP',
        'INVALID_CLOCK_OFFSET', 'INVALID_WINDOW', 'INVALID_TOKEN',
        'CRYPTO_FAILED', 'CRYPTO_NOT_INITIALIZED', 'INVALID_OTPAUTH_URI',
        'UNSUPPORTED_OTPAUTH_TYPE', 'NOT_IMPLEMENTED'
      ];
      const codes: OtpErrorCode[] = [
        OtpErrorCode.EMPTY_SECRET, OtpErrorCode.INVALID_BASE32_CHAR,
        OtpErrorCode.INVALID_BASE32_PADDING, OtpErrorCode.SECRET_TOO_SHORT,
        OtpErrorCode.SECRET_TOO_WEAK, OtpErrorCode.INVALID_SECRET_LENGTH,
        OtpErrorCode.INVALID_MIN_SECRET_BITS, OtpErrorCode.INVALID_ALGORITHM,
        OtpErrorCode.INVALID_DIGITS, OtpErrorCode.INVALID_PERIOD,
        OtpErrorCode.INVALID_T0, OtpErrorCode.INVALID_COUNTER,
        OtpErrorCode.INVALID_TIMESTAMP, OtpErrorCode.INVALID_CLOCK_OFFSET,
        OtpErrorCode.INVALID_WINDOW, OtpErrorCode.INVALID_TOKEN,
        OtpErrorCode.CRYPTO_FAILED, OtpErrorCode.CRYPTO_NOT_INITIALIZED,
        OtpErrorCode.INVALID_OTPAUTH_URI, OtpErrorCode.UNSUPPORTED_OTPAUTH_TYPE,
        OtpErrorCode.NOT_IMPLEMENTED
      ];
      expect(codes.length).assertEqual(21);
      for (let i = 0; i < codes.length; i++) {
        expect(codes[i]).assertEqual(expected[i]);
      }
    });

    it('asOtpErrorCode_mapsAllCodesAndFallback', 0, () => {
      expect(asOtpErrorCode(OtpErrorCode.EMPTY_SECRET)).assertEqual(OtpErrorCode.EMPTY_SECRET);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_BASE32_CHAR)).assertEqual(OtpErrorCode.INVALID_BASE32_CHAR);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_BASE32_PADDING)).assertEqual(OtpErrorCode.INVALID_BASE32_PADDING);
      expect(asOtpErrorCode(OtpErrorCode.SECRET_TOO_SHORT)).assertEqual(OtpErrorCode.SECRET_TOO_SHORT);
      expect(asOtpErrorCode(OtpErrorCode.SECRET_TOO_WEAK)).assertEqual(OtpErrorCode.SECRET_TOO_WEAK);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_SECRET_LENGTH)).assertEqual(OtpErrorCode.INVALID_SECRET_LENGTH);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_MIN_SECRET_BITS)).assertEqual(OtpErrorCode.INVALID_MIN_SECRET_BITS);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_ALGORITHM)).assertEqual(OtpErrorCode.INVALID_ALGORITHM);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_DIGITS)).assertEqual(OtpErrorCode.INVALID_DIGITS);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_PERIOD)).assertEqual(OtpErrorCode.INVALID_PERIOD);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_T0)).assertEqual(OtpErrorCode.INVALID_T0);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_COUNTER)).assertEqual(OtpErrorCode.INVALID_COUNTER);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_TIMESTAMP)).assertEqual(OtpErrorCode.INVALID_TIMESTAMP);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_CLOCK_OFFSET)).assertEqual(OtpErrorCode.INVALID_CLOCK_OFFSET);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_WINDOW)).assertEqual(OtpErrorCode.INVALID_WINDOW);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_TOKEN)).assertEqual(OtpErrorCode.INVALID_TOKEN);
      expect(asOtpErrorCode(OtpErrorCode.CRYPTO_FAILED)).assertEqual(OtpErrorCode.CRYPTO_FAILED);
      expect(asOtpErrorCode(OtpErrorCode.CRYPTO_NOT_INITIALIZED)).assertEqual(OtpErrorCode.CRYPTO_NOT_INITIALIZED);
      expect(asOtpErrorCode(OtpErrorCode.INVALID_OTPAUTH_URI)).assertEqual(OtpErrorCode.INVALID_OTPAUTH_URI);
      expect(asOtpErrorCode(OtpErrorCode.UNSUPPORTED_OTPAUTH_TYPE)).assertEqual(OtpErrorCode.UNSUPPORTED_OTPAUTH_TYPE);
      expect(asOtpErrorCode(OtpErrorCode.NOT_IMPLEMENTED)).assertEqual(OtpErrorCode.NOT_IMPLEMENTED);
      // 未知字符串必须兜底到 NOT_IMPLEMENTED（core 只传字符串，不能因新码泄漏未映射值）
      expect(asOtpErrorCode('UNKNOWN_CODE')).assertEqual(OtpErrorCode.NOT_IMPLEMENTED);
    });

    it('otpError_thrownCaughtPreservesCode', 0, () => {
      let isInstance: boolean = false;
      let code: string = '';
      try {
        throw new OtpError(OtpErrorCode.INVALID_COUNTER, 'INVALID_COUNTER');
      } catch (e) {
        isInstance = e instanceof OtpError;
        code = (e as OtpError).code;
      }
      expect(isInstance).assertTrue();
      expect(code).assertEqual(OtpErrorCode.INVALID_COUNTER);
    });

    it('otpError_codeStringPreservesRawCode', 0, () => {
      const mapped: OtpError = new OtpError(OtpErrorCode.INVALID_DIGITS, 'INVALID_DIGITS');
      expect(mapped.codeString).assertEqual('INVALID_DIGITS');

      // 未知码（core 未来新增、本枚举尚未同步）：code 兜底 + codeString 保留真实值
      const unknown: OtpError = new OtpError(asOtpErrorCode('FUTURE_CODE'), 'FUTURE_CODE', 'FUTURE_CODE');
      expect(unknown.code).assertEqual(OtpErrorCode.NOT_IMPLEMENTED);
      expect(unknown.codeString).assertEqual('FUTURE_CODE');
    });

    it('otpError_messageCustomizableSeparateFromCode', 0, () => {
      const err: OtpError = new OtpError(OtpErrorCode.SECRET_TOO_SHORT, '自定义文案');
      expect(err.code).assertEqual(OtpErrorCode.SECRET_TOO_SHORT);
      expect(err.message).assertEqual('自定义文案');
      expect(err.message === err.code).assertFalse();
    });
  });
}
