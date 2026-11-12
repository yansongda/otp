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

/** 纯 JS HMAC 实现（同步链路）。 */
export class PureJsHmac implements HmacProvider {
  sign(algorithm: string, key: Uint8Array, message: Uint8Array): Uint8Array {
    const spec: HashSpec | undefined = HASH_SPECS[algorithm as AlgorithmName];
    if (spec === undefined) {
      return otpFail("CRYPTO_FAILED");
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
