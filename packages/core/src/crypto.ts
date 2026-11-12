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

/** HMAC 抽象接口（algorithm 为字符串，ArkTS 可直接实现）。 */
export interface HmacProvider {
  sign(algorithm: string, key: Uint8Array, message: Uint8Array): Uint8Array;
}

/** 随机数抽象接口。 */
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
