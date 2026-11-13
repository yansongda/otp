/**
 * 平台层契约测试：只验证「注册 + 类型桥 + 公开 API 行为」。
 * 算法细节（RFC 向量、base32、URI 边界）由 packages/core 的测试承接，避免双份维护。
 */
import { describe, expect, it } from "bun:test";
import {
  HOTP,
  MAX_VERIFY_WINDOW,
  OTPAuthURI,
  OtpAlgorithm,
  OtpError,
  OtpErrorCode,
  OtpType,
  Secret,
  TOTP,
} from "../src/index";

/** 期望抛出指定错误码（断言 code 比消息匹配更精确）。 */
function thrownCode(fn: () => unknown): string {
  try {
    fn();
    return "NO_THROW";
  } catch (error) {
    return (error as OtpError).code;
  }
}

describe("platform barrel", () => {
  it("exports public symbols", () => {
    expect(typeof HOTP).toBe("function");
    expect(typeof TOTP).toBe("function");
    expect(typeof Secret).toBe("function");
    expect(typeof OTPAuthURI.parse).toBe("function");
    expect(OtpAlgorithm.SHA1).toBe("SHA1");
    expect(OtpType.TOTP).toBe("totp");
  });

  it("routes core failures through platform OtpError", () => {
    let thrown: unknown = null;
    try {
      new TOTP({ secret: "" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof OtpError).toBe(true);
    expect((thrown as OtpError).code).toBe(OtpErrorCode.EMPTY_SECRET);
  });

  it("generates RFC 6238 SHA1 vector (t=59s -> 287082)", () => {
    const totp = new TOTP({ secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" });
    expect(totp.generate(59 * 1000)).toBe("287082");
  });

  it("generates RFC 4226 HOTP vector (counter=0 -> 755224)", () => {
    const hotp = new HOTP({ secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" });
    expect(hotp.generate(0)).toBe("755224");
  });

  it("verify returns hit delta", () => {
    const totp = new TOTP({ secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" });
    const token = totp.generate(59 * 1000);
    expect(totp.verify(token, { timestamp: 59 * 1000 })).toBe(0);
    expect(totp.verify("000000", { timestamp: 59 * 1000 })).toBe(null);
  });

  it("toURI / fromURI round-trip", () => {
    const totp = new TOTP({
      secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      issuer: "ACME",
      account: "alice@acme.com",
    });
    const uri = totp.toURI();
    const parsed = TOTP.fromURI(uri);
    expect(parsed.generate(59 * 1000)).toBe(totp.generate(59 * 1000));
    expect(parsed.toURI()).toBe(uri);
  });

  it("Secret.generate requires an injected random source", () => {
    let thrown: unknown = null;
    try {
      Secret.generate();
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof OtpError).toBe(true);
    expect((thrown as OtpError).code).toBe(OtpErrorCode.CRYPTO_NOT_INITIALIZED);
  });

  it("Secret redacts toJSON and hides toString", () => {
    const secret = Secret.fromBase32("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(JSON.stringify(secret)).toBe('"[REDACTED]"');
    expect(secret.toBase32()).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("OTPAuthURI parse returns platform-shaped params", () => {
    const params = OTPAuthURI.parse(
      "otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60",
    );
    expect(params.type).toBe(OtpType.TOTP);
    expect(params.algorithm).toBe(OtpAlgorithm.SHA256);
    expect(params.digits).toBe(8);
    expect(params.period).toBe(60);
    expect(params.issuer).toBe("ACME");
  });
  it("errorCodes come from core and stay in sync", () => {
    // 平台不再手抄码表：取值集合由 @yansongda/otp-core 唯一提供
    expect(Object.keys(OtpErrorCode).length).toBe(21);
    expect(OtpErrorCode.INVALID_SECRET_LENGTH).toBe("INVALID_SECRET_LENGTH");
    expect(OtpErrorCode.INVALID_CLOCK_OFFSET).toBe("INVALID_CLOCK_OFFSET");
    expect(OtpErrorCode.INVALID_MIN_SECRET_BITS).toBe(
      "INVALID_MIN_SECRET_BITS",
    );
    expect(MAX_VERIFY_WINDOW).toBe(10);
  });

  it("invalid parameters use dedicated codes", () => {
    // 参数口径：安全整数 / fail-closed；每类错误独立码
    expect(
      thrownCode(
        () => new TOTP({ secret: "JBSWY3DPEHPK3PXP", clockOffsetMs: 0.5 }),
      ),
    ).toBe("INVALID_CLOCK_OFFSET");
    expect(
      thrownCode(
        () =>
          new TOTP({ secret: "JBSWY3DPEHPK3PXP", minSecretBits: Number.NaN }),
      ),
    ).toBe("INVALID_MIN_SECRET_BITS");
  });

  it("OtpError keeps codeString and supports subclassing", () => {
    const err = new OtpError(OtpErrorCode.INVALID_DIGITS, "INVALID_DIGITS");
    expect(err.codeString).toBe("INVALID_DIGITS");

    // 子类场景：构造函数只在原型退化时才 setPrototypeOf，不得把子类原型改回基类
    class SubOtpError extends OtpError {
      detail(): string {
        return "detail";
      }
    }
    const sub = new SubOtpError(OtpErrorCode.EMPTY_SECRET, "EMPTY_SECRET");
    expect(Object.getPrototypeOf(sub)).toBe(SubOtpError.prototype);
    expect(sub instanceof SubOtpError).toBe(true);
    expect(sub.detail()).toBe("detail");
  });

  it("OTPAuthURI build validates like parse", () => {
    // 产物必须能被 parse 接受：非法 type / digits 不得静默输出
    let thrown: unknown = null;
    try {
      OTPAuthURI.build({
        type: "TOTP" as OtpType,
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: OtpAlgorithm.SHA1,
        digits: 6,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof OtpError).toBe(true);
    expect((thrown as OtpError).code).toBe(
      OtpErrorCode.UNSUPPORTED_OTPAUTH_TYPE,
    );
  });
  it("verify options are narrowed per class", () => {
    const totp = new TOTP({ secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" });
    const hotp = new HOTP({ secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" });
    // 类型层契约：给 TOTP 传 counter / 给 HOTP 传 timestamp 必须编译失败（core 会静默忽略）
    // @ts-expect-error TOTP.verify 不接受 counter
    totp.verify("287082", { counter: 1 });
    // @ts-expect-error HOTP.verify 不接受 timestamp
    hotp.verify("755224", { timestamp: 59000 });
    // 合法字段仍然可用（window 上限 10）
    expect(totp.verify("287082", { timestamp: 59000, window: 10 })).toBe(0);
    expect(hotp.verify("755224", { counter: 0 })).toBe(0);
    expect(
      thrownCode(() => totp.verify("287082", { timestamp: 59000, window: 11 })),
    ).toBe("INVALID_WINDOW");
  });
});
