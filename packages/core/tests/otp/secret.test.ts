/**
 * Secret：规范化 / 字节视图 / 随机生成（注册表）/ toJSON 脱敏。
 */
import { afterEach, describe, expect, it } from "bun:test";
import { registerRandom, reset } from "../../src/crypto";
import { OtpError, OtpErrorCode } from "../../src/errors";
import { decode } from "../../src/internal/base32";
import { installPureJsHmac } from "../../src/pure-js/pure-js-hmac";
import { Secret } from "../../src/secret";
import { expectCode } from "./helpers";
import { asciiBytes, bytesEqual, SEEDS } from "./vectors";

afterEach(() => {
  reset();
  installPureJsHmac();
});

describe("secret", () => {
  it("fromBase32_lenientNormalization", () => {
    const reference = Secret.fromBase32(SEEDS.SHA1_BASE32);
    expect(reference.toBase32()).toBe(SEEDS.SHA1_BASE32);
    expect(reference.byteLength).toBe(20);
    expect(reference.bitLength).toBe(160);
    const lower = Secret.fromBase32(`  ${SEEDS.SHA1_BASE32.toLowerCase()}==\n`);
    expect(lower.toBase32()).toBe(SEEDS.SHA1_BASE32);
    expect(bytesEqual(lower.bytes, reference.bytes)).toBe(true);
  });

  it("fromBase32_strictAcceptsCanonical", () => {
    expect(Secret.fromBase32("MY", { strict: true }).toBase32()).toBe("MY");
    expect(Secret.fromBase32("MY======", { strict: true }).toBase32()).toBe(
      "MY",
    );
  });

  it("fromBase32_strictRejectsNonCanonical", () => {
    expectCode(
      () => Secret.fromBase32("MZXW6YT", { strict: true }),
      "INVALID_BASE32_PADDING",
    );
    // 单字符合法：解码后 0 字节，与宽松模式同码（不随 strict 开关换语义）
    expectCode(
      () => Secret.fromBase32("A", { strict: true }),
      "SECRET_TOO_SHORT",
    );
  });

  it("fromBase32_strictFlagIsFailClosed", () => {
    // strict 是导入边界的严格开关：只有「未提供」/ 明确 false 才是宽松。
    // 非 boolean（服务端 JSON 常见的 1 / "true" / null）一律按 strict（宁可多拒，不可漏放）。
    for (const strict of [true, 1, "true", null, {}]) {
      expectCode(
        () =>
          Secret.fromBase32("MZXW6YT", { strict } as unknown as {
            strict?: boolean;
          }),
        "INVALID_BASE32_PADDING",
      );
    }
    // 明确 false / 未提供 → 宽松（不改变旧行为）：非规范输入被静默重编码
    expect(Secret.fromBase32("MZXW6YT").toBase32()).toBe("MZXW6YQ");
    expect(Secret.fromBase32("MZXW6YT", { strict: false }).toBase32()).toBe(
      "MZXW6YQ",
    );
    expect(Secret.fromBase32("MZXW6YT", { strict: undefined }).toBase32()).toBe(
      "MZXW6YQ",
    );
  });

  it("fromBase32_nullOptionsDoesNotThrowTypeError", () => {
    // 小程序是 JS 调用：`JSON.parse("null")` / 可选配置直传 null 很常见，必须等价于未传
    expect(Secret.fromBase32("MZXW6YQ", null).toBase32()).toBe("MZXW6YQ");
  });

  it("fromBase32_emptyOrInvalid_throws", () => {
    expectCode(() => Secret.fromBase32(""), "EMPTY_SECRET");
    expectCode(() => Secret.fromBase32("   "), "EMPTY_SECRET");
    expectCode(() => Secret.fromBase32("AB1"), "INVALID_BASE32_CHAR");
    expectCode(() => Secret.fromBase32("A"), "SECRET_TOO_SHORT");
  });

  it("fromBytes_copiesInput", () => {
    const input = asciiBytes(SEEDS.SHA1);
    const secret = Secret.fromBytes(input);
    input[0] = 0x00;
    expect(secret.toBase32()).toBe(SEEDS.SHA1_BASE32);
  });

  it("bytes_returnsCopy", () => {
    const secret = Secret.fromBase32(SEEDS.SHA1_BASE32);
    const view = secret.bytes;
    view[0] = 0x00;
    expect(secret.toBase32()).toBe(SEEDS.SHA1_BASE32);
    expect(secret.bytes[0]).toBe(decode(SEEDS.SHA1_BASE32)[0]);
  });

  it("fromBytes_empty_throws", () => {
    expectCode(() => Secret.fromBytes(new Uint8Array(0)), "EMPTY_SECRET");
  });

  it("fromBytes_nonByteContainer_failsClosed", () => {
    // 微信端是 JS 调用：字符串 / array-like 的 length 可能「恰好合法」，
    // new Uint8Array(str) 会静默得到 0 字节（空密钥），array-like 会得到全零密钥。
    for (const bad of ["abc", { length: 5 }, null]) {
      expectCode(
        () => Secret.fromBytes(bad as unknown as Uint8Array),
        "INVALID_SECRET_CONTAINER",
      );
    }
  });

  it("fromBytes_acceptsUint8ClampedArray", () => {
    // Uint8ClampedArray 的读取语义与 Uint8Array 完全一致（8 位无符号 0-255，差别只在写入时
    // clamp vs wrap），ImageData.data 等 Web 侧 API 直接给出该类型：必须接受且值域不变。
    const clamped = new Uint8ClampedArray([0x01, 0x7f, 0xff]);
    const secret = Secret.fromBytes(clamped);
    expect(secret.byteLength).toBe(3);
    expect(Array.from(secret.bytes)).toEqual([0x01, 0x7f, 0xff]);
    // 同样是拷贝语义：改写入参不影响实例内密钥
    clamped[0] = 0x00;
    expect(secret.bytes[0]).toBe(0x01);
  });

  it("fromBytes_otherTypedArrays_failClosed", () => {
    // Int8Array / Uint16Array / DataView 一律拒绝：new Uint8Array(x) 对 TypedArray 是逐元素
    // 而非逐字节转换（Uint16Array 会静默丢掉高位字节），必须由调用方显式转换。
    for (const bad of [
      new Int8Array([1, 2, 3]),
      new Uint16Array([0x1234, 0x5678]),
      new DataView(new ArrayBuffer(4)),
    ]) {
      expectCode(
        () => Secret.fromBytes(bad as unknown as Uint8Array),
        "INVALID_SECRET_CONTAINER",
      );
    }
  });

  it("fromBytes_arrayBuffer_copiesInput", () => {
    // ArrayBuffer 是合法字节容器（wx.getRandomValues 的 randomValues 可直接传）。
    // new Uint8Array(arrayBuffer) 是视图而非拷贝：必须拷一份，否则调用方清零/改写
    // 原 buffer 会直接改动实例内密钥。
    const buffer = new ArrayBuffer(20);
    new Uint8Array(buffer).fill(0x01);
    const secret = Secret.fromBytes(buffer);
    expect(secret.byteLength).toBe(20);
    new Uint8Array(buffer).fill(0x00);
    expect(secret.bytes[0]).toBe(0x01);
    expect(secret.toBase32()).not.toBe("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("fromBytes_emptyArrayBuffer_throws", () => {
    expectCode(() => Secret.fromBytes(new ArrayBuffer(0)), "EMPTY_SECRET");
  });

  it("generate_withoutRegisteredRandom_throws", () => {
    expectCode(() => Secret.generate(), "CRYPTO_NOT_INITIALIZED");
  });

  it("generate_withRegisteredRandom", () => {
    const bytes = new Uint8Array(20);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i + 1;
    }
    registerRandom({ random: (n: number) => bytes.slice(0, n) });
    const secret = Secret.generate();
    expect(secret.byteLength).toBe(20);
    expect(secret.toBase32()).toBe("AEBAGBAFAYDQQCIKBMGA2DQPCAIREEYU");
  });

  it("generate_invalidSize_throws", () => {
    // 长度越界是参数错误，不是「密钥强度不足」（后者由 minSecretBits 的 SECRET_TOO_WEAK 承担）
    registerRandom({ random: (n: number) => new Uint8Array(n) });
    expectCode(() => Secret.generate(0), "INVALID_SECRET_LENGTH");
    expectCode(() => Secret.generate(4097), "INVALID_SECRET_LENGTH");
    expectCode(() => Secret.generate(1.5), "INVALID_SECRET_LENGTH");
  });

  it("generate_sourceWrongLength_normalizedToCryptoFailed", () => {
    // 随机源违反长度契约：静默接受会让密钥强度与调用方预期不符
    registerRandom({ random: (n: number) => new Uint8Array(n + 1) });
    expectCode(() => Secret.generate(20), "CRYPTO_FAILED");
  });

  it("generate_sourceNonUint8Array_normalizedToCryptoFailed", () => {
    // 字符串 / array-like 的 length 可能「恰好合法」，而 new Uint8Array(str) 会得到 0 字节
    // （静默生成空密钥）；null 则连 .length 都取不到，会漏出 TypeError 而不是 OtpError。
    registerRandom({
      random: (n: number) => "x".repeat(n) as unknown as Uint8Array,
    });
    expectCode(() => Secret.generate(20), "CRYPTO_FAILED");

    registerRandom({ random: () => null as unknown as Uint8Array });
    expectCode(() => Secret.generate(20), "CRYPTO_FAILED");
  });

  it("generate_sourceByteViews_accepted", () => {
    // 容器规则与 Secret.fromBytes 同源（internal/bytes.ts）：8 位无符号视图（Uint8ClampedArray）
    // 与 ArrayBuffer 是合法随机源返回值，不得因为「不是严格 Uint8Array」被误判为 crypto 故障。
    registerRandom({
      random: (n: number) =>
        new Uint8ClampedArray(n).fill(7) as unknown as Uint8Array,
    });
    const clamped = Secret.generate(20);
    expect(clamped.byteLength).toBe(20);
    expect(clamped.bytes[0]).toBe(7);

    registerRandom({
      random: (n: number) => new ArrayBuffer(n) as unknown as Uint8Array,
    });
    expect(Secret.generate(20).byteLength).toBe(20);
  });

  it("generate_sourceThrows_normalized", () => {
    // 随机源契约：失败必须抛 name === "OtpError" 的错误；其余异常收敛为 CRYPTO_FAILED
    registerRandom({
      random: () => {
        throw new TypeError("native rng exploded");
      },
    });
    expectCode(() => Secret.generate(20), "CRYPTO_FAILED");

    const providerError = new OtpError(
      OtpErrorCode.CRYPTO_FAILED,
      "CRYPTO_FAILED",
    );
    registerRandom({
      random: () => {
        throw providerError;
      },
    });
    let thrown: unknown = null;
    try {
      Secret.generate(20);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(providerError);
  });

  it("toJSON_redactsSecret", () => {
    const secret = Secret.fromBase32(SEEDS.SHA1_BASE32);
    expect(secret.toJSON()).toBe("[REDACTED]");
    expect(JSON.stringify({ s: secret })).toBe('{"s":"[REDACTED]"}');
    expect(JSON.stringify({ s: secret }).indexOf(SEEDS.SHA1_BASE32)).toBe(-1);
  });

  it("doesNotExposeToString", () => {
    // 刻意不实现 toString：模板字符串 / String() 不应泄漏密钥
    const secret = Secret.fromBase32(SEEDS.SHA1_BASE32);
    expect(String(secret) === "[object Object]").toBe(true);
  });

  it("fromBase32_nonStringContainer_failsClosed", () => {
    // 非字符串入参不得漏原生 TypeError（normalize 的 input.replace）；
    // 与 fromBytes 的非字节容器同码：都是「secret 容器类型不对」
    for (const bad of [123, null, undefined]) {
      expectCode(
        () => Secret.fromBase32(bad as unknown as string),
        "INVALID_SECRET_CONTAINER",
      );
    }
  });
});
