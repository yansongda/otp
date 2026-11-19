/**
 * 哈希 / HMAC 原语测试：FIPS 180-4 + RFC 2202/4231 向量。
 * 同时覆盖 provider 映射（算法名 → 哈希函数 / 块大小），防止接错算法。
 */
import { describe, expect, it } from "bun:test";
import { OtpError } from "../../src/errors";
import { algorithmSpec } from "../../src/internal/algorithm";
import { OtpAlgorithm } from "../../src/options";
import { hmac } from "../../src/pure-js/hmac";
import { PureJsHmac } from "../../src/pure-js/pure-js-hmac";
import { sha1 } from "../../src/pure-js/sha1";
import { sha256 } from "../../src/pure-js/sha256";
import { sha512 } from "../../src/pure-js/sha512";
import {
  HASH_VECTORS,
  HMAC_VECTORS,
  SHA1_DIGESTS,
  SHA256_DIGESTS,
  SHA512_DIGESTS,
  toHex,
} from "./vectors";

describe("hash", () => {
  for (const v of HASH_VECTORS) {
    it(`sha1_${v.label}`, () => {
      expect(toHex(sha1(v.bytes))).toBe(SHA1_DIGESTS[v.label]);
    });
    it(`sha256_${v.label}`, () => {
      expect(toHex(sha256(v.bytes))).toBe(SHA256_DIGESTS[v.label]);
    });
    it(`sha512_${v.label}`, () => {
      expect(toHex(sha512(v.bytes))).toBe(SHA512_DIGESTS[v.label]);
    });
  }
});

describe("hmac", () => {
  for (const v of HMAC_VECTORS) {
    it(`${v.label}_sha1`, () => {
      expect(toHex(hmac(sha1, 64, v.key, v.message))).toBe(v.sha1);
    });
    it(`${v.label}_sha256`, () => {
      expect(toHex(hmac(sha256, 64, v.key, v.message))).toBe(v.sha256);
    });
    it(`${v.label}_sha512`, () => {
      expect(toHex(hmac(sha512, 128, v.key, v.message))).toBe(v.sha512);
    });
  }
});

describe("provider", () => {
  const provider = new PureJsHmac();

  for (const v of HMAC_VECTORS) {
    it(`${v.label}_provider_mapping`, () => {
      expect(toHex(provider.sign("SHA1", v.key, v.message))).toBe(v.sha1);
      expect(toHex(provider.sign("SHA256", v.key, v.message))).toBe(v.sha256);
      expect(toHex(provider.sign("SHA512", v.key, v.message))).toBe(v.sha512);
    });
  }

  it("provider_unknownAlgorithm_throwsInvalidAlgorithm", () => {
    // 非法算法值穿透（仅测试构造）：未知算法是「算法不被接受」，不是 crypto 层故障
    let thrown: unknown = null;
    try {
      provider.sign("MD5" as "SHA1", new Uint8Array(1), new Uint8Array(1));
    } catch (e) {
      thrown = e;
    }
    expect(thrown instanceof OtpError).toBe(true);
    expect((thrown as OtpError).code).toBe("INVALID_ALGORITHM");
  });

  it("provider_prototypeKeyAlgorithm_throwsInvalidAlgorithm", () => {
    // 算法查表一律用 switch，不用属性索引：`表[algorithm]` 会命中 Object.prototype 的继承键
    // （"constructor" / "toString" 拿到函数而非 undefined），最终被 catch 误收敛为
    // CRYPTO_FAILED，把「算法不被接受」错报成 crypto 故障。
    for (const algorithm of ["constructor", "toString", "hasOwnProperty"]) {
      let thrown: unknown = null;
      try {
        provider.sign(
          algorithm as "SHA1",
          new Uint8Array(1),
          new Uint8Array(1),
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown instanceof OtpError).toBe(true);
      expect((thrown as OtpError).code).toBe("INVALID_ALGORITHM");
    }
  });

  it("provider_everyAlgorithmMatchesSpecTable", () => {
    // 算法事实单源（internal/algorithm.ts）：`OtpAlgorithm` 的每个成员都必须有事实条目、
    // 有纯 JS 哈希映射，且事实表里的 digestLength 与哈希函数真实输出长度一致。
    // 新增算法时漏改任一处都会在这里红，而不是线上才算错码或误报 INVALID_ALGORITHM。
    for (const algorithm of Object.values(OtpAlgorithm)) {
      const spec = algorithmSpec(algorithm);
      if (spec === undefined) {
        throw new Error(`internal/algorithm.ts 缺少算法事实：${algorithm}`);
      }
      const digest = provider.sign(
        algorithm,
        new Uint8Array(20),
        new Uint8Array(8),
      );
      expect(digest.length).toBe(spec.digestLength);
    }
  });
});
