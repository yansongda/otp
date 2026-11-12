/**
 * TOTP（RFC 6238）公开类。默认 provider 经 requireHmac() 取用。
 * 所有时间入口（含显式传入 timestamp）统一叠加 clockOffsetMs。
 */
import { otpFail } from "./errors";
import { type HmacProvider, requireHmac } from "./crypto";
import {
  isValidAlgorithm,
  isValidDigits,
} from "./internal/digits";
import {
  type EngineParams,
  generate as engineGenerate,
  verify as engineVerify,
} from "./internal/engine";
import {
  remainingSec,
  progress as timeStepProgress,
  step as timeStepStep,
} from "./internal/time-step";
import type { AlgorithmName, TotpOptions, VerifyOptions } from "./options";
import { OTPAuthURI } from "./otpauth-uri";
import { Secret } from "./secret";

export class TOTP {
  private readonly _provider: HmacProvider;
  private readonly _secret: Secret;
  private readonly _algorithm: AlgorithmName;
  private readonly _digits: number;
  private readonly _period: number;
  private readonly _t0: number;
  private _clockOffsetMs: number;
  private readonly _issuer: string | undefined;
  private readonly _account: string | undefined;

  /**
   * @param provider 仅供库内测试注入；调用方省略即走 requireHmac() 的默认实现。
   */
  constructor(options: TotpOptions, provider?: HmacProvider) {
    const secret = Secret.fromBase32(options.secret);
    const algorithm = options.algorithm === undefined ? "SHA1" : options.algorithm;
    const digits = options.digits === undefined ? 6 : options.digits;
    const period = options.period === undefined ? 30 : options.period;
    const t0 = options.t0 === undefined ? 0 : options.t0;
    const clockOffsetMs =
      options.clockOffsetMs === undefined ? 0 : options.clockOffsetMs;
    const minSecretBits =
      options.minSecretBits === undefined ? 0 : options.minSecretBits;

    if (!isValidDigits(digits)) {
      otpFail("INVALID_DIGITS");
    }
    if (!isValidAlgorithm(algorithm)) {
      otpFail("INVALID_ALGORITHM");
    }
    if (!Number.isInteger(period) || period <= 0) {
      otpFail("INVALID_PERIOD");
    }
    if (!Number.isInteger(t0) || t0 < 0) {
      otpFail("INVALID_T0");
    }
    if (!Number.isFinite(clockOffsetMs)) {
      otpFail("INVALID_TIMESTAMP");
    }
    if (minSecretBits > 0 && secret.bitLength < minSecretBits) {
      otpFail("SECRET_TOO_WEAK");
    }

    this._provider = provider === undefined ? requireHmac() : provider;
    this._secret = secret;
    this._algorithm = algorithm;
    this._digits = digits;
    this._period = period;
    this._t0 = t0;
    this._clockOffsetMs = clockOffsetMs;
    this._issuer = options.issuer;
    this._account = options.account;
  }

  private params(): EngineParams {
    return {
      algorithm: this._algorithm,
      digits: this._digits,
      key: this._secret.bytes,
    };
  }

  /** 所有时间入口统一：缺省取当前时刻，显式传入也叠加时钟偏移。 */
  private effectiveTs(timestampMs?: number): number {
    return (
      (timestampMs === undefined ? Date.now() : timestampMs) +
      this._clockOffsetMs
    );
  }

  /** 生成验证码；timestampMs 缺省当前时刻。 */
  generate(timestampMs?: number): string {
    return engineGenerate(
      this._provider,
      this.params(),
      timeStepStep(this.effectiveTs(timestampMs), this._t0, this._period),
    );
  }

  /**
   * 恒定时间比对；window 缺省 0、timestamp 缺省当前时刻（叠加偏移）。
   * 返回命中窗口相对当前步的偏移 delta，未命中 null。
   */
  verify(token: string, options?: VerifyOptions): number | null {
    const baseTs =
      options === undefined || options.timestamp === undefined
        ? Date.now()
        : options.timestamp;
    const counter = timeStepStep(
      baseTs + this._clockOffsetMs,
      this._t0,
      this._period,
    );
    const window =
      options === undefined || options.window === undefined
        ? 0
        : options.window;
    return engineVerify(this._provider, this.params(), token, counter, window);
  }

  /** 当前窗口剩余整秒 [1, period]。 */
  remaining(timestampMs?: number): number {
    return remainingSec(this.effectiveTs(timestampMs), this._t0, this._period);
  }

  /** 当前窗口进度 [0, 1)，供环形进度条。 */
  progress(timestampMs?: number): number {
    return timeStepProgress(
      this.effectiveTs(timestampMs),
      this._t0,
      this._period,
    );
  }

  /**
   * 时钟偏移校准（单参数，单位 = 时间步）：clockOffsetMs += delta * period * 1000。
   * 闭环不变量：verify(token, w) 命中 delta 后，syncClockOffset(delta) 使同一时刻的
   * verify(token, 0) 命中 delta = 0（依据 RFC 6238 §6）。
   */
  syncClockOffset(delta: number): void {
    if (!Number.isInteger(delta)) {
      otpFail("INVALID_WINDOW");
    }
    this._clockOffsetMs += delta * this._period * 1000;
  }

  /** 当前时钟偏移（毫秒）。 */
  get clockOffsetMs(): number {
    return this._clockOffsetMs;
  }

  /** 输出规范 otpauth://totp/ URI。 */
  toURI(): string {
    return OTPAuthURI.build({
      type: "totp",
      secret: this._secret.toBase32(),
      algorithm: this._algorithm,
      digits: this._digits,
      period: this._period,
      issuer: this._issuer,
      account: this._account,
    });
  }

  /** 从 otpauth URI 构造；URI 类型非 totp（如 hotp）抛 UNSUPPORTED_OTPAUTH_TYPE。 */
  static fromURI(uri: string): TOTP {
    const params = OTPAuthURI.parse(uri);
    if (params.type !== "totp") {
      otpFail("UNSUPPORTED_OTPAUTH_TYPE");
    }
    return new TOTP({
      secret: params.secret,
      algorithm: params.algorithm,
      digits: params.digits,
      period: params.period === undefined ? 30 : params.period,
      issuer: params.issuer,
      account: params.account,
    });
  }
}
