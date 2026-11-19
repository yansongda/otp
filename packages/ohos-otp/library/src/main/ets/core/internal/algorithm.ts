// AUTO-GENERATED from packages/core/src/internal/algorithm.ts. DO NOT EDIT. Run: bun run sync:core
/**
 * 算法事实唯一来源（零平台依赖）：名称集合与 RFC 2104 的数值事实（摘要长度 / 分块长度）。
 *
 * 为什么单列一个模块：`blockSize` 与 `digestLength` 过去分别散在 pure-js provider（HASH_SPECS）
 * 与 engine 的摘要校验（原 internal/digest.ts），新增算法时漏改一处只会在运行期表现为
 * 「算出来的码不对」或误报 `INVALID_ALGORITHM`。现在数值只在这里维护：
 * - engine：按算法校验 provider 返回值长度；
 * - pure-js provider：按算法取分块长度（哈希函数映射属于实现细节，仍留在 pure-js）；
 * - 构造期校验（`internal/digits.ts::isValidAlgorithm`）。
 *
 * 名称集合本身以 `options.ts` 的 `OtpAlgorithm` 为准，`algorithmSpec` 的 case 必须覆盖它
 * （`tests/otp/hash.test.ts` 逐项断言）；ohos 侧手写的 `CryptoSource.toMacAlgName` 由守卫脚本对拍。
 *
 * 查表一律用 switch，不做 `SPECS[algorithm]` 属性索引：后者会命中 Object.prototype 的继承键
 * （`"constructor"` / `"toString"`），把「算法不被接受」错报成 crypto 故障。
 */
export interface AlgorithmSpec {
  /** 摘要长度（字节）：SHA1=20 / SHA256=32 / SHA512=64（RFC 2104，亦见各 SHA 规范）。 */
  readonly digestLength: number;
  /** HMAC 分块长度（字节）：SHA1/SHA256=64 / SHA512=128（RFC 2104 §2）。 */
  readonly blockSize: number;
}

const SHA1_SPEC: AlgorithmSpec = { digestLength: 20, blockSize: 64 };
const SHA256_SPEC: AlgorithmSpec = { digestLength: 32, blockSize: 64 };
const SHA512_SPEC: AlgorithmSpec = { digestLength: 64, blockSize: 128 };

/** 算法 → 事实；未知算法返回 undefined（调用方决定错误码，绝不静默降级）。 */
export function algorithmSpec(algorithm: string): AlgorithmSpec | undefined {
  switch (algorithm) {
    case "SHA1":
      return SHA1_SPEC;
    case "SHA256":
      return SHA256_SPEC;
    case "SHA512":
      return SHA512_SPEC;
    default:
      return undefined;
  }
}
