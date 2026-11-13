/**
 * 错误模型：21 个错误码取值冻结；OtpError 的 code / message / instanceof / 原型链行为；
 * otpFail 的工厂契约与兜底。
 */
import { afterEach, describe, expect, it } from "bun:test";
import {
  OtpError,
  OtpErrorCode,
  otpFail,
  repairPrototypeIfDegraded,
  resetErrorFactory,
  setErrorFactory,
} from "../../src/errors";

const CODES = [
  "EMPTY_SECRET",
  "INVALID_BASE32_CHAR",
  "INVALID_BASE32_PADDING",
  "SECRET_TOO_SHORT",
  "SECRET_TOO_WEAK",
  "INVALID_SECRET_LENGTH",
  "INVALID_MIN_SECRET_BITS",
  "INVALID_ALGORITHM",
  "INVALID_DIGITS",
  "INVALID_PERIOD",
  "INVALID_T0",
  "INVALID_COUNTER",
  "INVALID_TIMESTAMP",
  "INVALID_CLOCK_OFFSET",
  "INVALID_WINDOW",
  "INVALID_TOKEN",
  "CRYPTO_FAILED",
  "CRYPTO_NOT_INITIALIZED",
  "INVALID_OTPAUTH_URI",
  "UNSUPPORTED_OTPAUTH_TYPE",
  "NOT_IMPLEMENTED",
] as const;

afterEach(() => {
  resetErrorFactory();
});

describe("errors", () => {
  it("hasExactly21FrozenCodes", () => {
    expect(Object.keys(OtpErrorCode).length).toBe(21);
    expect(Object.values(OtpErrorCode).sort()).toEqual([...CODES].sort());
  });

  it("codeValueEqualsItsName", () => {
    for (const code of CODES) {
      expect(OtpErrorCode[code]).toBe(code);
    }
  });

  it("messageIsFixedAndCodePreserved", () => {
    const err = new OtpError(OtpErrorCode.INVALID_DIGITS, "INVALID_DIGITS");
    expect(err.code).toBe("INVALID_DIGITS");
    expect(err.codeString).toBe("INVALID_DIGITS");
    expect(err.message).toBe("INVALID_DIGITS");
    expect(err.name).toBe("OtpError");
    expect(err instanceof OtpError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it("doesNotLeakSecretInMessage", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const err = new OtpError(OtpErrorCode.SECRET_TOO_WEAK, "SECRET_TOO_WEAK");
    expect(err.message.indexOf(secret)).toBe(-1);
  });

  it("nativePrototypeChainIsKeptForSubclasses", () => {
    // 构造函数里的 setPrototypeOf 只在原型退化为 Error.prototype 时生效；
    // 原生 class 语义下子类原型不得被改回基类（否则 instanceof 子类失效、原型方法丢失）
    class SubError extends OtpError {
      detail(): string {
        return "detail";
      }
    }
    const sub = new SubError(OtpErrorCode.EMPTY_SECRET);
    expect(Object.getPrototypeOf(sub)).toBe(SubError.prototype);
    expect(sub instanceof SubError).toBe(true);
    expect(sub instanceof OtpError).toBe(true);
    expect(sub.detail()).toBe("detail");
    expect(sub.code).toBe("EMPTY_SECRET");
  });

  it("repairPrototypeIfDegraded_onlyRepairsErrorPrototype", () => {
    // ES5 降级场景：实例原型已退化为 Error.prototype → 修回 OtpError.prototype
    const degraded = Object.create(Error.prototype) as object;
    repairPrototypeIfDegraded(degraded);
    expect(degraded instanceof OtpError).toBe(true);

    // 原生/子类场景：原型不是 Error.prototype → 一个字节都不动
    const native = new OtpError(OtpErrorCode.EMPTY_SECRET);
    repairPrototypeIfDegraded(native);
    expect(Object.getPrototypeOf(native)).toBe(OtpError.prototype);

    const sub = Object.create(OtpError.prototype) as object;
    repairPrototypeIfDegraded(sub);
    expect(Object.getPrototypeOf(sub)).toBe(OtpError.prototype);
  });

  it("otpFailUsesRegisteredFactory", () => {
    setErrorFactory((code: string) => new OtpError(code as never, code));
    let thrown: unknown = null;
    try {
      otpFail(OtpErrorCode.INVALID_TOKEN);
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof OtpError).toBe(true);
    expect((thrown as OtpError).code).toBe("INVALID_TOKEN");
  });

  it("otpFailFallsBackWhenFactoryReturnsNonError", () => {
    // 平台工厂实现越界（返回字符串）时，调用方仍必须拿到 Error + code
    setErrorFactory(() => "not-an-error" as unknown as Error);
    let thrown: unknown = null;
    try {
      otpFail(OtpErrorCode.CRYPTO_FAILED);
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof Error).toBe(true);
    expect(thrown instanceof OtpError).toBe(true);
    expect((thrown as OtpError).code).toBe("CRYPTO_FAILED");
    expect((thrown as OtpError).codeString).toBe("CRYPTO_FAILED");
  });

  it("resetErrorFactoryRestoresDefault", () => {
    setErrorFactory((code: string) => new OtpError(code as never, "custom"));
    resetErrorFactory();
    let thrown: unknown = null;
    try {
      otpFail(OtpErrorCode.NOT_IMPLEMENTED);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as OtpError).message).toBe("NOT_IMPLEMENTED");
  });
});
