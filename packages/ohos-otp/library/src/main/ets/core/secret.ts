// AUTO-GENERATED from packages/core/src/secret.ts (core@07d0740). DO NOT EDIT. Run: bun run sync:core
/**
 * Secret：secret 规范化 / 校验 / 随机生成 / toJSON 脱敏（零平台依赖，随机源经 requireRandom()）。
 *
 * 刻意不实现 toString()：避免 String() / 模板字符串把密钥明文带入日志或 UI；
 * 脱敏由 toJSON() 承担 —— JSON.stringify 会调用它，而 private 只是编译期约束。
 */

import { requireRandom } from "./crypto";
import { otpFail } from "./errors";
import { decode, decodeStrict, encode } from "./internal/base32";
import { toByteView } from "./internal/bytes";
import { isStrictOption, type ParseOptions } from "./options";

export class Secret {
  private readonly _bytes: Uint8Array;

  private constructor(bytes: Uint8Array) {
    this._bytes = bytes;
  }

  /**
   * 从 base32 字符串构造，默认宽松解析（容忍大小写 / 空白 / 填充）；空结果抛 EMPTY_SECRET。
   * 严格模式（`options.strict` 非 false / 非未提供，见 isStrictOption）追加规范形式校验，
   * 不合规抛 INVALID_BASE32_PADDING —— 用于拒绝被截断 / 被改写的 secret 的导入边界。
   * 入参不是字符串（JS 调用方）→ INVALID_SECRET_CONTAINER：与 fromBytes 的非字节容器同码，
   * 避免 `normalize()` 漏出「input.replace is not a function」这类原生 TypeError。
   * `options` 传 `null` 与未传等价（不露原生 TypeError）。
   */
  static fromBase32(input: string, options?: ParseOptions | null): Secret {
    if (typeof input !== "string") {
      otpFail("INVALID_SECRET_CONTAINER");
    }
    const strict = isStrictOption(options);
    return new Secret(strict ? decodeStrict(input) : decode(input));
  }

  /**
   * 从字节容器构造：一律拷贝，杜绝外部引用共享；空数据抛 EMPTY_SECRET。
   * 运行时只接受「8 位无符号视图」（Uint8Array / Uint8ClampedArray）与 ArrayBuffer，其余一律
   * 抛 INVALID_SECRET_CONTAINER。微信端是 JS 调用，字符串与 array-like 的 length 可能恰好
   * 合法，`new Uint8Array(字符串)` 会得到 0 字节（空密钥）、array-like 会得到全零密钥，因此
   * 在转换之前先判类型，避免静默 fail-open。
   * （`fromBase32` 的非字符串入参复用同一个错误码：两者都是「secret 容器类型不对」。）
   *
   * 为什么放行 Uint8ClampedArray：它的读取语义与 Uint8Array 完全一致（都是 8 位无符号 0-255，
   * 差别只在写入时 clamp vs wrap），而 `ImageData.data` 等 Web 侧 API 直接给出该类型。
   * 反过来 Int8Array / Uint16Array / DataView 必须拒绝：`new Uint8Array(x)` 对 TypedArray 是
   * 逐元素而非逐字节转换，`Uint16Array` 会静默丢掉高位字节。
   *
   * 注意：`new Uint8Array(arrayBuffer)` 只是视图而非拷贝——ArrayBuffer 入参必须先包一层
   * 视图再拷贝，否则调用方后续改写/清零该 buffer 会直接改动实例内密钥。
   */
  static fromBytes(
    bytes: Uint8Array | Uint8ClampedArray | ArrayBuffer,
  ): Secret {
    // 容器判定集中在 internal/bytes.ts：与 Secret.generate 的随机源校验同源，避免两处宽严不一致
    const view = toByteView(bytes);
    if (view === undefined) {
      otpFail("INVALID_SECRET_CONTAINER");
    }
    const copy = new Uint8Array(view);
    if (copy.length === 0) {
      otpFail("EMPTY_SECRET");
    }
    return new Secret(copy);
  }

  /**
   * 随机生成 bytes 字节 secret（默认 20 字节 = RFC 4226 推荐 160 bit）。
   * bytes 须为 [1, 4096] 整数，否则抛 INVALID_SECRET_LENGTH
   * （这不是「密钥强度不足」，强度问题由 minSecretBits 的 SECRET_TOO_WEAK 承担）。
   *
   * 注意：微信小程序默认不注册随机源（wx.getRandomValues 异步），
   * 未注入 RandomSource 时本方法抛 CRYPTO_NOT_INITIALIZED。
   */
  static generate(bytes = 20): Secret {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 4096) {
      otpFail("INVALID_SECRET_LENGTH");
    }
    let generated: Uint8Array;
    try {
      generated = requireRandom().random(bytes);
    } catch (error) {
      // 随机源契约：失败必须抛 name === "OtpError" 的错误（core otpFail / 平台 OtpError）；
      // 其余异常（原生 TypeError 等）视为实现缺陷，与 HmacProvider 同一收敛策略。
      if (error instanceof Error && error.name === "OtpError") {
        throw error;
      }
      otpFail("CRYPTO_FAILED");
    }
    // 先判容器再取 length：字符串 / array-like 的 length 可能「恰好合法」，
    // 而 new Uint8Array(字符串) 会得到 0 字节（空密钥，HMAC 退化为全零密钥）；
    // null / undefined 则连 .length 都取不到，会漏出 TypeError 而不是 OtpError。
    // 容器规则与 fromBytes 同源（internal/bytes.ts）：Uint8ClampedArray / ArrayBuffer 放行——
    // 否则自定义随机源换一种「8 位无符号视图」就从「能用」变成 CRYPTO_FAILED。
    const view = toByteView(generated);
    if (view === undefined || view.length !== bytes) {
      otpFail("CRYPTO_FAILED");
    }
    return new Secret(new Uint8Array(view));
  }

  /** 字节视图：返回拷贝，外部改动不影响内部。 */
  get bytes(): Uint8Array {
    return new Uint8Array(this._bytes);
  }

  get byteLength(): number {
    return this._bytes.length;
  }

  get bitLength(): number {
    return this._bytes.length * 8;
  }

  /** 规范化输出：大写、无填充 base32。 */
  toBase32(): string {
    return encode(this._bytes);
  }

  /** 序列化脱敏：JSON.stringify 会调用本方法，固定返回 '[REDACTED]'，不泄漏密钥。 */
  toJSON(): string {
    return "[REDACTED]";
  }
}
