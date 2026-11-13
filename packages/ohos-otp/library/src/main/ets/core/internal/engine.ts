// AUTO-GENERATED from packages/core/src/internal/engine.ts. DO NOT EDIT. Run: bun run sync:core
/**
 * 编排层：counter → code 全链路（纯函数，接收注入 provider，零平台依赖）。
 * 取模只在 digits.format 做一次；verify 扫完全部候选后才返回首个命中 delta（恒定时间）。
 */

import type { HmacProvider } from "../crypto";
import { otpFail } from "../errors";
import { MAX_VERIFY_WINDOW } from "../options";
import { isSafeCounter, toBytes } from "./counter";
import { format as formatDigits } from "./digits";
import { constantTimeEquals } from "./time-step";
import { apply as truncateApply } from "./truncate";

export interface EngineParams {
  algorithm: string;
  digits: number;
  key: Uint8Array;
}

export function generate(
  provider: HmacProvider,
  params: EngineParams,
  counter: number,
): string {
  const message = toBytes(counter);
  let digest: Uint8Array;
  try {
    digest = provider.sign(params.algorithm, params.key, message);
  } catch (error) {
    // provider 契约：失败必须抛 name === "OtpError" 的错误（core otpFail / 平台 OtpError）。
    // 已知错误原样上抛（保留 INVALID_ALGORITHM / CRYPTO_FAILED 等精确码）；
    // 其他值（TypeError、字符串、null…）视为 provider 实现缺陷，统一收敛。
    if (error instanceof Error && error.name === "OtpError") {
      throw error;
    }
    otpFail("CRYPTO_FAILED");
  }
  if (!(digest instanceof Uint8Array)) {
    // provider 违反返回值契约（非 Uint8Array）同样视为 crypto 层缺陷
    otpFail("CRYPTO_FAILED");
  }
  return formatDigits(truncateApply(digest), params.digits);
}

/** token 必须为纯数字且非空；逐字符校验，避免正则。 */
function isNumericToken(token: string): boolean {
  if (token.length === 0) {
    return false;
  }
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    if (c < 48 || c > 57) {
      return false;
    }
  }
  return true;
}

/** 窗口上限：超出即拒绝，避免外部 window 放大成 HMAC 计算炸弹（见 options.ts 注释）。 */
function assertValidWindow(window: number): void {
  if (!Number.isInteger(window) || window < 0 || window > MAX_VERIFY_WINDOW) {
    otpFail("INVALID_WINDOW");
  }
}

export function verify(
  provider: HmacProvider,
  params: EngineParams,
  token: string,
  counter: number,
  window: number,
): number | null {
  // 校验顺序遵循 errors.ts 的优先级：配置类（counter / window）先于输入类（token），
  // 避免调用方写错参数时被用户输入错误掩盖。
  if (!isSafeCounter(counter)) {
    otpFail("INVALID_COUNTER");
  }
  assertValidWindow(window);
  if (!isNumericToken(token) || token.length !== params.digits) {
    otpFail("INVALID_TOKEN");
  }

  let firstMatch: number | null = null;
  for (let delta = -window; delta <= window; delta++) {
    const candidate = counter + delta;
    if (candidate < 0 || !isSafeCounter(candidate)) {
      continue;
    }
    const candidateToken = generate(provider, params, candidate);
    if (constantTimeEquals(candidateToken, token)) {
      if (firstMatch === null) {
        // window=0 时循环首项是 -0：归一化为 +0，避免调用方用 Object.is 判断时出现意外
        firstMatch = delta === 0 ? 0 : delta;
      }
    }
  }
  return firstMatch;
}
