// AUTO-GENERATED from packages/core/src/internal/digest.ts (core@9f7b962-dirty). DO NOT EDIT. Run: bun run sync:core
/**
 * 摘要长度（字节）→ engine 用它校验 provider 返回值是否与算法匹配。
 *
 * HMAC 的摘要长度由哈希算法决定（RFC 2104）：SHA1=20 / SHA256=32 / SHA512=64。
 * 放在独立模块：engine 只做「长度是否匹配」判定，具体实现（pure-js / 平台 crypto）不需要
 * 知道这条契约的判定位置。未知算法返回 0，由调用方按「违约」处理（CRYPTO_FAILED）。
 */
export function digestLengthOf(algorithm: string): number {
  switch (algorithm) {
    case "SHA1":
      return 20;
    case "SHA256":
      return 32;
    case "SHA512":
      return 64;
    default:
      // 未知算法不应到达 engine（构造期与 URI parse 都校验过）；0 表示「无法匹配」
      return 0;
  }
}
