/**
 * 平台层契约测试：只验证「注册 + 类型桥 + 公开 API 行为」。
 * 算法细节（RFC 向量、base32、URI 边界）由 packages/core 的测试承接，避免双份维护。
 */
import { describe, expect, it } from "bun:test";
import {
  HOTP,
  OTPAuthURI,
  OtpAlgorithm,
  OtpError,
  OtpErrorCode,
  OtpType,
  Secret,
  TOTP,
} from "../src/index";

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
    expect((thrown as OtpError).code).toBe(
      OtpErrorCode.CRYPTO_NOT_INITIALIZED,
    );
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
});
