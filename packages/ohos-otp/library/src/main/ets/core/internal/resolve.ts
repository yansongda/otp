// AUTO-GENERATED from packages/core/src/internal/resolve.ts (core@8940019). DO NOT EDIT. Run: bun run sync:core
/**
 * 构造期共享解析：secret → algorithm → digits → minSecretBits（HOTP / TOTP 共用）。
 *
 * 抽出来是为了：① 两个公开类的默认值与校验顺序不再各自维护（改一处即同步）；
 * ② 密钥的唯一事实源始终是 `Secret._bytes`——本层不再额外缓存一份副本，
 *    调用方每次公开调用经 `secret.bytes` 取临时视图（provider 只读，见 crypto.ts 契约）。
 */
import { otpFail } from "../errors";
import {
  type AlgorithmName,
  DEFAULT_ALGORITHM,
  DEFAULT_DIGITS,
  DEFAULT_MIN_SECRET_BITS,
  type HmacOptions,
} from "../options";
import { Secret } from "../secret";
import { isValidAlgorithm, isValidDigits } from "./digits";

export interface ResolvedHmacOptions {
  secret: Secret;
  algorithm: AlgorithmName;
  digits: number;
}

/** 解析并校验 HMAC 通用选项；错误码顺序见 errors.ts 的优先级约定。 */
export function resolveHmacOptions(options: HmacOptions): ResolvedHmacOptions {
  // JS 调用方可能传 null / undefined / 非对象（JSON.parse("null") 很常见）：
  // 按「未提供任何选项」处理，随后自然落到 INVALID_SECRET_CONTAINER，而不是漏原生 TypeError。
  const opts: HmacOptions =
    typeof options === "object" && options !== null
      ? options
      : ({} as HmacOptions);
  const secret = Secret.fromBase32(opts.secret);
  const algorithm =
    opts.algorithm === undefined ? DEFAULT_ALGORITHM : opts.algorithm;
  const digits = opts.digits === undefined ? DEFAULT_DIGITS : opts.digits;
  const minSecretBits =
    opts.minSecretBits === undefined
      ? DEFAULT_MIN_SECRET_BITS
      : opts.minSecretBits;

  if (!isValidAlgorithm(algorithm)) {
    otpFail("INVALID_ALGORITHM");
  }
  if (!isValidDigits(digits)) {
    otpFail("INVALID_DIGITS");
  }
  // fail-closed：非法阈值不得静默关闭强度校验（NaN > 0 为 false 会跳过检查）
  if (!Number.isSafeInteger(minSecretBits) || minSecretBits < 0) {
    otpFail("INVALID_MIN_SECRET_BITS");
  }
  if (minSecretBits > 0 && secret.bitLength < minSecretBits) {
    otpFail("SECRET_TOO_WEAK");
  }

  return { secret, algorithm, digits };
}
