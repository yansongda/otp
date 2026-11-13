/**
 * 统一错误码 + core 默认错误类（仅无平台注册时兜底）。
 *
 * 公开 OtpError 由平台层拥有：ArkTS 用 enum code、TS 用字面量联合，两者类型不兼容。
 * 平台启动时 setErrorFactory 注入自己的构造器，core 抛出的仍是平台类（instanceof 成立）。
 * 本文件的 OtpError 不随 barrel 导出，仅用于 core 单测与默认兜底；OtpErrorCode 的
 * **取值**随 barrel 导出（平台不得再抄一份码表）。
 *
 * 错误码优先级（同一个调用里可能同时命中多个校验时，按此顺序返回第一个）：
 * 1) 解析类：EMPTY_SECRET / INVALID_BASE32_CHAR / INVALID_BASE32_PADDING / SECRET_TOO_SHORT
 * 2) 参数类：INVALID_ALGORITHM / INVALID_DIGITS / INVALID_PERIOD / INVALID_T0 /
 *            INVALID_COUNTER / INVALID_WINDOW / INVALID_CLOCK_OFFSET /
 *            SECRET_TOO_WEAK / INVALID_SECRET_LENGTH
 * 3) 输入类：INVALID_TOKEN
 * 4) 环境类：CRYPTO_FAILED / CRYPTO_NOT_INITIALIZED
 * 配置/构造期错误先于用户输入错误，避免「调用方写错参数」被「用户输错 token」掩盖。
 */

export const OtpErrorCode = {
  EMPTY_SECRET: "EMPTY_SECRET",
  INVALID_BASE32_CHAR: "INVALID_BASE32_CHAR",
  // 严格 base32 专用：归一化后尾长 ∉ {0,2,4,5,7}，或末尾填充位非 0（宽松模式静默补 0）
  INVALID_BASE32_PADDING: "INVALID_BASE32_PADDING",
  SECRET_TOO_SHORT: "SECRET_TOO_SHORT",
  // 仅用于 { minSecretBits } 强度校验
  SECRET_TOO_WEAK: "SECRET_TOO_WEAK",
  // Secret.generate(bytes) / 平台随机源：bytes 不是 [1, 4096] 整数
  INVALID_SECRET_LENGTH: "INVALID_SECRET_LENGTH",
  INVALID_ALGORITHM: "INVALID_ALGORITHM",
  INVALID_DIGITS: "INVALID_DIGITS",
  INVALID_PERIOD: "INVALID_PERIOD",
  INVALID_T0: "INVALID_T0",
  INVALID_COUNTER: "INVALID_COUNTER",
  // 仅用于时间戳（epoch ms）
  INVALID_TIMESTAMP: "INVALID_TIMESTAMP",
  // clockOffsetMs 非有限，或 syncClockOffset 的 delta 非整数 / 累加结果超出安全整数
  INVALID_CLOCK_OFFSET: "INVALID_CLOCK_OFFSET",
  INVALID_WINDOW: "INVALID_WINDOW",
  INVALID_TOKEN: "INVALID_TOKEN",
  CRYPTO_FAILED: "CRYPTO_FAILED",
  CRYPTO_NOT_INITIALIZED: "CRYPTO_NOT_INITIALIZED",
  INVALID_OTPAUTH_URI: "INVALID_OTPAUTH_URI",
  UNSUPPORTED_OTPAUTH_TYPE: "UNSUPPORTED_OTPAUTH_TYPE",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
} as const;

export type OtpErrorCode = (typeof OtpErrorCode)[keyof typeof OtpErrorCode];

/**
 * ES5 降级兜底：仅当原型已退化为 Error.prototype（Error.call 返回新对象）时修复链。
 *
 * 无条件 setPrototypeOf 会把子类实例的原型改回基类（instanceof 子类失效、原型方法丢失），
 * 因此必须先判断；独立成函数是为了让这一条件可被单测直接覆盖（不随 barrel 导出）。
 */
export function repairPrototypeIfDegraded(target: object): void {
  if (Object.getPrototypeOf(target) === Error.prototype) {
    Object.setPrototypeOf(target, OtpError.prototype);
  }
}

/** core 默认错误类（平台会用自己的 OtpError 覆盖工厂，故本类不对外导出）。 */
export class OtpError extends Error {
  readonly code: OtpErrorCode;
  /** 原始错误码字符串：平台新增码尚未映射时仍可保留真实值（UNKNOWN 场景兜底）。 */
  readonly codeString: string;

  constructor(
    code: OtpErrorCode,
    message: string = code,
    codeString: string = code,
  ) {
    super(message);
    this.name = "OtpError";
    repairPrototypeIfDegraded(this);
    this.code = code;
    this.codeString = codeString;
  }
}

/** 平台错误工厂：入参为错误码字符串（基础类型，ArkTS 可直接实现）。 */
export type OtpErrorFactory = (code: string) => Error;

const defaultErrorFactory: OtpErrorFactory = (code: string): Error =>
  new OtpError(code as OtpErrorCode);

let errorFactory: OtpErrorFactory = defaultErrorFactory;

/** 平台注册公开错误类构造器（幂等覆盖）。 */
export function setErrorFactory(factory: OtpErrorFactory): void {
  errorFactory = factory;
}

/** 恢复 core 默认工厂（仅测试使用，与 crypto.reset() 对称）。 */
export function resetErrorFactory(): void {
  errorFactory = defaultErrorFactory;
}

/**
 * 抛出平台错误；message 固定为错误码本身。
 * 工厂返回值不是 Error 时（平台实现越界）兜底抛 core 默认类，
 * 保证调用方永远能拿到 instanceof Error + code 的对象。
 */
export function otpFail(code: OtpErrorCode): never {
  const error = errorFactory(code);
  if (!(error instanceof Error)) {
    throw new OtpError(code);
  }
  throw error;
}
