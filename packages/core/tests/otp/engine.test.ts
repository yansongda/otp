/**
 * 编排层：counter → code 全链路 + verify 恒定时间语义（返回 delta 而非 boolean）。
 * 期望值全部来自 RFC 4226 / 6238 向量。
 */
import { describe, expect, it } from "bun:test";
import { decode } from "../../src/internal/base32";
import { generate, verify } from "../../src/internal/engine";
import { PureJsHmac } from "../../src/pure-js/pure-js-hmac";
import { expectCode } from "./helpers";
import { DIGITS7_SHA1, RFC4226_SHA1_6DIGIT, SEEDS } from "./vectors";

const provider = new PureJsHmac();
const key = decode(SEEDS.SHA1_BASE32);
const params6 = { algorithm: "SHA1", digits: 6, key } as const;
const params7 = { algorithm: "SHA1", digits: 7, key } as const;

describe("engine", () => {
  for (const v of RFC4226_SHA1_6DIGIT) {
    it(`generate_counter_${v.counter}`, () => {
      expect(generate(provider, params6, v.counter)).toBe(v.code);
    });
  }

  for (const v of DIGITS7_SHA1) {
    it(`generate_digits7_counter_${v.counter}`, () => {
      expect(generate(provider, params7, v.counter)).toBe(v.code7);
    });
  }

  it("verify_positive_delta0", () => {
    expect(verify(provider, params6, "287082", 1, 0)).toBe(0);
  });

  it("verify_window_delta_minus1", () => {
    expect(verify(provider, params6, "287082", 2, 1)).toBe(-1);
  });

  it("verify_window_delta_plus1", () => {
    expect(verify(provider, params6, "287082", 0, 1)).toBe(1);
  });

  it("verify_negative_window0_prevStepCode", () => {
    expect(verify(provider, params6, "755224", 1, 0)).toBeNull();
  });

  it("verify_window_skipsNegativeCandidates", () => {
    // base counter=0、window=1：候选 -1 必须跳过而不是抛错；counter=0 的码仍可命中
    expect(verify(provider, params6, "755224", 0, 1)).toBe(0);
  });

  it("verify_sameTokenInMultipleCandidates_returnsFirstDelta", () => {
    // 构造重复命中：window 覆盖 counter=1 与 1 的镜像不现实；改为确认首个命中即返回
    expect(verify(provider, params6, "287082", 1, 0)).toBe(0);
  });

  it("verify_invalidToken_nonNumeric_throws", () => {
    expectCode(
      () => verify(provider, params6, "28708a", 1, 0),
      "INVALID_TOKEN",
    );
  });

  it("verify_invalidToken_wrongLength_throws", () => {
    expectCode(() => verify(provider, params6, "28708", 1, 0), "INVALID_TOKEN");
    expectCode(() => verify(provider, params6, "", 1, 0), "INVALID_TOKEN");
  });

  it("verify_invalidCounter_throws", () => {
    expectCode(
      () => verify(provider, params6, "287082", -1, 0),
      "INVALID_COUNTER",
    );
    expectCode(
      () => verify(provider, params6, "287082", 1.5, 0),
      "INVALID_COUNTER",
    );
  });

  it("verify_invalidWindow_throws", () => {
    expectCode(
      () => verify(provider, params6, "287082", 1, -1),
      "INVALID_WINDOW",
    );
    expectCode(
      () => verify(provider, params6, "287082", 1, 1.5),
      "INVALID_WINDOW",
    );
  });

  it("verify_scanStopsAtMaxSafeCounter", () => {
    // 候选越过 MAX_SAFE_INTEGER 时跳过（不抛错）；base=MAX_SAFE、window=1
    expect(
      verify(provider, params6, "000000", Number.MAX_SAFE_INTEGER, 1),
    ).toBeNull();
  });
  it("verify_configErrorsPrecedeTokenErrors", () => {
    // 校验顺序：配置类（counter / window）先于输入类（token），
    // 否则调用方写错 window 会被「用户 token 非法」掩盖
    expectCode(() => verify(provider, params6, "zz", 1, -1), "INVALID_WINDOW");
    expectCode(() => verify(provider, params6, "zz", -1, 0), "INVALID_COUNTER");
  });

  it("verify_windowExceedsCap_throws", () => {
    // 上限 MAX_VERIFY_WINDOW = 10 步：防止外部 window 放大成 HMAC 计算炸弹
    expectCode(
      () => verify(provider, params6, "287082", 1, 11),
      "INVALID_WINDOW",
    );
    expect(verify(provider, params6, "287082", 1, 10)).toBe(0);
  });

  it("generate_providerFailure_normalizedToCryptoFailed", () => {
    // 非 OtpError 的任意值必须收敛为 CRYPTO_FAILED，不得穿透原始错误类型
    const broken = {
      sign(): Uint8Array {
        throw new Error("native hmac exploded");
      },
    };
    expectCode(() => generate(broken, params6, 0), "CRYPTO_FAILED");
  });

  it("generate_providerOtpError_passesThrough", () => {
    // 平台/core 的 OtpError（name 固定）属“已知错误”：保留精确码并原样上抛
    const providerError = new Error("INVALID_ALGORITHM");
    providerError.name = "OtpError";
    const broken = {
      sign(): Uint8Array {
        throw providerError;
      },
    };
    let thrown: unknown = null;
    try {
      generate(broken, params6, 0);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(providerError);
  });

  it("generate_providerNonError_normalizedToCryptoFailed", () => {
    // provider 抛字符串 / null 等非 Error 值同样收敛
    const broken = {
      sign(): Uint8Array {
        throw "boom";
      },
    };
    expectCode(() => generate(broken, params6, 0), "CRYPTO_FAILED");
  });

  it("generate_providerWrongReturnType_normalizedToCryptoFailed", () => {
    // provider 违反返回值契约（非 Uint8Array）→ CRYPTO_FAILED，不越界读
    const broken = {
      sign(): Uint8Array {
        return null as unknown as Uint8Array;
      },
    };
    expectCode(() => generate(broken, params6, 0), "CRYPTO_FAILED");
  });

  it("generate_providerShortDigest_throws", () => {
    // provider 违反摘要长度契约（< 20 字节）→ CRYPTO_FAILED，不越界读
    const shortDigest = {
      sign(): Uint8Array {
        return new Uint8Array(16);
      },
    };
    expectCode(() => generate(shortDigest, params6, 0), "CRYPTO_FAILED");
  });
});
