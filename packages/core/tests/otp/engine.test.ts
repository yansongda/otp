/**
 * 编排层：counter → code 全链路 + verify 恒定时间语义（返回 delta 而非 boolean）。
 * 期望值全部来自 RFC 4226 / 6238 向量。
 */
import { describe, expect, it } from "bun:test";
import type { HmacProvider } from "../../src/crypto";
import { decode } from "../../src/internal/base32";
import { generate, verify } from "../../src/internal/engine";
import { PureJsHmac } from "../../src/pure-js/pure-js-hmac";
import { expectCode } from "./helpers";
import { DIGITS7_SHA1, RFC4226_SHA1_6DIGIT, SEEDS } from "./vectors";

const provider = new PureJsHmac();
const key = decode(SEEDS.SHA1_BASE32);
const params6 = { algorithm: "SHA1", digits: 6, key } as const;
const params7 = { algorithm: "SHA1", digits: 7, key } as const;

const MATCH_DIGEST = new Uint8Array(20).fill(0x2a);

/**
 * 按 counter 决定摘要的 stub provider：列出的 counter 产同一个 token（命中），
 * 其余 counter 按自身值产**互不相同**的摘要（不命中）。
 * 用于构造「多个候选同时命中」——真实密钥下两个 counter 撞码的概率只有 ~10^-digits，
 * 单测里造不出来，但 tie-break 语义必须有可执行的证据。
 */
function stubProvider(matchCounters: ReadonlyArray<number>): HmacProvider {
  return {
    sign(
      _algorithm: string,
      _key: Uint8Array,
      message: Uint8Array,
    ): Uint8Array {
      // verify 传入的 message 是 8 字节大端 counter
      const counter =
        ((message[4] << 24) |
          (message[5] << 16) |
          (message[6] << 8) |
          message[7]) >>>
        0;
      if (matchCounters.indexOf(counter) !== -1) {
        return MATCH_DIGEST;
      }
      // 非命中：摘要随 counter 变化，保证「窗口外生成的 token」不会误命中
      return new Uint8Array(20).fill(counter & 0xff);
    },
  };
}

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

  it("verify_window_multipleMatches_returnsClosestDelta", () => {
    // window 内 5 个候选同时命中：必须返回 |delta| 最小的 0。
    // 旧的「扫描首个命中」策略会返回 -2，调用方据此重置 counter 就会往回退
    // （HOTP 的 `counter + delta + 1` 会变成 base-1，等于重新放行两个旧码）。
    const base = 1000;
    const everything = stubProvider([
      base - 2,
      base - 1,
      base,
      base + 1,
      base + 2,
    ]);
    const token = generate(everything, params6, base);
    expect(verify(everything, params6, token, base, 2)).toBe(0);
  });

  it("verify_window_sameDistancePrefersNegative", () => {
    // 只有 -1 与 +1 命中（|delta| 相同）：固定取负方向（先看过期一侧），
    // 不依赖扫描实现细节，保证「同输入同结果」
    const base = 1000;
    const pair = stubProvider([base - 1, base + 1]);
    const token = generate(pair, params6, base + 1);
    expect(verify(pair, params6, token, base, 1)).toBe(-1);
  });

  it("verify_window_forwardOnlyMatch", () => {
    const base = 1000;
    const forward = stubProvider([base + 2]);
    const token = generate(forward, params6, base + 2);
    expect(verify(forward, params6, token, base, 2)).toBe(2);
  });

  it("verify_window_unmatchedToken_returnsNull", () => {
    const base = 1000;
    const pair = stubProvider([base - 1, base + 1]);
    // 用窗口外的 counter 生成 token：stub 对非命中 counter 按自身值产出不同摘要，
    // 因此窗口内所有候选的码都与它不同 → null
    const outside = generate(pair, params6, base + 10);
    expect(verify(pair, params6, outside, base, 2)).toBeNull();
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

  it("generate_providerDigestLengthMustMatchAlgorithm", () => {
    // 摘要长度必须与算法匹配（SHA1=20 / SHA256=32 / SHA512=64）；否则截断会读到缺位
    const wrongSha1 = {
      sign(): Uint8Array {
        return new Uint8Array(32);
      },
    };
    expectCode(() => generate(wrongSha1, params6, 0), "CRYPTO_FAILED");

    const wrongSha256 = {
      sign(): Uint8Array {
        return new Uint8Array(20);
      },
    };
    const params256 = { algorithm: "SHA256", digits: 6, key };
    expectCode(() => generate(wrongSha256, params256, 0), "CRYPTO_FAILED");
  });

  it("generate_unknownAlgorithm_throwsInvalidAlgorithm", () => {
    // 未知算法是「算法不被接受」，与 pure-js / ohos provider 同码（不是 CRYPTO_FAILED）；
    // 即使 provider 返回长度看似合法的摘要，也必须先拒绝算法
    const anyDigest = {
      sign(): Uint8Array {
        return new Uint8Array(20);
      },
    };
    expectCode(
      () => generate(anyDigest, { algorithm: "MD5", digits: 6, key }, 0),
      "INVALID_ALGORITHM",
    );
  });

  it("verify_nonStringToken_throwsInvalidToken", () => {
    // JS 调用方可能传 null / 数字：先判容器再取 length，不得漏原生 TypeError；
    // 归为 INVALID_TOKEN（token 格式非法），与「非纯数字 / 长度不符」同码
    for (const bad of [null, undefined, 123, {}]) {
      expectCode(
        () => verify(provider, params6, bad as unknown as string, 1, 0),
        "INVALID_TOKEN",
      );
    }
  });
});
