/**
 * 构造期共享解析：secret → digits → algorithm（HOTP / TOTP 共用）。
 *
 * 抽出来是为了两个公开类的默认值与校验顺序不再各自维护（改一处即同步）。
 * 注意：本层**不**缓存密钥副本——调用方每次公开调用经 `secret.bytes` 取临时视图
 * （provider 只读，见 crypto.ts 契约）。
 */
import { otpFail } from "../errors";
import type { AlgorithmName, HmacOptions } from "../options";
import { Secret } from "../secret";
import { isValidAlgorithm, isValidDigits } from "./digits";

export interface ResolvedHmacOptions {
  secret: Secret;
  algorithm: AlgorithmName;
  digits: number;
}

/** 解析并校验 HMAC 通用选项（secret → digits → algorithm，保持既有错误码顺序）。 */
export function resolveHmacOptions(options: HmacOptions): ResolvedHmacOptions {
  const secret = Secret.fromBase32(options.secret);
  const algorithm =
    options.algorithm === undefined ? "SHA1" : options.algorithm;
  const digits = options.digits === undefined ? 6 : options.digits;

  if (!isValidDigits(digits)) {
    otpFail("INVALID_DIGITS");
  }
  if (!isValidAlgorithm(algorithm)) {
    otpFail("INVALID_ALGORITHM");
  }

  return { secret, algorithm, digits };
}
