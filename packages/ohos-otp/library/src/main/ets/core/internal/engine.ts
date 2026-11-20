// AUTO-GENERATED from packages/core/src/internal/engine.ts (core@d4941b5). DO NOT EDIT. Run: bun run sync:core
/**
 * 编排层：counter → code 全链路（纯函数，接收注入 provider，零平台依赖）。
 * 取模只在 digits.format 做一次；verify 扫完全部候选后才返回首个命中 delta（恒定时间）。
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
