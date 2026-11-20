/**
 * 取模 + 左补零格式化（纯函数，零平台依赖）。
 * 取模是本库唯一发生点；补零用模板字符串，规避平台字符串补位 API 的可用性差异。
 */
import { otpFail } from "../errors";
import { ALLOWED_DIGITS, type AlgorithmName } from "../options";
import { algorithmSpec } from "./algorithm";

/**
 * 位数集合的唯一来源是 `options.ts` 的 `ALLOWED_DIGITS`（RFC 4226 §5.3 允许 6/7/8）。
 * 刻意不在这里再写一份字面量：本文件的 `POW10` 只覆盖到 8 位，
 * 两处若各写一份，新增成员漏改只会表现为 format 静默产出 "NaN"。
 * `tests/otp/digits.test.ts::allowedDigits_singleSource` 盯住「允许集合 ↔ 10^n 表」。
 *
 * 返回值是普通 boolean（不写成 `6 | 7 | 8` 的类型谓词）：本文件会被 sync-core
 * 复制进 ohos 的 HAR 编译图，ArkTS 对用户定义的类型谓词支持受限，不为类型糖引入风险。
 */
export function isValidDigits(digits: number): boolean {
  for (let i = 0; i < ALLOWED_DIGITS.length; i++) {
    if (ALLOWED_DIGITS[i] === digits) {
      return true;
    }
  }
  return false;
}

// 构造期防非法算法值穿透到 provider（URI parse 已同规则校验）。
// 判定与 engine / provider 同源：算法事实只在 internal/algorithm.ts 维护一份。
export function isValidAlgorithm(
  algorithm: string,
): algorithm is AlgorithmName {
  return algorithmSpec(algorithm) !== undefined;
}

/** 10^n 表（只覆盖 6/7/8；避免每次 format 重算幂与字符串补零的额外转换）。
 * 必须覆盖 `ALLOWED_DIGITS` 的每个成员——少一个就会算出 `value % undefined` = NaN
 * （由 digits.test.ts 的一致性用例拦截）。 */
const POW10 = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8];

export function format(value: number, digits: number): string {
  if (!isValidDigits(digits)) {
    otpFail("INVALID_DIGITS");
  }

  let text = String(value % POW10[digits]);
  while (text.length < digits) {
    text = `0${text}`;
  }
  return text;
}
