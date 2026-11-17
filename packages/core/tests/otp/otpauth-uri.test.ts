/**
 * otpauth:// URI 解析 / 生成 / round-trip 测试（Google Authenticator Key URI Format）。
 */
import { describe, expect, it } from "bun:test";
import type { OtpAuthParams } from "../../src/options";
import { OtpAlgorithm, OtpType } from "../../src/options";
import { OTPAuthURI } from "../../src/otpauth-uri";
import { expectCode } from "./helpers";

describe("otpauth-uri", () => {
  it("parse_standardTotpAllFields", () => {
    const p = OTPAuthURI.parse(
      "otpauth://totp/ACME%20Co:john@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60",
    );
    expect(p.type).toBe(OtpType.TOTP);
    expect(p.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(p.algorithm).toBe(OtpAlgorithm.SHA256);
    expect(p.digits).toBe(8);
    expect(p.period).toBe(60);
    expect(p.issuer).toBe("ACME Co");
    expect(p.account).toBe("john@example.com");
  });

  it("parse_missingOptionalDefaults", () => {
    const p = OTPAuthURI.parse("otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP");
    expect(p.algorithm).toBe(OtpAlgorithm.SHA1);
    expect(p.digits).toBe(6);
    expect(p.period).toBe(30);
    expect(p.account).toBe("alice");
  });

  it("parse_hotpWithCounter", () => {
    const p = OTPAuthURI.parse(
      "otpauth://hotp/ACME%20Co:alice?secret=JBSWY3DPEHPK3PXP&counter=42",
    );
    expect(p.type).toBe(OtpType.HOTP);
    expect(p.counter).toBe(42);
    expect(p.period).toBeUndefined();
  });

  it("parse_unknownParamsIgnored", () => {
    const p = OTPAuthURI.parse(
      "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&image=foo.png&lock=true",
    );
    expect(p.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(p.digits).toBe(6);
  });

  it("parse_uppercaseScheme", () => {
    const p = OTPAuthURI.parse("OTPAUTH://TOTP/alice?secret=JBSWY3DPEHPK3PXP");
    expect(p.type).toBe(OtpType.TOTP);
    expect(p.secret).toBe("JBSWY3DPEHPK3PXP");
  });

  it("parse_queryIssuerWinsOverLabelPrefix", () => {
    const p = OTPAuthURI.parse(
      "otpauth://totp/Foo:bar?secret=JBSWY3DPEHPK3PXP&issuer=Baz",
    );
    expect(p.issuer).toBe("Baz");
    expect(p.account).toBe("bar");
  });

  it("parse_failInvalidScheme", () => {
    expectCode(
      () => OTPAuthURI.parse("http://example.com/x"),
      "INVALID_OTPAUTH_URI",
    );
  });

  it("parse_failUnsupportedType", () => {
    expectCode(
      () => OTPAuthURI.parse("otpauth://steam/alice?secret=JBSWY3DPEHPK3PXP"),
      "UNSUPPORTED_OTPAUTH_TYPE",
    );
  });

  it("parse_failMissingSecret", () => {
    expectCode(() => OTPAuthURI.parse("otpauth://totp/alice"), "EMPTY_SECRET");
  });

  it("parse_failInvalidAlgorithm", () => {
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&algorithm=MD5",
        ),
      "INVALID_ALGORITHM",
    );
  });

  it("parse_failInvalidDigits", () => {
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&digits=5",
        ),
      "INVALID_DIGITS",
    );
  });

  it("parse_failInvalidPeriod", () => {
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&period=0",
        ),
      "INVALID_PERIOD",
    );
  });

  it("parse_failInvalidCounter", () => {
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://hotp/alice?secret=JBSWY3DPEHPK3PXP&counter=-1",
        ),
      "INVALID_COUNTER",
    );
  });

  it("parse_strictAcceptsCanonicalSecret", () => {
    const p = OTPAuthURI.parse(
      "otpauth://totp/alice?secret=jbswy3dpehpk3pxp&digits=8",
      { strict: true },
    );
    expect(p.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(p.digits).toBe(8);
    expect(p.period).toBe(30);
  });

  it("parse_strictRejectsNonCanonicalSecret", () => {
    expectCode(
      () =>
        OTPAuthURI.parse("otpauth://totp/alice?secret=MZXW6YT", {
          strict: true,
        }),
      "INVALID_BASE32_PADDING",
    );
  });

  it("parse_defaultStaysLenientOnSameUri", () => {
    const p = OTPAuthURI.parse("otpauth://totp/alice?secret=MZXW6YT");
    expect(p.secret).toBe("MZXW6YQ");
  });

  it("parse_percentDecodeFailureFallsBackToRaw", () => {
    // '%ZZ' 无法百分号解码：回退原串，不应抛错
    const p = OTPAuthURI.parse(
      "otpauth://totp/alice%ZZ?secret=JBSWY3DPEHPK3PXP",
    );
    expect(p.account).toBe("alice%ZZ");
  });

  it("parse_percentEncodedColonAndSlash", () => {
    const p = OTPAuthURI.parse(
      "otpauth://totp/My%20Issuer%3Auser%2Fname?secret=JBSWY3DPEHPK3PXP&issuer=My%20Issuer",
    );
    expect(p.issuer).toBe("My Issuer");
    expect(p.account).toBe("user/name");
  });

  it("build_exactTotpFullOutput", () => {
    expect(
      OTPAuthURI.build({
        type: OtpType.TOTP,
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: OtpAlgorithm.SHA256,
        digits: 8,
        period: 60,
        issuer: "ACME Co",
        account: "john@example.com",
      }),
    ).toBe(
      "otpauth://totp/ACME%20Co:john%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60",
    );
  });

  it("build_exactMinimalTotpOutput", () => {
    expect(
      OTPAuthURI.build({
        type: OtpType.TOTP,
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: OtpAlgorithm.SHA1,
        digits: 6,
      }),
    ).toBe("otpauth://totp/?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1");
  });

  it("build_exactHotpOutput", () => {
    expect(
      OTPAuthURI.build({
        type: OtpType.HOTP,
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: OtpAlgorithm.SHA1,
        digits: 6,
        counter: 42,
        issuer: "ACME Co",
        account: "alice",
      }),
    ).toBe(
      "otpauth://hotp/ACME%20Co:alice?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA1&counter=42",
    );
  });

  it("build_normalizesSecret", () => {
    expect(
      OTPAuthURI.build({
        type: OtpType.TOTP,
        secret: "jbswy3dpeh pk3pxp=",
        algorithm: OtpAlgorithm.SHA1,
        digits: 6,
      }),
    ).toBe("otpauth://totp/?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1");
  });

  it("build_invalidSecretChar_throws", () => {
    expectCode(
      () =>
        OTPAuthURI.build({
          type: OtpType.TOTP,
          secret: "JBSW!@#",
          algorithm: OtpAlgorithm.SHA1,
          digits: 6,
        }),
      "INVALID_BASE32_CHAR",
    );
  });

  it("roundtrip_totpFullFields", () => {
    const p = {
      type: OtpType.TOTP,
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: OtpAlgorithm.SHA512,
      digits: 8,
      period: 60,
      issuer: "ACME Co",
      account: "john@example.com",
    } as const;
    const back = OTPAuthURI.parse(OTPAuthURI.build(p));
    expect(back.type).toBe(p.type);
    expect(back.secret).toBe(p.secret);
    expect(back.algorithm).toBe(p.algorithm);
    expect(back.digits).toBe(p.digits);
    expect(back.period).toBe(p.period);
    expect(back.issuer).toBe(p.issuer);
    expect(back.account).toBe(p.account);
  });

  it("roundtrip_hotp", () => {
    const p = {
      type: OtpType.HOTP,
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: OtpAlgorithm.SHA1,
      digits: 6,
      counter: 42,
      issuer: "ACME Co",
      account: "alice",
    } as const;
    const back = OTPAuthURI.parse(OTPAuthURI.build(p));
    expect(back.type).toBe(p.type);
    expect(back.secret).toBe(p.secret);
    expect(back.counter).toBe(p.counter);
    expect(back.period).toBeUndefined();
  });

  it("roundtrip_minimalRequired", () => {
    const p = {
      type: OtpType.TOTP,
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: OtpAlgorithm.SHA1,
      digits: 6,
    } as const;
    const back = OTPAuthURI.parse(OTPAuthURI.build(p));
    expect(back.period).toBe(30);
    expect(back.account).toBeUndefined();
    expect(back.issuer).toBeUndefined();
  });
  it("build_unsupportedType_throws", () => {
    // type 只认小写 totp/hotp：奇形怪状的值不得静默变成 hotp
    expectCode(
      () =>
        OTPAuthURI.build({
          type: "TOTP",
          secret: "JBSWY3DPEHPK3PXP",
          algorithm: OtpAlgorithm.SHA1,
          digits: 6,
        }),
      "UNSUPPORTED_OTPAUTH_TYPE",
    );
  });

  it("build_invalidAlgorithm_throws", () => {
    expectCode(
      () =>
        OTPAuthURI.build({
          type: OtpType.TOTP,
          secret: "JBSWY3DPEHPK3PXP",
          algorithm: "sha1",
          digits: 6,
        }),
      "INVALID_ALGORITHM",
    );
  });

  it("build_invalidDigits_throws", () => {
    expectCode(
      () =>
        OTPAuthURI.build({
          type: OtpType.TOTP,
          secret: "JBSWY3DPEHPK3PXP",
          algorithm: OtpAlgorithm.SHA1,
          digits: 5,
        }),
      "INVALID_DIGITS",
    );
  });

  it("build_invalidPeriod_throws", () => {
    for (const period of [0, -30, 1.5, Number.NaN]) {
      expectCode(
        () =>
          OTPAuthURI.build({
            type: OtpType.TOTP,
            secret: "JBSWY3DPEHPK3PXP",
            algorithm: OtpAlgorithm.SHA1,
            digits: 6,
            period,
          }),
        "INVALID_PERIOD",
      );
    }
  });

  it("build_invalidCounter_throws", () => {
    for (const counter of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expectCode(
        () =>
          OTPAuthURI.build({
            type: OtpType.HOTP,
            secret: "JBSWY3DPEHPK3PXP",
            algorithm: OtpAlgorithm.SHA1,
            digits: 6,
            counter,
          }),
        "INVALID_COUNTER",
      );
    }
  });

  it("build_ignoresLabelField", () => {
    // label 是 parse 的回填字段；build 一律由 issuer/account 派生
    expect(
      OTPAuthURI.build({
        type: OtpType.TOTP,
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: OtpAlgorithm.SHA1,
        digits: 6,
        label: "custom:label",
        issuer: "ACME",
        account: "alice",
      }),
    ).toBe(
      "otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP&issuer=ACME&algorithm=SHA1",
    );
  });

  it("parse_counterUnsafe_throws", () => {
    // counter 必须与 HOTP 构造器/build 同口径：> 2^53-1 的整数会丢精度，直接拒绝
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://hotp/alice?secret=JBSWY3DPEHPK3PXP&counter=9007199254740993",
        ),
      "INVALID_COUNTER",
    );
  });

  it("parse_periodUnsafe_throws", () => {
    // period 必须是正安全整数：超大值语义上等同配置错误
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&period=1e300",
        ),
      "INVALID_PERIOD",
    );
  });

  it("parse_nonDecimalNumerics_throw", () => {
    // 导入边界只认纯十进制：0x / 科学计数 / 小数一律拒绝（Number() 会把它们静默放宽）
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&digits=0x7",
        ),
      "INVALID_DIGITS",
    );
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&digits=6.0",
        ),
      "INVALID_DIGITS",
    );
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&period=0x1E",
        ),
      "INVALID_PERIOD",
    );
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&period=1e3",
        ),
      "INVALID_PERIOD",
    );
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://hotp/alice?secret=JBSWY3DPEHPK3PXP&counter=0x2A",
        ),
      "INVALID_COUNTER",
    );
    // 前导零仍是十进制：「000042」→ 42
    expect(
      OTPAuthURI.parse(
        "otpauth://hotp/alice?secret=JBSWY3DPEHPK3PXP&counter=000042",
      ).counter,
    ).toBe(42);
  });

  it("parse_multiInvalid_followsPriorityTable", () => {
    // errors.ts parse 顺序：URI → type → secret → algorithm → digits → period|counter
    expectCode(
      () =>
        OTPAuthURI.parse("otpauth://foo/x?secret=AB1&algorithm=MD5&digits=5"),
      "UNSUPPORTED_OTPAUTH_TYPE",
    );
    expectCode(
      () =>
        OTPAuthURI.parse("otpauth://totp/x?secret=AB1&algorithm=MD5&digits=5"),
      "INVALID_BASE32_CHAR",
    );
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5&digits=5",
        ),
      "INVALID_ALGORITHM",
    );
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=5&period=0",
        ),
      "INVALID_DIGITS",
    );
  });

  it("build_secretErrorPrecedesParamErrors", () => {
    // errors.ts 优先级：解析类先于参数类（与 parse 对称）
    expectCode(
      () =>
        OTPAuthURI.build({
          type: OtpType.TOTP,
          secret: "!!!",
          algorithm: "MD5",
          digits: 5,
        }),
      "INVALID_BASE32_CHAR",
    );
    expectCode(
      () =>
        OTPAuthURI.build({
          type: OtpType.TOTP,
          secret: "JBSWY3DPEHPK3PXP",
          algorithm: "MD5",
          digits: 5,
        }),
      "INVALID_ALGORITHM",
    );
  });

  it("build_parse_roundTripStable", () => {
    // 合法域内：parse(build(x)) 与 build(parse(uri)) 必须稳定（对称校验的回归锁）
    const params = {
      type: OtpType.TOTP,
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: OtpAlgorithm.SHA256,
      digits: 8,
      period: 60,
      issuer: "ACME Co",
      account: "alice",
    };
    const built = OTPAuthURI.build(params);
    const parsed = OTPAuthURI.parse(built);
    expect(OTPAuthURI.build(parsed)).toBe(built);

    const hotpUri =
      "otpauth://hotp/alice?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&counter=42";
    expect(OTPAuthURI.build(OTPAuthURI.parse(hotpUri))).toBe(hotpUri);
  });

  it("parse_issuerWithColon_staysWhole", () => {
    // build 把 issuer 内部的冒号编码为 %3A；parse 必须先按原始串切分再逐段解码，
    // 否则 issuer 会被冒号截断（build → parse 往返丢 issuer）
    const built = OTPAuthURI.build({
      type: OtpType.TOTP,
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: OtpAlgorithm.SHA1,
      digits: 6,
      issuer: "AC:ME",
      account: "alice",
    });
    expect(built).toBe(
      "otpauth://totp/AC%3AME:alice?secret=JBSWY3DPEHPK3PXP&issuer=AC%3AME&algorithm=SHA1",
    );
    const parsed = OTPAuthURI.parse(built);
    expect(parsed.issuer).toBe("AC:ME");
    expect(parsed.account).toBe("alice");
  });

  it("parse_legacyEncodedSeparatorIsCaseInsensitive", () => {
    // 兼容把分隔符整体编码为 %3A / %3a 的 URI（issuer%3Aaccount）：
    // 仅当 query issuer 存在且与 label 前缀一致时才拆分（且大小写不敏感）
    const upper = OTPAuthURI.parse(
      "otpauth://totp/ACME%3Aco@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME",
    );
    expect(upper.issuer).toBe("ACME");
    expect(upper.account).toBe("co@example.com");

    const lower = OTPAuthURI.parse(
      "otpauth://totp/ACME%3aco@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME",
    );
    expect(lower.issuer).toBe("ACME");
    expect(lower.account).toBe("co@example.com");

    // 无 query issuer 时不能猜：规范语义下整段 label 就是 account（数据不丢）
    const noIssuer = OTPAuthURI.parse(
      "otpauth://totp/ACME%3Aco@example.com?secret=JBSWY3DPEHPK3PXP",
    );
    expect(noIssuer.issuer).toBeUndefined();
    expect(noIssuer.account).toBe("ACME:co@example.com");
  });

  it("build_issuerOnly_doesNotEmitLabel", () => {
    // 规范里无原始冒号的 label 就是 account；issuer 为空 account 时不能把 issuer 写进 label
    const uri = OTPAuthURI.build({
      type: OtpType.TOTP,
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: OtpAlgorithm.SHA1,
      digits: 6,
      issuer: "ACME",
    });
    expect(uri).toBe(
      "otpauth://totp/?secret=JBSWY3DPEHPK3PXP&issuer=ACME&algorithm=SHA1",
    );
    const p = OTPAuthURI.parse(uri);
    expect(p.issuer).toBe("ACME");
    expect(p.account).toBeUndefined();
  });

  it("build_accountWithColon_roundTrips", () => {
    // account 内的冒号编码为 %3A；parse 无原始冒号时不得再把它当分隔符
    for (const account of ["a:b", "a:b:c", "ACME:a"]) {
      const uri = OTPAuthURI.build({
        type: OtpType.TOTP,
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: OtpAlgorithm.SHA1,
        digits: 6,
        account,
      });
      const p = OTPAuthURI.parse(uri);
      expect(p.account).toBe(account);
      expect(p.issuer).toBeUndefined();
    }
  });

  it("build_issuerWithColon_noAccount_roundTrips", () => {
    const uri = OTPAuthURI.build({
      type: OtpType.TOTP,
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: OtpAlgorithm.SHA1,
      digits: 6,
      issuer: "AC:ME",
    });
    const p = OTPAuthURI.parse(uri);
    expect(p.issuer).toBe("AC:ME");
    expect(p.account).toBeUndefined();
  });

  it("parse_nonStringUri_failsClosed", () => {
    // TS 类型只约束编译期：JS 调用方传数字 / null 时不得漏原生 TypeError
    for (const bad of [123, null, undefined, {}]) {
      expectCode(
        () => OTPAuthURI.parse(bad as unknown as string),
        "INVALID_OTPAUTH_URI",
      );
    }
  });

  it("parse_nullOptions_behavesLikeUndefined", () => {
    // `parse(uri, null)` 等价于未传 options（宽松）——不得漏原生 TypeError
    const p = OTPAuthURI.parse(
      "otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP",
      null,
    );
    expect(p.issuer).toBe("ACME");
  });

  it("parse_strictFlagIsFailClosed", () => {
    // strict 是导入边界：非 boolean（1 / "true"）同样按 strict，不能静默退化为宽松
    for (const strict of [1, "true", {}, null]) {
      expectCode(
        () =>
          OTPAuthURI.parse("otpauth://totp/x?secret=MZXW6YT", {
            strict,
          } as unknown as { strict?: boolean }),
        "INVALID_BASE32_PADDING",
      );
    }
    // 宽松模式：非规范输入被静默重编码（与 strict 的拒绝形成对照）
    expect(
      OTPAuthURI.parse("otpauth://totp/x?secret=MZXW6YT", { strict: false })
        .secret,
    ).toBe("MZXW6YQ");
  });

  it("parse_emptyIssuerQuery_keepsLabelIssuer", () => {
    // 空 query 值按「未提供」处理：不得凭空抹掉 label 里合法的 issuer
    // （与 digits / period / counter 的空值=缺省口径一致）
    const p = OTPAuthURI.parse(
      "otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP&issuer=",
    );
    expect(p.issuer).toBe("ACME");
    expect(p.account).toBe("alice");
  });

  it("build_nullParams_failsClosed", () => {
    // JS 调用方传 null / 数组：不得漏「params.type」原生 TypeError
    for (const bad of [null, undefined, 5]) {
      expectCode(
        () => OTPAuthURI.build(bad as unknown as OtpAuthParams),
        "INVALID_OTPAUTH_URI",
      );
    }
  });

  it("build_nonStringSecret_failsClosed", () => {
    // 非字符串 secret 属「secret 容器类型不对」，与 fromBase32 / fromBytes 同码
    expectCode(
      () =>
        OTPAuthURI.build({
          type: OtpType.TOTP,
          secret: 123 as unknown as string,
          algorithm: OtpAlgorithm.SHA1,
          digits: 6,
        }),
      "INVALID_SECRET_CONTAINER",
    );
  });

  it("build_nonStringIssuerOrAccount_failsClosed", () => {
    // null 绝不得静默变成 "null" 写进 URI（issuer 与 account 两个位置都要拦）
    expectCode(
      () =>
        OTPAuthURI.build({
          type: OtpType.TOTP,
          secret: "JBSWY3DPEHPK3PXP",
          algorithm: OtpAlgorithm.SHA1,
          digits: 6,
          issuer: null as unknown as string,
          account: "bob",
        }),
      "INVALID_OTPAUTH_URI",
    );
    expectCode(
      () =>
        OTPAuthURI.build({
          type: OtpType.TOTP,
          secret: "JBSWY3DPEHPK3PXP",
          algorithm: OtpAlgorithm.SHA1,
          digits: 6,
          issuer: "ACME",
          account: null as unknown as string,
        }),
      "INVALID_OTPAUTH_URI",
    );
  });

  it("build_unencodableLabel_failsClosed", () => {
    // 孤立代理字符（如被 slice 截断的 emoji）会让 encodeURIComponent 抛原生 URIError；
    // 公开契约是「一切失败均抛 OtpError」，这里收敛为 INVALID_OTPAUTH_URI
    expectCode(
      () =>
        OTPAuthURI.build({
          type: OtpType.TOTP,
          secret: "JBSWY3DPEHPK3PXP",
          algorithm: OtpAlgorithm.SHA1,
          digits: 6,
          account: "👨‍👩‍👧".slice(0, 1),
        }),
      "INVALID_OTPAUTH_URI",
    );
    expectCode(
      () =>
        OTPAuthURI.build({
          type: OtpType.TOTP,
          secret: "JBSWY3DPEHPK3PXP",
          algorithm: OtpAlgorithm.SHA1,
          digits: 6,
          issuer: "\uD800",
        }),
      "INVALID_OTPAUTH_URI",
    );
  });

  it("parse_legacySeparator_survivesCaseExpandingChars", () => {
    // 'İ' 小写后会多出一个组合字符（长度变化），旧实现用 toLowerCase 取下标会错位，
    // 把历史分隔符识别失败；这里改用大小写不敏感的手工扫描，必须仍能切开
    const p = OTPAuthURI.parse(
      "otpauth://totp/%C4%B0%3Aacct%3Abob?secret=JBSWY3DPEHPK3PXP&issuer=%C4%B0",
    );
    expect(p.issuer).toBe("İ");
    expect(p.account).toBe("acct:bob");
  });

  it("parse_inapplicableParamsAreIgnored", () => {
    // type 不适用的参数被忽略（TOTP 的 counter / HOTP 的 period）；取值不影响结果
    const totp = OTPAuthURI.parse(
      "otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&counter=42",
    );
    expect(totp.counter).toBeUndefined();
    expect(totp.period).toBe(30);
    const hotp = OTPAuthURI.parse(
      "otpauth://hotp/a?secret=JBSWY3DPEHPK3PXP&period=60",
    );
    expect(hotp.period).toBeUndefined();
    expect(hotp.counter).toBe(0);
  });
});
