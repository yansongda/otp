/**
 * 纯 JS HMAC provider（零平台依赖，仅 miniprogram 引用）。
 *
 * ohos 有 cryptoFramework，不 import 本文件；sync-core 会把 pure-js/ 排除在副本之外，
 * 避免这部分代码被 hvigor 全量编译进 HAR。
 */
import { type HmacProvider, registerHmac } from "../crypto";
import { otpFail } from "../errors";
import type { AlgorithmName } from "../options";
import { hmac } from "./hmac";
import { sha1 } from "./sha1";
import { sha256 } from "./sha256";
import { sha512 } from "./sha512";

interface HashSpec {
  readonly hash: (message: Uint8Array) => Uint8Array;
  readonly blockSize: number;
}

const HASH_SPECS = {
  SHA1: { hash: sha1, blockSize: 64 },
  SHA256: { hash: sha256, blockSize: 64 },
  SHA512: { hash: sha512, blockSize: 128 },
} satisfies Record<AlgorithmName, HashSpec>;

/**
 * 算法查表：必须用自有属性判定，不能直接 `HASH_SPECS[algorithm]`。
 * 后者会命中 Object.prototype 上的继承键（如 `"constructor"`、`"toString"`），
 * 拿到一个函数后再取 `.hash` 得到 undefined，最终被 catch 收敛为 CRYPTO_FAILED，
 * 把「算法不被接受」错报成 crypto 故障。
 */
function specOf(algorithm: string): HashSpec | undefined {
  switch (algorithm) {
    case "SHA1":
      return HASH_SPECS.SHA1;
    case "SHA256":
      return HASH_SPECS.SHA256;
    case "SHA512":
      return HASH_SPECS.SHA512;
    default:
      return undefined;
  }
}

/** 纯 JS HMAC 实现（同步链路）。 */
export class PureJsHmac implements HmacProvider {
  sign(algorithm: string, key: Uint8Array, message: Uint8Array): Uint8Array {
    const spec = specOf(algorithm);
    if (spec === undefined) {
      // 未知算法是「算法不被接受」，不是 crypto 层故障：用独立错误码
      return otpFail("INVALID_ALGORITHM");
    }
    try {
      return hmac(spec.hash, spec.blockSize, key, message);
    } catch {
      // 固定文案：不透传底层错误、不打日志、不含 key/message
      return otpFail("CRYPTO_FAILED");
    }
  }
}

/** 注册默认 HMAC 实现（只 new + 注册，不发起任何计算）。 */
export function installPureJsHmac(): void {
  registerHmac(new PureJsHmac());
}
