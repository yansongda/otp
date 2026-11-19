/**
 * otpauth:// URI 解析 / 生成 / round-trip 测试（Google Authenticator Key URI Format）。
 */
import { describe, expect, it } from "bun:test";
import type { OtpAuthParams } from "../../src/options";
import { OtpAlgorithm, OtpType } from "../../src/options";
import { OTPAuthURI } from "../../src/otpauth-uri";
import { expectCode } from "./helpers";

/**
 * 造「运行时非法」的 build 入参：TS 类型已强制 account 必填，但 JS 调用方（含 JSON 反序列化）
 * 仍可能漏字段 —— 这条路径必须继续 fail-closed。
 */
function asParams(raw: Record<string, unknown>): OtpAuthParams {
  return raw as unknown as OtpAuthParams;
}

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
    // 最小必填集 = type / secret / algorithm / digits / account（label 必填）
    expect(
      OTPAuthURI.build({
        type: OtpType.TOTP,
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: OtpAlgorithm.SHA1,
        digits: 6,
        account: "alice",
      }),
    ).toBe("otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1");
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
        account: "alice",
      }),
    ).toBe("otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1");
  });

  it("build_invalidSecretChar_throws", () => {
    expectCode(
      () =>
        OTPAuthURI.build({
          type: OtpType.TOTP,
          secret: "JBSW!@#",
          algorithm: OtpAlgorithm.SHA1,
          digits: 6,
          account: "alice",
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
      account: "alice",
    } as const;
    const back = OTPAuthURI.parse(OTPAuthURI.build(p));
    expect(back.period).toBe(30);
    expect(back.account).toBe("alice");
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
          account: "alice",
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
          account: "alice",
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
          account: "alice",
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
            account: "alice",
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
            account: "alice",
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
          account: "alice",
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
          account: "alice",
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

  it("build_colonInAccount_failsClosed", () => {
    // label 段不得含冒号（ABNF 明文 "Neither issuer nor account name may themselves contain
    // a colon"）：account 段的冒号无论怎么编码都会被规范解析器当分隔符切开 → 不可表示
    const base = {
      type: OtpType.TOTP,
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: OtpAlgorithm.SHA1,
      digits: 6,
    };
    for (const extra of [
      { issuer: "ACME", account: "a:b" },
      { account: "a:b" },
    ]) {
      expectCode(
        () => OTPAuthURI.build({ ...base, ...extra }),
        "INVALID_OTPAUTH_URI",
      );
    }
  });

  it("build_colonInIssuer_omitsLabelPrefix", () => {
    // issuer **参数**允许冒号（RFC 3986 pchar），label 前缀不允许 → 省略前缀即可无损往返
    const params = {
      type: OtpType.TOTP,
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: OtpAlgorithm.SHA1,
      digits: 6,
      issuer: "AC:ME",
      account: "alice",
    };
    const uri = OTPAuthURI.build(params);
    expect(uri).toBe(
      "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&issuer=AC%3AME&algorithm=SHA1",
    );
    const back = OTPAuthURI.parse(uri);
    expect(back.issuer).toBe("AC:ME");
    expect(back.account).toBe("alice");
    expect(OTPAuthURI.build(back)).toBe(uri);
  });

  it("parse_percent3ASeparatorIsSeparator", () => {
    // ABNF 里分隔符是 `:` 或 `%3A`（大小写不敏感），与 query 里有没有 issuer 无关
    for (const label of ["ACME%3Aco@example.com", "ACME%3aco@example.com"]) {
      const p = OTPAuthURI.parse(
        `otpauth://totp/${label}?secret=JBSWY3DPEHPK3PXP`,
      );
      expect(p.issuer).toBe("ACME");
      expect(p.account).toBe("co@example.com");
    }

    // query issuer 存在但与 label 前缀不一致：规范要求两者相等（属签发方数据问题），
    // 不改变分隔符判定；issuer 量仍以 query 为准
    const mismatch = OTPAuthURI.parse(
      "otpauth://totp/ACME%3Aalice?secret=JBSWY3DPEHPK3PXP&issuer=OTHER",
    );
    expect(mismatch.issuer).toBe("OTHER");
    expect(mismatch.account).toBe("alice");
  });

  it("parse_specExampleWithSpacePadding", () => {
    // 规范自带示例：Big%20Corporation%3A%20alice%40bigco.com
    // ABNF 的 `*"%20"` 表示分隔符后的空格是 padding，不属于 account
    const p = OTPAuthURI.parse(
      "otpauth://totp/Big%20Corporation%3A%20alice%40bigco.com?secret=JBSWY3DPEHPK3PXP&issuer=Big%20Corporation",
    );
    expect(p.issuer).toBe("Big Corporation");
    expect(p.account).toBe("alice@bigco.com");
  });

  it("parse_colonInAccount_failsClosed", () => {
    // label 段不得含冒号（规范明文 + draft-andesco-otpauth-uri-01 §3.1 的 consumer MUST reject）：
    // 「首个分隔符」切分之后，残余冒号必然落在 account 里 —— 这种 URI 无法被规范序列化，
    // parse 与 build 必须同口径拒绝（否则 parse 出来的参数 toURI() 才炸）
    for (const uri of [
      "otpauth://totp/ACME%3Aalice:bob?secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/ACME:a%3Ab?secret=JBSWY3DPEHPK3PXP",
    ]) {
      expectCode(() => OTPAuthURI.parse(uri), "INVALID_OTPAUTH_URI");
    }
  });

  it("parse_issuerQueryMayContainColon", () => {
    // issuer **参数**是 pchar（RFC 3986 允许冒号），约束只作用于 label 段：
    // 这种 URI 合法，且 build 会省略 label 前缀（前缀写不下冒号）—— 往返不丢数据
    const p = OTPAuthURI.parse(
      "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&issuer=AC%3AME",
    );
    expect(p.issuer).toBe("AC:ME");
    expect(p.account).toBe("alice");
    expect(OTPAuthURI.build(p)).toBe(
      "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&issuer=AC%3AME&algorithm=SHA1",
    );
    expect(OTPAuthURI.parse(OTPAuthURI.build(p)).issuer).toBe("AC:ME");
  });

  it("build_leadingSpaceAccount_omitsLabelPrefix", () => {
    // 分隔符后的空格按 ABNF 是 padding（parse 会剥掉）：带 issuer 时若写前缀，
    // 前导空格会被吃掉 → build → parse 不闭合。issuer 参数才是权威，label 前缀是可选
    // 装饰，因此直接省略前缀；无 issuer 时本就没有分隔符，前导空格属于账号本身
    const base = {
      type: OtpType.TOTP,
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: OtpAlgorithm.SHA1,
      digits: 6,
    };
    const withIssuer = OTPAuthURI.build({
      ...base,
      issuer: "ACME",
      account: " alice",
    });
    expect(withIssuer).toBe(
      "otpauth://totp/%20alice?secret=JBSWY3DPEHPK3PXP&issuer=ACME&algorithm=SHA1",
    );
    const back = OTPAuthURI.parse(withIssuer);
    expect(back.issuer).toBe("ACME");
    expect(back.account).toBe(" alice");

    const uri = OTPAuthURI.build({ ...base, account: " alice" });
    expect(uri).toBe(
      "otpauth://totp/%20alice?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1",
    );
    expect(OTPAuthURI.parse(uri).account).toBe(" alice");
  });

  it("build_withoutAccount_failsClosed", () => {
    // label = issuer:account，issuer 可空、account 不可空：空 label 不符合 Key URI Format，
    // 而且拿 issuer 顶 label 会被 parse 读成 account（往返凭空多出一个账号）→ 一律拒绝
    const base = {
      type: OtpType.TOTP,
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: OtpAlgorithm.SHA1,
      digits: 6,
    };
    for (const extra of [
      {},
      { issuer: "ACME" },
      { account: "" },
      { issuer: "ACME", account: "" },
    ]) {
      expectCode(
        () => OTPAuthURI.build(asParams({ ...base, ...extra })),
        "INVALID_OTPAUTH_URI",
      );
    }
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

  it("parse_schemePrefixBoundaries", () => {
    // scheme 只小写前 prefix.length 个字符（整串 toLowerCase 在大 URI 上是一次额外分配）：
    // 短串、近似前缀、错位出现都得拒；大小写混合的真前缀照常接受
    for (const bad of [
      "",
      "otpauth:/",
      "https://totp/alice?secret=JBSWY3DPEHPK3PXP",
      " otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP",
      "xotpauth://totp/alice?secret=JBSWY3DPEHPK3PXP",
    ]) {
      expectCode(() => OTPAuthURI.parse(bad), "INVALID_OTPAUTH_URI");
    }
    // 只有 scheme 通过、type 缺失 → 沿用既有码（UNSUPPORTED_OTPAUTH_TYPE）
    expectCode(
      () => OTPAuthURI.parse("otpauth://"),
      "UNSUPPORTED_OTPAUTH_TYPE",
    );
    expect(
      OTPAuthURI.parse("OtPaUtH://TOTP/alice?secret=JBSWY3DPEHPK3PXP").account,
    ).toBe("alice");
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
          account: "alice",
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
          account: "alice",
          issuer: "\uD800",
        }),
      "INVALID_OTPAUTH_URI",
    );
  });

  it("parse_separatorScan_survivesCaseExpandingChars", () => {
    // 'İ'（U+0130）小写后变成两个码位（i + U+0307），在 `labelRaw.toLowerCase()` 上取到的
    // `%3a` 下标会比原始串多 1 → 切错。注意必须是**原始**的 İ 才触发（写成 %C4%B0 是纯
    // ASCII，测不到这个 bug）；分隔符扫描改用原生 indexOf 后不再受影响
    const p = OTPAuthURI.parse(
      "otpauth://totp/İ%3Aalice?secret=JBSWY3DPEHPK3PXP",
    );
    expect(p.issuer).toBe("İ");
    expect(p.account).toBe("alice");
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

  it("parse_emptyAccount_failsClosed", () => {
    // label 必填且只能由 account 派生（Google ABNF 无空分支；草案 `account = 1*`）：
    // 空 label / 空 account 一律拒绝 —— 这是「parse 结果一定能被 build 序列化」的前提
    for (const uri of [
      "otpauth://totp/?secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/?secret=JBSWY3DPEHPK3PXP&issuer=ACME",
      "otpauth://totp/ACME:?secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/ACME:%20?secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/%3A?secret=JBSWY3DPEHPK3PXP",
    ]) {
      expectCode(() => OTPAuthURI.parse(uri), "INVALID_OTPAUTH_URI");
    }
  });

  it("parse_knownParamDuplicates_failsClosed", () => {
    // 草案：已知参数重复出现 → consumer MUST reject（不得静默「后者覆盖前者」，
    // 否则 algorithm / digits / issuer 可被后段改写）；未知参数重复仍忽略
    for (const query of [
      "secret=JBSWY3DPEHPK3PXP&secret=MZXW6YTBOI",
      "secret=JBSWY3DPEHPK3PXP&issuer=A&issuer=B",
      "SECRET=JBSWY3DPEHPK3PXP&secret=JBSWY3DPEHPK3PXP",
      "secret=JBSWY3DPEHPK3PXP&digits=6&digits=8",
      "secret=JBSWY3DPEHPK3PXP&period=30&period=60",
    ]) {
      expectCode(
        () => OTPAuthURI.parse(`otpauth://totp/alice?${query}`),
        "INVALID_OTPAUTH_URI",
      );
    }
    const unknown = OTPAuthURI.parse(
      "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&foo=1&foo=2",
    );
    expect(unknown.account).toBe("alice");
  });

  it("parse_paddingMatrix", () => {
    // ABNF 的 `*"%20"`：分隔符后零到多个 %20 都是 padding（原始空格属宽容超集，
    // 见 README 的「已知偏离」）；无分隔符时没有 padding 语义，前导空格属于账号本身
    const cases: Array<[string, string]> = [
      ["ACME:alice", "alice"],
      ["ACME:%20alice", "alice"],
      ["ACME:%20%20alice", "alice"],
      ["ACME:%20 alice", "alice"],
      ["ACME:   alice", "alice"],
      ["%20alice", " alice"],
      ["  alice", "  alice"],
    ];
    for (const [label, account] of cases) {
      const p = OTPAuthURI.parse(
        `otpauth://totp/${label}?secret=JBSWY3DPEHPK3PXP`,
      );
      expect(p.account).toBe(account);
    }
  });

  it("parse_literalPercent3A_staysInAccount", () => {
    // `%253A` 解码后是字面量 `%3A`：分隔符判定在原始串上做，且 `%3` 候选后跟的是 `5`，
    // 不构成 `%3A` —— 不能把它切成 issuer
    const uri = "otpauth://totp/ACME%253Aalice?secret=JBSWY3DPEHPK3PXP";
    const p = OTPAuthURI.parse(uri);
    expect(p.issuer).toBeUndefined();
    expect(p.account).toBe("ACME%3Aalice");
    expect(OTPAuthURI.build(p)).toBe(
      "otpauth://totp/ACME%253Aalice?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1",
    );
  });

  it("parse_loneSurrogate_failsClosed", () => {
    // JS 调用方可以传含孤立代理字符的字符串：放行的话 build 的 encodePart 会抛
    // （parse 就不满足「返回值一定可序列化」）—— 统一按「不可百分号编码」拒绝
    expectCode(
      () => OTPAuthURI.parse("otpauth://totp/\uD800?secret=JBSWY3DPEHPK3PXP"),
      "INVALID_OTPAUTH_URI",
    );
    expectCode(
      () =>
        OTPAuthURI.parse(
          "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&issuer=\uD800",
        ),
      "INVALID_OTPAUTH_URI",
    );
  });

  it("parse_buildRoundTripInvariant", () => {
    // 核心不变量：parse 成功 ⇒ build 不抛错 ⇒ 再 parse 得到同一组 label 字段。
    // 语料固定（无随机数），覆盖分隔符形态 / padding / 编码 / query 组合 / 大小写。
    const accepted = [
      "otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/ACME%3Aalice?secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/ACME%3a%20alice?secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/Big%20Corporation%3A%20alice%40bigco.com?secret=JBSWY3DPEHPK3PXP&issuer=Big%20Corporation",
      "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&issuer=AC%3AME",
      "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&issuer=",
      "otpauth://totp/%20alice?secret=JBSWY3DPEHPK3PXP&issuer=ACME",
      "otpauth://totp/%20alice?secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/ACME%253Aalice?secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/İ%3Aalice?secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/:%20alice?secret=JBSWY3DPEHPK3PXP",
      "otpauth://hotp/ACME:alice?secret=JBSWY3DPEHPK3PXP&counter=42",
      "otpauth://hotp/alice?secret=JBSWY3DPEHPK3PXP&counter=0&digits=8",
      "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&algorithm=sha256&digits=8&period=60",
      "OTPAUTH://TOTP/Alice%20Smith?SECRET=JBSWY3DPEHPK3PXP",
    ];
    for (const uri of accepted) {
      const p = OTPAuthURI.parse(uri);
      const rebuilt = OTPAuthURI.build(p);
      const again = OTPAuthURI.parse(rebuilt);
      expect(again.type).toBe(p.type);
      expect(again.issuer).toBe(p.issuer);
      expect(again.account).toBe(p.account);
      expect(again.digits).toBe(p.digits);
      expect(again.period).toBe(p.period);
      expect(again.counter).toBe(p.counter);
      // 二次序列化必须逐字稳定（幂等）
      expect(OTPAuthURI.build(again)).toBe(rebuilt);
    }
  });

  it("build_requiresAccountAtTypeLevel", () => {
    // 类型层契约：漏 account 必须编译失败（运行期仍由 build 兜底，见 build_withoutAccount_failsClosed）
    expect(() =>
      // @ts-expect-error account 必填（Key URI Format 的 label 唯一来源）
      OTPAuthURI.build({
        type: OtpType.TOTP,
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: OtpAlgorithm.SHA1,
        digits: 6,
      }),
    ).toThrow();
  });
});
