/**
 * 纯 JS HMAC provider（零平台依赖，仅 miniprogram 引用）。
 *
 * ohos 有 cryptoFramework，不 import 本文件；sync-core 会把 pure-js/ 排除在副本之外，
 * 避免这部分代码被 hvigor 全量编译进 HAR。
 */
import { type HashFunction, type HmacProvider, registerHmac } from "../crypto";
import { otpFail } from "../errors";
import { algorithmSpec } from "../internal/algorithm";
import { hmac } from "./hmac";
import { sha1 } from "./sha1";
import { sha256 } from "./sha256";
import { sha512 } from "./sha512";

/**
 * 名字 → 哈希函数：这是 pure-js 的**实现细节**（core 的算法事实表只存数值，不存实现），
 * 因此这里只映射函数本身，`blockSize` / 摘要长度一律从 `internal/algorithm.ts` 取，
 * 不再重复一份数值。查表用 switch、不用属性索引：`表[algorithm]` 会命中 Object.prototype 的
 * 继承键（`"constructor"` / `"toString"` 拿到函数而非 undefined），把「算法不被接受」
 * 错报成 crypto 故障。
 */
function hashOf(algorithm: string): HashFunction | undefined {
  switch (algorithm) {
    case "SHA1":
      return sha1;
    case "SHA256":
      return sha256;
    case "SHA512":
      return sha512;
    default:
      return undefined;
  }
}

/** 纯 JS HMAC 实现（同步链路）。 */
export class PureJsHmac implements HmacProvider {
  sign(algorithm: string, key: Uint8Array, message: Uint8Array): Uint8Array {
    const spec = algorithmSpec(algorithm);
    const hash = hashOf(algorithm);
    if (spec === undefined || hash === undefined) {
      // 未知算法是「算法不被接受」，不是 crypto 层故障：用独立错误码
      return otpFail("INVALID_ALGORITHM");
    }
    try {
      return hmac(hash, spec.blockSize, key, message);
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
