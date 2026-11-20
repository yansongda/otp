// AUTO-GENERATED from packages/core/src/internal/bytes.ts (core@d4941b5). DO NOT EDIT. Run: bun run sync:core
/**
 * 字节容器归一化（零平台依赖）：把「8 位无符号视图 / ArrayBuffer」统一收敛成 Uint8Array 视图。
 *
 * 判定规则是**唯一一套**，`Secret.fromBytes`（公开契约）与 `Secret.generate`（随机源返回值校验）
 * 共用，避免同一个类里出现两种宽严：
 * - 放行：`Uint8Array`、`Uint8ClampedArray`（读取语义与 Uint8Array 完全一致，差别只在写入
 *   clamp vs wrap；`ImageData.data`、`crypto.getRandomValues(new Uint8ClampedArray(n))` 这类
 *   Web / 小程序 API 直接给出该类型）、`ArrayBuffer`（先包一层视图）。
 * - 拒绝：Int8Array / Uint16Array / DataView（`new Uint8Array(x)` 对 TypedArray 是逐元素而非
 *   逐字节转换，Uint16Array 会静默丢高位字节）、字符串 / array-like（length 可能恰好合法却得到
 *   0 字节或全零密钥）、null / undefined（连 `.length` 都取不到，会漏原生 TypeError）。
 *
 * 返回值只是**视图，不拷贝**：需要独立副本的调用方自己再 `new Uint8Array(view)`。
 */
export function toByteView(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof Uint8ClampedArray) {
    // 共享同一段内存的 8 位无符号视图（byteOffset/byteLength 原样保留）
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return undefined;
}
