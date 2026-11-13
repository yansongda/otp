/**
 * HOTP（RFC 4226）公开类。默认 provider 经 requireHmac() 取用。
 */

import { type HmacProvider, requireHmac } from "./crypto";
import { otpFail } from "./errors";
import { isSafeCounter } from "./internal/counter";
import {
  type EngineParams,
  generate as engineGenerate,
  verify as engineVerify,
} from "./internal/engine";
import { resolveHmacOptions } from "./internal/resolve";
import type { AlgorithmName, HotpOptions, HotpVerifyOptions } from "./options";
import { DEFAULT_COUNTER } from "./options";
import { OTPAuthURI } from "./otpauth-uri";
import type { Secret } from "./secret";

export class HOTP {
  private readonly _provider: HmacProvider;
  private readonly _secret: Secret;
  private readonly _key: Uint8Array;
  private readonly _algorithm: AlgorithmName;
  private readonly _digits: number;
  private readonly _counter: number;
  private readonly _issuer: string | undefined;
  private readonly _account: string | undefined;

  /**
   * @param provider 仅供库内测试注入；调用方省略即走 requireHmac() 的默认实现。
   */
  constructor(options: HotpOptions, provider?: HmacProvider) {
    const resolved = resolveHmacOptions(options);
    const counter =
      options.counter === undefined ? DEFAULT_COUNTER : options.counter;
    if (!isSafeCounter(counter)) {
      otpFail("INVALID_COUNTER");
    }

    this._provider = provider === undefined ? requireHmac() : provider;
    this._secret = resolved.secret;
    this._key = resolved.key;
    this._algorithm = resolved.algorithm;
    this._digits = resolved.digits;
    this._counter = counter;
    this._issuer = options.issuer;
    this._account = options.account;
  }

  private params(): EngineParams {
    return {
      algorithm: this._algorithm,
      digits: this._digits,
      key: this._key,
    };
  }

  /** 生成验证码；counter 缺省用构造值。 */
  generate(counter?: number): string {
    const c = counter === undefined ? this._counter : counter;
    return engineGenerate(this._provider, this.params(), c);
  }

  /**
   * 恒定时间比对；counter 缺省用构造值、window 缺省 0、上限 MAX_VERIFY_WINDOW（10）。
   * 返回命中 counter 相对基准的偏移（步=1），未命中 null。
   */
  verify(token: string, options?: HotpVerifyOptions): number | null {
    const c =
      options === undefined || options.counter === undefined
        ? this._counter
        : options.counter;
    const window =
      options === undefined || options.window === undefined
        ? 0
        : options.window;
    return engineVerify(this._provider, this.params(), token, c, window);
  }

  /** 输出规范 otpauth://hotp/ URI。 */
  toURI(): string {
    return OTPAuthURI.build({
      type: "hotp",
      secret: this._secret.toBase32(),
      algorithm: this._algorithm,
      digits: this._digits,
      counter: this._counter,
      issuer: this._issuer,
      account: this._account,
    });
  }

  /** 从 otpauth URI 构造；URI 类型非 hotp（如 totp）抛 UNSUPPORTED_OTPAUTH_TYPE。 */
  static fromURI(uri: string): HOTP {
    const params = OTPAuthURI.parse(uri);
    if (params.type !== "hotp") {
      otpFail("UNSUPPORTED_OTPAUTH_TYPE");
    }
    return new HOTP({
      secret: params.secret,
      algorithm: params.algorithm,
      digits: params.digits,
      counter: params.counter === undefined ? DEFAULT_COUNTER : params.counter,
      issuer: params.issuer,
      account: params.account,
    });
  }
}
