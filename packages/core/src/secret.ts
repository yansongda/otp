/**
 * Secret：secret 规范化 / 校验 / 随机生成 / toJSON 脱敏（零平台依赖，随机源经 requireRandom()）。
 *
 * 刻意不实现 toString()：避免 String() / 模板字符串把密钥明文带入日志或 UI；
 * 脱敏由 toJSON() 承担 —— JSON.stringify 会调用它，而 private 只是编译期约束。
 */

import { requireRandom } from "./crypto";
import { otpFail } from "./errors";
import { decode, decodeStrict, encode } from "./internal/base32";
import type { ParseOptions } from "./options";

/**
 * 真实字节容器：Uint8Array（含 Buffer 等子类）或其底层 ArrayBuffer。
 * 字符串 / array-like / null 在 JS 侧可能「length 恰好合法」而被静默接受，必须显式拒绝。
 */
function isByteContainer(value: object): boolean {
  return value instanceof Uint8Array || value instanceof ArrayBuffer;
}

export class Secret {
  private readonly _bytes: Uint8Array;

  private constructor(bytes: Uint8Array) {
    this._bytes = bytes;
  }

  /**
   * 从 base32 字符串构造，默认宽松解析（容忍大小写 / 空白 / 填充）；空结果抛 EMPTY_SECRET。
   * options.strict === true 时追加规范形式校验，不合规抛 INVALID_BASE32_PADDING
   * —— 用于拒绝被截断 / 被改写的 secret 的导入边界。
   */
  static fromBase32(input: string, options?: ParseOptions): Secret {
    const strict = options !== undefined && options.strict === true;
    return new Secret(strict ? decodeStrict(input) : decode(input));
  }

  /**
   * 从字节容器构造（拷贝入参，杜绝外部引用共享）；空数据抛 EMPTY_SECRET。
   * 运行时只接受 Uint8Array / ArrayBuffer：微信端是 JS 调用，字符串与 array-like 的 length
   * 可能恰好合法，`new Uint8Array(字符串)` 会得到 0 字节（空密钥）、array-like 会得到全零密钥，
   * 因此在转换之前先判类型，避免静默 fail-open。
   */
  static fromBytes(bytes: Uint8Array): Secret {
    if (!isByteContainer(bytes)) {
      otpFail("EMPTY_SECRET");
    }
    const copy = new Uint8Array(bytes);
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
    // 先判类型再取 length：字符串 / array-like 的 length 可能「恰好合法」，
    // 而 new Uint8Array(字符串) 会得到 0 字节（空密钥，HMAC 退化为全零密钥）；
    // null / undefined 则连 .length 都取不到，会漏出 TypeError 而不是 OtpError。
    if (!(generated instanceof Uint8Array) || generated.length !== bytes) {
      otpFail("CRYPTO_FAILED");
    }
    return new Secret(new Uint8Array(generated));
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
