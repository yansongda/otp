/**
 * 构造期共享解析：secret → algorithm → digits → minSecretBits（HOTP / TOTP 共用）。
 *
 * 抽出来是为了：① 两个公开类的默认值与校验顺序不再各自维护（改一处即同步）；
 * ② 顺带缓存 secret.bytes 的副本 —— 原先每次 generate / verify 候选都要复制一次密钥。
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
  /** secret.bytes 的缓存副本：调用方改动不影响内部，且不再逐次分配。 */
  key: Uint8Array;
  algorithm: AlgorithmName;
  digits: number;
}

/** 解析并校验 HMAC 通用选项；错误码顺序见 errors.ts 的优先级约定。 */
export function resolveHmacOptions(options: HmacOptions): ResolvedHmacOptions {
  const secret = Secret.fromBase32(options.secret);
  const algorithm =
    options.algorithm === undefined ? DEFAULT_ALGORITHM : options.algorithm;
  const digits = options.digits === undefined ? DEFAULT_DIGITS : options.digits;
  const minSecretBits =
    options.minSecretBits === undefined
      ? DEFAULT_MIN_SECRET_BITS
      : options.minSecretBits;

  if (!isValidDigits(digits)) {
    otpFail("INVALID_DIGITS");
  }
  if (!isValidAlgorithm(algorithm)) {
    otpFail("INVALID_ALGORITHM");
  }
  if (minSecretBits > 0 && secret.bitLength < minSecretBits) {
    otpFail("SECRET_TOO_WEAK");
  }

  return { secret, key: secret.bytes, algorithm, digits };
}
