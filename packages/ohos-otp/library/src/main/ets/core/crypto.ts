// AUTO-GENERATED from packages/core/src/crypto.ts (core@6b1f0b0). DO NOT EDIT. Run: bun run sync:core
/**
 * 解耦层：哈希 / HMAC / 随机源接口 + 注册表（零平台依赖）。
 *
 * 公开类只经本层取默认实现；真实实现由平台 barrel 注册：
 * - ohos：internal/CryptoSource.ets（cryptoFramework，全库唯一 @kit 导入点）
 * - miniprogram：pure-js/pure-js-hmac.ts（纯 JS 兜底）
 */
import { otpFail } from "./errors";

/** 单参哈希函数（消息 → 摘要）。 */
export type HashFunction = (message: Uint8Array) => Uint8Array;

/**
 * HMAC 抽象接口（algorithm 为字符串，ArkTS 可直接实现）。
 *
 * 入参契约（provider 必须遵守）：`key` / `message` 一律只读——不得修改、不得 fill、
 * 不得跨调用保留引用。库每次**公开调用**传入一份密钥临时副本（同一次调用的窗口扫描会
 * 复用该副本）；实现若写入入参，本次调用的后续候选就会用被污染的密钥计算，
 * 且这类错误只会表现为「码不对」而非可诊断的错误码。
 */
export interface HmacProvider {
  sign(algorithm: string, key: Uint8Array, message: Uint8Array): Uint8Array;
}

/**
 * 随机数抽象接口：必须同步返回 Uint8Array，且长度等于请求的 bytes（否则 CRYPTO_FAILED）。
 * 失败时必须抛 `name === "OtpError"` 的错误（core otpFail / 平台 OtpError）；
 * 其余异常视为实现缺陷并收敛为 CRYPTO_FAILED——与 HmacProvider 同一契约。
 */
export interface RandomSource {
  random(bytes: number): Uint8Array;
}

// 模块级单例（默认未注册；由平台 barrel 或测试注入）
let hmacProvider: HmacProvider | null = null;
let randomSource: RandomSource | null = null;

/** 注册 HMAC 实现（幂等覆盖）。 */
export function registerHmac(provider: HmacProvider): void {
  hmacProvider = provider;
}

/** 取用 HMAC 实现；未注册时抛 CRYPTO_NOT_INITIALIZED。 */
export function requireHmac(): HmacProvider {
  const provider = hmacProvider;
  if (provider === null) {
    return otpFail("CRYPTO_NOT_INITIALIZED");
  }
  return provider;
}

/** 注册随机源实现（幂等覆盖）。 */
export function registerRandom(source: RandomSource): void {
  randomSource = source;
}

/** 取用随机源；未注册时抛 CRYPTO_NOT_INITIALIZED。 */
export function requireRandom(): RandomSource {
  const source = randomSource;
  if (source === null) {
    return otpFail("CRYPTO_NOT_INITIALIZED");
  }
  return source;
}

/** 清空已注册实现，恢复到「未注册」状态（仅测试使用）。 */
export function reset(): void {
  hmacProvider = null;
  randomSource = null;
}
