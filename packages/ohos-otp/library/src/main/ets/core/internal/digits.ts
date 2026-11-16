// AUTO-GENERATED from packages/core/src/internal/digits.ts. DO NOT EDIT. Run: bun run sync:core
/**
 * 取模 + 左补零格式化（纯函数，零平台依赖）。
 * 取模是本库唯一发生点；补零用模板字符串，规避平台字符串补位 API 的可用性差异。
 */
import { otpFail } from "../errors";
import { ALGORITHMS, type AlgorithmName } from "../options";

export function isValidDigits(digits: number): boolean {
  return digits === 6 || digits === 7 || digits === 8;
}

// 构造期防非法算法值穿透到 provider（URI parse 已同规则校验）。
export function isValidAlgorithm(
  algorithm: string,
): algorithm is AlgorithmName {
  return (ALGORITHMS as readonly string[]).includes(algorithm);
}

/** 10^n 表（只覆盖 6/7/8；避免每次 format 重算幂与字符串补零的额外转换）。 */
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
