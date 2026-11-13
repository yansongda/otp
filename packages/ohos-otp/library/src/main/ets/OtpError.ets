/**
 * 统一错误模型：错误码枚举（21 个，字符串值）+ OtpError。
 * 消息文案固定，绝不包含 secret/token/派生密钥等用户输入。
 *
 * 取值唯一来源是 core（packages/core/src/errors.ts）：
 * 本枚举是 ArkTS 侧的强类型投影，新增码时必须同步（守卫脚本做枚举↔core 逐项对拍）。
 * core 通过 setErrorFactory 注入本类：core 只传错误码字符串，这里映射回 enum。
 *
 * 契约：name 固定为 'OtpError'——core 的 engine 靠它区分「已知错误（原样上抛）」与
 * 「provider 实现缺陷（收敛为 CRYPTO_FAILED）」，不得删除。
 */
export enum OtpErrorCode {
  EMPTY_SECRET = 'EMPTY_SECRET',
  INVALID_BASE32_CHAR = 'INVALID_BASE32_CHAR',
  // 严格 base32 专用：归一化后尾长 ∉ {0,2,4,5,7}，或末尾填充位非 0（宽松模式静默补 0）
  INVALID_BASE32_PADDING = 'INVALID_BASE32_PADDING',
  SECRET_TOO_SHORT = 'SECRET_TOO_SHORT',
  // 仅用于 { minSecretBits } 强度校验
  SECRET_TOO_WEAK = 'SECRET_TOO_WEAK',
  // Secret.generate(bytes) / 随机源：bytes 不是 [1, 4096] 整数
  INVALID_SECRET_LENGTH = 'INVALID_SECRET_LENGTH',
  // minSecretBits 不是非负安全整数（参数错误；密钥本身强度不足才是 SECRET_TOO_WEAK）
  INVALID_MIN_SECRET_BITS = 'INVALID_MIN_SECRET_BITS',
  INVALID_ALGORITHM = 'INVALID_ALGORITHM',
  INVALID_DIGITS = 'INVALID_DIGITS',
  INVALID_PERIOD = 'INVALID_PERIOD',
  INVALID_T0 = 'INVALID_T0',
  INVALID_COUNTER = 'INVALID_COUNTER',
  // 仅用于时间戳（epoch ms）
  INVALID_TIMESTAMP = 'INVALID_TIMESTAMP',
  // clockOffsetMs 非安全整数，或 syncClockOffset 的 delta 非安全整数 / 累加结果超出安全整数
  INVALID_CLOCK_OFFSET = 'INVALID_CLOCK_OFFSET',
  INVALID_WINDOW = 'INVALID_WINDOW',
  INVALID_TOKEN = 'INVALID_TOKEN',
  CRYPTO_FAILED = 'CRYPTO_FAILED',
  CRYPTO_NOT_INITIALIZED = 'CRYPTO_NOT_INITIALIZED',
  INVALID_OTPAUTH_URI = 'INVALID_OTPAUTH_URI',
  UNSUPPORTED_OTPAUTH_TYPE = 'UNSUPPORTED_OTPAUTH_TYPE',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED'
}

/** 统一错误类：调用方可通过 code 精确分支处理。 */
export class OtpError extends Error {
  readonly code: OtpErrorCode;
  /** 原始错误码字符串：core 新增码尚未同步到本枚举时仍保留真实值（而不是只剩 NOT_IMPLEMENTED）。 */
  readonly codeString: string;

  constructor(code: OtpErrorCode, message: string, codeString?: string) {
    super(message);
    this.name = 'OtpError';
    this.code = code;
    this.codeString = codeString === undefined ? code : codeString;
  }
}

/** 字符串错误码 → 枚举（core 的错误工厂回调使用；未知码兜底 NOT_IMPLEMENTED，但 codeString 保留原值）。 */
export function asOtpErrorCode(code: string): OtpErrorCode {
  switch (code) {
    case 'EMPTY_SECRET': return OtpErrorCode.EMPTY_SECRET;
    case 'INVALID_BASE32_CHAR': return OtpErrorCode.INVALID_BASE32_CHAR;
    case 'INVALID_BASE32_PADDING': return OtpErrorCode.INVALID_BASE32_PADDING;
    case 'SECRET_TOO_SHORT': return OtpErrorCode.SECRET_TOO_SHORT;
    case 'SECRET_TOO_WEAK': return OtpErrorCode.SECRET_TOO_WEAK;
    case 'INVALID_SECRET_LENGTH': return OtpErrorCode.INVALID_SECRET_LENGTH;
    case 'INVALID_MIN_SECRET_BITS': return OtpErrorCode.INVALID_MIN_SECRET_BITS;
    case 'INVALID_ALGORITHM': return OtpErrorCode.INVALID_ALGORITHM;
    case 'INVALID_DIGITS': return OtpErrorCode.INVALID_DIGITS;
    case 'INVALID_PERIOD': return OtpErrorCode.INVALID_PERIOD;
    case 'INVALID_T0': return OtpErrorCode.INVALID_T0;
    case 'INVALID_COUNTER': return OtpErrorCode.INVALID_COUNTER;
    case 'INVALID_TIMESTAMP': return OtpErrorCode.INVALID_TIMESTAMP;
    case 'INVALID_CLOCK_OFFSET': return OtpErrorCode.INVALID_CLOCK_OFFSET;
    case 'INVALID_WINDOW': return OtpErrorCode.INVALID_WINDOW;
    case 'INVALID_TOKEN': return OtpErrorCode.INVALID_TOKEN;
    case 'CRYPTO_FAILED': return OtpErrorCode.CRYPTO_FAILED;
    case 'CRYPTO_NOT_INITIALIZED': return OtpErrorCode.CRYPTO_NOT_INITIALIZED;
    case 'INVALID_OTPAUTH_URI': return OtpErrorCode.INVALID_OTPAUTH_URI;
    case 'UNSUPPORTED_OTPAUTH_TYPE': return OtpErrorCode.UNSUPPORTED_OTPAUTH_TYPE;
    // NOT_IMPLEMENTED 只是兜底码，显式列出以便「枚举 ↔ 映射」守卫逐项对拍
    case 'NOT_IMPLEMENTED': return OtpErrorCode.NOT_IMPLEMENTED;
    default: return OtpErrorCode.NOT_IMPLEMENTED;
  }
}
