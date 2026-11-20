/**
 * digits / algorithm 校验 + 取模补零（唯一取模点）。
 */
import { describe, expect, it } from "bun:test";
import {
  format,
  isValidAlgorithm,
  isValidDigits,
} from "../../src/internal/digits";
import { ALLOWED_DIGITS } from "../../src/options";
import { expectCode } from "./helpers";

describe("digits", () => {
  it("format_6_7_8", () => {
    expect(format(287082, 6)).toBe("287082");
    expect(format(287082, 7)).toBe("0287082");
    expect(format(287082, 8)).toBe("00287082");
  });

  it("format_zeroPadsToFullWidth", () => {
    expect(format(0, 6)).toBe("000000");
    expect(format(7, 8)).toBe("00000007");
  });

  it("format_moduloOnlyOnce", () => {
    // 取模在 format 唯一发生点：10^digits 只截断一次，不做二次归一化
    expect(format(1000000, 6)).toBe("000000");
    expect(format(999999, 6)).toBe("999999");
  });

  it("format_invalidDigits_throws", () => {
    expectCode(() => format(0, 5), "INVALID_DIGITS");
    expectCode(() => format(0, 9), "INVALID_DIGITS");
    expectCode(() => format(0, 6.5), "INVALID_DIGITS");
  });

  it("isValidDigits_only_6_7_8", () => {
    expect(isValidDigits(6)).toBe(true);
    expect(isValidDigits(7)).toBe(true);
    expect(isValidDigits(8)).toBe(true);
    expect(isValidDigits(5)).toBe(false);
    expect(isValidDigits(9)).toBe(false);
  });

  it("allowedDigits_singleSource", () => {
    // ALLOWED_DIGITS 是位数集合的唯一事实源：isValidDigits 必须与它逐项一致，
    // 且 format 的 10^n 表必须覆盖每个成员（漏一个会让 `value % undefined` 静默产出 "NaN"）。
    // 新增位数时漏改任一处都会在这里红，而不是线上才发出错码。
    const accepted: number[] = [];
    for (let digits = 1; digits <= 12; digits++) {
      if (isValidDigits(digits)) {
        accepted.push(digits);
      }
    }
    // 集合比较，不绑定 ALLOWED_DIGITS 的书写顺序（日后插一个新位数不该报「顺序不对」）
    const sorted = (list: ReadonlyArray<number>) =>
      [...list].sort((a, b) => a - b);
    expect(sorted(accepted)).toEqual(sorted(ALLOWED_DIGITS));

    for (const digits of ALLOWED_DIGITS) {
      expect(format(0, digits)).toBe("0".repeat(digits));
      expect(format(10 ** digits - 1, digits)).toBe("9".repeat(digits));
    }
  });

  it("isValidAlgorithm_only_three_values", () => {
    expect(isValidAlgorithm("SHA1")).toBe(true);
    expect(isValidAlgorithm("SHA256")).toBe(true);
    expect(isValidAlgorithm("SHA512")).toBe(true);
    expect(isValidAlgorithm("MD5" as "SHA1")).toBe(false);
  });
});
