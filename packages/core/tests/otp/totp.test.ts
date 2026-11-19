/**
 * TOTP 公开类测试：RFC 6238 Appendix B 全量向量 + 时间偏移闭环 + 构造期校验 + URI 往返。
 */
import { describe, expect, it } from "bun:test";
import type { HmacProvider } from "../../src/crypto";
import { TOTP } from "../../src/index";
import { PureJsHmac } from "../../src/pure-js/pure-js-hmac";
import { expectCode } from "./helpers";
import {
  RFC6238_SHA1,
  RFC6238_SHA256,
  RFC6238_SHA512,
  SEEDS,
  SHA256_C0_8DIGIT,
} from "./vectors";

describe("totp", () => {
  // A.3：X=30 / T0=0 / digits=8，三算法 × 6 时间点 = 18 条
  for (const v of RFC6238_SHA1) {
    it(`rfc6238_sha1_t${v.timeSec}`, () => {
      expect(
        new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 8 }).generate(
          v.timeSec * 1000,
        ),
      ).toBe(v.code8);
    });
  }
  for (const v of RFC6238_SHA256) {
    it(`rfc6238_sha256_t${v.timeSec}`, () => {
      expect(
        new TOTP({
          secret: SEEDS.SHA256_BASE32,
          algorithm: "SHA256",
          digits: 8,
        }).generate(v.timeSec * 1000),
      ).toBe(v.code8);
    });
  }
  for (const v of RFC6238_SHA512) {
    it(`rfc6238_sha512_t${v.timeSec}`, () => {
      expect(
        new TOTP({
          secret: SEEDS.SHA512_BASE32,
          algorithm: "SHA512",
          digits: 8,
        }).generate(v.timeSec * 1000),
      ).toBe(v.code8);
    });
  }

  it("public_api_full_chain", () => {
    expect(
      new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 8 }).generate(59000),
    ).toBe("94287082");
  });

  it("digits6_period30_generate59000", () => {
    expect(
      new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 6 }).generate(59000),
    ).toBe("287082");
  });

  it("remaining_59000", () => {
    expect(new TOTP({ secret: SEEDS.SHA1_BASE32 }).remaining(59000)).toBe(1);
  });

  it("progress_15000", () => {
    expect(new TOTP({ secret: SEEDS.SHA1_BASE32 }).progress(15000)).toBe(0.5);
  });

  it("verify_positive_delta0", () => {
    expect(
      new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 6 }).verify("287082", {
        timestamp: 59000,
      }),
    ).toBe(0);
  });

  it("verify_negative_window0_prevStepCode", () => {
    expect(
      new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 6 }).verify("755224", {
        timestamp: 59000,
      }),
    ).toBeNull();
  });

  it("verify_window_delta_minus1", () => {
    expect(
      new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 6 }).verify("287082", {
        timestamp: 89000,
        window: 1,
      }),
    ).toBe(-1);
  });

  it("verify_window_delta_plus1", () => {
    expect(
      new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 6 }).verify("287082", {
        timestamp: 1000,
        window: 1,
      }),
    ).toBe(1);
  });

  it("verify_appliesClockOffset", () => {
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 6 });
    t.syncClockOffset(1);
    expect(t.clockOffsetMs).toBe(30000);
    expect(t.verify("359152", { timestamp: 59000 })).toBe(0);
  });

  it("syncClockOffset_closure_slowLocal", () => {
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 6 });
    const delta = t.verify("359152", { timestamp: 59000, window: 1 });
    expect(delta).toBe(1);
    t.syncClockOffset(delta as number);
    expect(t.clockOffsetMs).toBe(30000);
    expect(t.generate(59000)).toBe("359152");
    expect(t.verify("359152", { timestamp: 59000 })).toBe(0);
  });

  it("syncClockOffset_closure_fastLocal", () => {
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 6 });
    const delta = t.verify("287082", { timestamp: 89000, window: 1 });
    expect(delta).toBe(-1);
    t.syncClockOffset(delta as number);
    expect(t.clockOffsetMs).toBe(-30000);
    expect(t.generate(89000)).toBe("287082");
    expect(t.verify("287082", { timestamp: 89000 })).toBe(0);
  });

  it("syncClockOffset_repeatAccumulates", () => {
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 6 });
    t.syncClockOffset(1);
    t.syncClockOffset(1);
    expect(t.clockOffsetMs).toBe(60000);
    t.syncClockOffset(-3);
    expect(t.clockOffsetMs).toBe(-30000);
  });

  it("syncClockOffset_nonInteger_throws", () => {
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32 }).syncClockOffset(1.5),
      "INVALID_CLOCK_OFFSET",
    );
  });

  it("syncClockOffset_unsafeDelta_throws", () => {
    // delta 本身也必须是安全整数：2^53 已是不可精确表示的整数
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32 });
    expectCode(
      () => t.syncClockOffset(Number.MAX_SAFE_INTEGER + 1),
      "INVALID_CLOCK_OFFSET",
    );
    expect(t.clockOffsetMs).toBe(0);
  });

  it("syncClockOffset_unsafeResult_throws", () => {
    // delta × period × 1000 超出安全整数时必须在源头拒绝，
    // 否则后续以不相关的 INVALID_COUNTER / 错误码漂移的形式暴露。
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32 });
    expectCode(() => t.syncClockOffset(10 ** 15), "INVALID_CLOCK_OFFSET");
    expect(t.clockOffsetMs).toBe(0);
  });

  it("t0_1_period30_timestamp31000", () => {
    expect(
      new TOTP({
        secret: SEEDS.SHA1_BASE32,
        digits: 8,
        period: 30,
        t0: 1,
      }).generate(31000),
    ).toBe("94287082");
  });

  it("fromURI_period60_sha256_counter0", () => {
    // period=60 → generate(59000) 的 counter = floor(59/60) = 0（勿与 counter=1 的 46119246 混淆）
    const t = TOTP.fromURI(
      `otpauth://totp/alice?secret=${SEEDS.SHA256_BASE32}&algorithm=SHA256&digits=8&period=60`,
    );
    expect(t.generate(59000)).toBe(SHA256_C0_8DIGIT);
  });

  it("toURI_verbatim", () => {
    expect(
      new TOTP({
        secret: SEEDS.SHA1_BASE32,
        digits: 8,
        issuer: "ACME",
        account: "alice",
      }).toURI(),
    ).toBe(
      "otpauth://totp/ACME:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=ACME&algorithm=SHA1&digits=8",
    );
  });
  it("toURI_withoutAccount_failsClosed", () => {
    // account 是 label 的唯一来源；缺了就产不出符合规范的 URI，不静默写空 label
    for (const extra of [{}, { issuer: "ACME" }, { account: "" }]) {
      expectCode(
        () => new TOTP({ secret: SEEDS.SHA1_BASE32, ...extra }).toURI(),
        "INVALID_OTPAUTH_URI",
      );
    }
  });
  it("toURI_colonHandling", () => {
    // account 含冒号 → label 段不可表示，只能 fail-closed；
    // issuer 含冒号 → 省略 label 前缀、只写 issuer= 参数（issuer 参数是 pchar，允许冒号）
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, account: "a:b" }).toURI(),
      "INVALID_OTPAUTH_URI",
    );
    const uri = new TOTP({
      secret: SEEDS.SHA1_BASE32,
      issuer: "AC:ME",
      account: "alice",
    }).toURI();
    expect(uri.slice(0, uri.indexOf("?"))).toBe("otpauth://totp/alice");
    expect(uri).toContain("issuer=AC%3AME");
    const back = TOTP.fromURI(uri);
    expect(back.toURI()).toBe(uri);
  });

  it("fromURI_roundtrip_generate_consistent", () => {
    const original = new TOTP({
      secret: SEEDS.SHA256_BASE32,
      algorithm: "SHA256",
      digits: 8,
      period: 60,
      issuer: "ACME",
      account: "alice",
    });
    const restored = TOTP.fromURI(original.toURI());
    expect(restored.generate(59000)).toBe(original.generate(59000));
    expect(restored.generate(59000)).toBe(SHA256_C0_8DIGIT);
  });

  it("fromURI_hotpType_throws", () => {
    expectCode(
      () =>
        TOTP.fromURI(
          `otpauth://hotp/alice?secret=${SEEDS.SHA1_BASE32}&counter=0`,
        ),
      "UNSUPPORTED_OTPAUTH_TYPE",
    );
  });

  it("ctor_digits5_throws", () => {
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 5 }),
      "INVALID_DIGITS",
    );
  });

  it("ctor_period0_throws", () => {
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, period: 0 }),
      "INVALID_PERIOD",
    );
  });

  it("ctor_periodNeg_throws", () => {
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, period: -30 }),
      "INVALID_PERIOD",
    );
  });

  it("ctor_t0Neg1_throws", () => {
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, t0: -1 }),
      "INVALID_T0",
    );
  });

  it("ctor_t0Fraction_throws", () => {
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, t0: 1.5 }),
      "INVALID_T0",
    );
  });

  it("ctor_clockOffsetFraction_throws", () => {
    // 小数毫秒偏移无意义：构造期即拒绝，避免运行时以 INVALID_COUNTER 暴露
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, clockOffsetMs: 0.5 }),
      "INVALID_CLOCK_OFFSET",
    );
  });

  it("ctor_clockOffsetUnsafe_throws", () => {
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, clockOffsetMs: 1e300 }),
      "INVALID_CLOCK_OFFSET",
    );
    expectCode(
      () =>
        new TOTP({
          secret: SEEDS.SHA1_BASE32,
          clockOffsetMs: Number.MAX_SAFE_INTEGER + 1,
        }),
      "INVALID_CLOCK_OFFSET",
    );
  });

  it("ctor_clockOffsetNaN_throws", () => {
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, clockOffsetMs: Number.NaN }),
      "INVALID_CLOCK_OFFSET",
    );
  });

  it("ctor_clockOffsetInfinity_throws", () => {
    expectCode(
      () =>
        new TOTP({
          secret: SEEDS.SHA1_BASE32,
          clockOffsetMs: Number.POSITIVE_INFINITY,
        }),
      "INVALID_CLOCK_OFFSET",
    );
  });

  it("ctor_algorithmInvalid_throws", () => {
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, algorithm: "MD5" as "SHA1" }),
      "INVALID_ALGORITHM",
    );
  });

  it("ctor_minSecretBits128_80bit_throws", () => {
    expectCode(
      () => new TOTP({ secret: "JBSWY3DPEHPK3PXP", minSecretBits: 128 }),
      "SECRET_TOO_WEAK",
    );
  });

  it("ctor_minSecretBits128_160bit_ok", () => {
    expect(
      new TOTP({
        secret: SEEDS.SHA1_BASE32,
        digits: 6,
        minSecretBits: 128,
      }).generate(59000),
    ).toBe("287082");
  });

  it("ctor_periodUnsafe_throws", () => {
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, period: 1e300 }),
      "INVALID_PERIOD",
    );
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, t0: 1e300 }),
      "INVALID_T0",
    );
  });

  it("ctor_multiInvalid_followsPriorityTable", () => {
    // errors.ts 构造 TOTP 顺序：secret → algorithm → digits → minSecretBits →
    // SECRET_TOO_WEAK → period → t0 → clockOffsetMs。
    expectCode(
      () =>
        new TOTP({
          secret: "AB1",
          algorithm: "MD5",
          digits: 5,
          minSecretBits: Number.NaN,
          period: 0,
          t0: -1,
          clockOffsetMs: 0.5,
        }),
      "INVALID_BASE32_CHAR",
    );
    expectCode(
      () =>
        new TOTP({
          secret: SEEDS.SHA1_BASE32,
          algorithm: "MD5",
          digits: 5,
          period: 0,
        }),
      "INVALID_ALGORITHM",
    );
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 5, period: 0 }),
      "INVALID_DIGITS",
    );
    expectCode(
      () =>
        new TOTP({
          secret: SEEDS.SHA1_BASE32,
          minSecretBits: Number.NaN,
          period: 0,
        }),
      "INVALID_MIN_SECRET_BITS",
    );
    expectCode(
      () =>
        new TOTP({
          secret: SEEDS.SHA1_BASE32,
          minSecretBits: 4096,
          period: 0,
        }),
      "SECRET_TOO_WEAK",
    );
    expectCode(
      () =>
        new TOTP({
          secret: SEEDS.SHA1_BASE32,
          period: 0,
          t0: -1,
          clockOffsetMs: 0.5,
        }),
      "INVALID_PERIOD",
    );
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, t0: -1, clockOffsetMs: 0.5 }),
      "INVALID_T0",
    );
    expectCode(
      () => new TOTP({ secret: SEEDS.SHA1_BASE32, clockOffsetMs: 0.5 }),
      "INVALID_CLOCK_OFFSET",
    );
  });

  it("verify_configErrorsPrecedeTokenErrors", () => {
    // verify 顺序：timestamp → clockOffset → counter → window → token
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32 });
    expectCode(
      () => t.verify("zzz", { timestamp: -1, window: 11 }),
      "INVALID_TIMESTAMP",
    );
    expectCode(
      () => t.verify("zzz", { timestamp: 59000, window: 11 }),
      "INVALID_WINDOW",
    );
  });

  it("timeInputs_invalid_throw", () => {
    // epoch 0 合法（1970-01-01），非负安全整数之外一律拒绝（小数毫秒无意义）
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32 });
    expect(t.generate(0)).toBe("755224");
    expectCode(() => t.generate(-1), "INVALID_TIMESTAMP");
    expectCode(() => t.generate(1.5), "INVALID_TIMESTAMP");
    expectCode(() => t.generate(1e300), "INVALID_TIMESTAMP");
    expectCode(() => t.remaining(-1), "INVALID_TIMESTAMP");
    expectCode(() => t.progress(-1), "INVALID_TIMESTAMP");
  });

  it("ctor_nullOptions_failsClosedAsMissingSecret", () => {
    // JS 调用方传 null / 非对象（JSON.parse("null")）不得漏原生 TypeError：
    // 按「未提供任何选项」处理 → INVALID_SECRET_CONTAINER
    for (const options of [null, undefined, 5, "x"]) {
      expectCode(
        () => new TOTP(options as unknown as { secret: string }),
        "INVALID_SECRET_CONTAINER",
      );
    }
  });

  it("verify_nullOptions_behavesLikeUndefined", () => {
    // `verify(token, null)` 等价于未传 options（timestamp 取当前时刻、window 0）
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32 });
    expect(t.verify(t.generate(), null)).toBe(0);
  });

  it("verify_windowExceedsCap_throws", () => {
    // window 来自外部输入时不得当计算炸弹：上限 MAX_VERIFY_WINDOW = 10 步
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32 });
    expectCode(
      () => t.verify("287082", { timestamp: 59000, window: 11 }),
      "INVALID_WINDOW",
    );
    expect(t.verify("287082", { timestamp: 59000, window: 10 })).toBe(0);
  });

  it("timestampNegative_notMaskedByClockOffset", () => {
    // 显式 timestamp 先按口径校验：负数不得因为正偏移「抵消」而静默通过
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32, clockOffsetMs: 10000 });
    expectCode(() => t.generate(-10000), "INVALID_TIMESTAMP");
    expectCode(
      () => t.verify("755224", { timestamp: -10000 }),
      "INVALID_TIMESTAMP",
    );
    expectCode(() => t.remaining(-10000), "INVALID_TIMESTAMP");
    expectCode(() => t.progress(-10000), "INVALID_TIMESTAMP");
  });

  it("timestampOffsetOverflow_throwsClockOffset", () => {
    // 入参合法但叠加偏移后越界属偏移配置问题：不得把入参误报成 INVALID_TIMESTAMP
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32, clockOffsetMs: 10 });
    expectCode(
      () => t.generate(Number.MAX_SAFE_INTEGER),
      "INVALID_CLOCK_OFFSET",
    );
    expectCode(
      () => t.verify("755224", { timestamp: Number.MAX_SAFE_INTEGER }),
      "INVALID_CLOCK_OFFSET",
    );
  });

  it("clockOffsetNegative_pushesTimestampBelowEpoch_throwsClockOffset", () => {
    // 对称场景：入参 timestamp=0 合法，负偏移把它推到 epoch 0 之前 → 仍归因偏移配置
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32, clockOffsetMs: -1 });
    expectCode(() => t.generate(0), "INVALID_CLOCK_OFFSET");
    expectCode(
      () => t.verify("755224", { timestamp: 0 }),
      "INVALID_CLOCK_OFFSET",
    );
    expectCode(() => t.remaining(0), "INVALID_CLOCK_OFFSET");
    expectCode(() => t.progress(0), "INVALID_CLOCK_OFFSET");

    // 入参本身非法时仍优先报 INVALID_TIMESTAMP（不被偏移掩盖）
    expectCode(() => t.generate(-1), "INVALID_TIMESTAMP");
  });

  it("mutatingProvider_cannotCorruptLaterCalls", () => {
    // provider 契约（crypto.ts）：key / message 只读。库每次公开调用给一份临时副本，
    // 不在实例里缓存可被 provider 改写的密钥。
    const pure = new PureJsHmac();
    const mutating: HmacProvider = {
      sign(algorithm, key, message) {
        const digest = pure.sign(algorithm, key, message);
        key.fill(0);
        return digest;
      },
    };
    const t = new TOTP({ secret: SEEDS.SHA1_BASE32, digits: 6 }, mutating);
    expect(t.generate(59000)).toBe("287082");
    expect(t.generate(59000)).toBe("287082");
  });
});
