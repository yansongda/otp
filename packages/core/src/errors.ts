/**
 * 统一错误码 + core 默认错误类（仅无平台注册时兜底）。
 *
 * 公开 OtpError 由平台层拥有：ArkTS 用 enum code、TS 用字面量联合，两者类型不兼容。
 * 平台启动时 setErrorFactory 注入自己的构造器，core 抛出的仍是平台类（instanceof 成立）。
 * 本文件的 OtpError 不随 barrel 导出，仅用于 core 单测与默认兜底；OtpErrorCode 的
 * **取值**随 barrel 导出（平台不得再抄一份码表）。
 *
 * 错误码优先级（同一个调用可能同时命中多个校验时，按各入口的固定顺序返回第一个）：
 *
 *   构造 HOTP：secret 解析 → INVALID_DIGITS → INVALID_ALGORITHM → INVALID_COUNTER →
 *             SECRET_TOO_WEAK
 *   构造 TOTP：secret 解析 → INVALID_DIGITS → INVALID_ALGORITHM → INVALID_PERIOD →
 *             INVALID_T0 → INVALID_TIMESTAMP（clockOffsetMs 非有限）→ SECRET_TOO_WEAK
 *   URI parse：INVALID_OTPAUTH_URI（前缀非法）→ UNSUPPORTED_OTPAUTH_TYPE →
 *             secret 解析 → INVALID_ALGORITHM → INVALID_DIGITS →
 *             INVALID_PERIOD | INVALID_COUNTER
 *   URI build：secret 解析 → INVALID_PERIOD | INVALID_COUNTER
 *   verify：INVALID_TOKEN → INVALID_COUNTER → INVALID_WINDOW
 *
 * 约定：每个已知失败原因使用独立错误码，仅「同一语义条件出现在多个入口」时复用
 * （如 counter 越界 → INVALID_COUNTER）；禁止把不同原因合并成一个码。
 */

export const OtpErrorCode = {
  // secret 缺失 / 解码后为空
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

/**
 * ES5 降级兜底：仅当原型已退化为 Error.prototype（Error.call 返回新对象）时修复链。
 *
 * 无条件 setPrototypeOf 会把原生 class 语义下的子类实例原型改回基类
 * （instanceof 子类失效、原型方法丢失），因此必须先判断。
 *
 * 局限（已知且不可在库内修复）：ES5 转译时 `super()` 会返回一个全新的 Error 对象，
 * 基类构造器无法区分「直接 new」与「子类 new」，因此 ES5 + 自定义子类仍会丢原型——
 * 该场景需调用方在自己的构造器里重新 setPrototypeOf（见 mp README）。
 * 独立成函数是为了让这一条件可被单测直接覆盖（不随 barrel 导出）。
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
 * 工厂返回值不是「带字符串 code 的 Error」时（平台实现越界）兜底抛 core 默认类，
 * 保证调用方永远能拿到 instanceof Error + 可分支的 code 的对象。
 * 只判 `instanceof Error` 不够：`new Error(code)` 这类裸 Error 会让调用方拿到
 * 无 `code` 的对象，按码分支时静默落到 default。
 */
export function otpFail(code: OtpErrorCode): never {
  const error = errorFactory(code);
  if (
    !(error instanceof Error) ||
    typeof (error as { code?: unknown }).code !== "string"
  ) {
    throw new OtpError(code);
  }
  throw error;
}
