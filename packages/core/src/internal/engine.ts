/**
 * 编排层：counter → code 全链路（纯函数，接收注入 provider，零平台依赖）。
 * 取模只在 digits.format 做一次；verify 扫完全部候选后才返回**最接近基准步**的命中 delta
 * （|delta| 最小，同 |delta| 时取负方向），恒定时间。
 */

import type { HmacProvider } from "../crypto";
import { otpFail } from "../errors";
import { MAX_VERIFY_WINDOW } from "../options";
import { algorithmSpec } from "./algorithm";
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
    // provider 违反返回值契约（非 Uint8Array）同样视为 crypto 层缺陷。
    // 这里刻意只认 Uint8Array，不复用 Secret 侧的「8 位无符号视图」宽判（internal/bytes.ts）：
    // 摘要的语义就是 Uint8Array，平台 provider 也都返回它，收紧能尽早暴露实现偏差。
    // 已知限制：跨 realm（Worker / 独立 JS 上下文）返回的 typed array 会因 instanceof 失败被判违约。
    otpFail("CRYPTO_FAILED");
  }
  const spec = algorithmSpec(params.algorithm);
  if (spec === undefined) {
    // 未知算法是「算法不被接受」而不是 crypto 层故障：与 pure-js / ohos provider 的
    // INVALID_ALGORITHM 同一语义（公共 API 已在构造期与 URI parse 校验，这里是防御分支）。
    otpFail("INVALID_ALGORITHM");
  }
  if (digest.length !== spec.digestLength) {
    // 摘要长度必须与算法匹配（SHA1=20 / SHA256=32 / SHA512=64，见 internal/algorithm.ts）：
    // 长度不对时截断会静默产出「看起来合法」的错误码（过短由 truncate 兜底，过长 / 算法不匹配
    // 只能在这里拦），统一收敛。
    otpFail("CRYPTO_FAILED");
  }
  return formatDigits(truncateApply(digest), params.digits);
}

/** token 必须为纯数字且非空；逐字符校验，避免正则。
 * 先判容器：JS 调用方可能传 `undefined` / `null` / 数字，同样归为 INVALID_TOKEN，
 * 不露原生 TypeError（`token.length` 在非字符串上是 undefined / 抛错）。
 */
function isNumericToken(token: string): boolean {
  if (typeof token !== "string" || token.length === 0) {
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

/**
 * 窗口内恒定时间比对。
 *
 * 扫描顺序按 |delta| 递增（0、-1、+1、-2、+2 …），且**每个候选都算、都比较**，不做早退：
 * - 只保留第一个命中（= |delta| 最小），因此返回的偏移是「最可能的那一步」；
 * - 不因为命中就跳过后续候选的比对，避免用计时差泄漏「命中了第几个窗口」。
 *
 * 为什么不是「从 -window 递增扫、首个命中为准」：多个候选同时命中的概率虽只有 ~window/10^digits，
 * 但按最负偏移返回会让调用方把 counter 往回推（如 HOTP 重置 `counter + delta + 1`），
 * 属于可避免的重复放行面；同 |delta| 时优先负方向与旧行为保持一致（先看过期一侧）。
 */
export function verify(
  provider: HmacProvider,
  params: EngineParams,
  token: string,
  counter: number,
  window: number,
): number | null {
  // 校验顺序遵循 errors.ts 的优先级：配置类（counter / window）先于输入类（token），
  // 避免调用方写错参数时被用户输入错误掩盖。
  // token 的非字符串形态（JS 调用方）与格式非数字同归 INVALID_TOKEN（isNumericToken 内先判容器）。
  if (!isSafeCounter(counter)) {
    otpFail("INVALID_COUNTER");
  }
  assertValidWindow(window);
  if (!isNumericToken(token) || token.length !== params.digits) {
    otpFail("INVALID_TOKEN");
  }

  let matched: number | null = null;
  for (let distance = 0; distance <= window; distance++) {
    // 先回看（distance > 0 才有意义；负 counter 表示 epoch 之前，直接跳过不报错）
    if (distance > 0) {
      const back = counter - distance;
      if (back >= 0 && isSafeCounter(back)) {
        const backToken = generate(provider, params, back);
        const isBackMatch = constantTimeEquals(backToken, token);
        if (isBackMatch && matched === null) {
          matched = -distance;
        }
      }
    }
    // 再看当前 / 前瞻（distance = 0 时即基准步本身，避免 -0）
    const ahead = counter + distance;
    if (isSafeCounter(ahead)) {
      const aheadToken = generate(provider, params, ahead);
      const isAheadMatch = constantTimeEquals(aheadToken, token);
      if (isAheadMatch && matched === null) {
        matched = distance;
      }
    }
  }
  return matched;
}
