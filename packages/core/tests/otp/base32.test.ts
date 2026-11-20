/**
 * RFC 4648 §6 base32 编解码测试（宽松 / 严格两种语义）。
 */
import { describe, expect, it } from "bun:test";
import {
  decode,
  decodeStrict,
  encode,
  normalize,
} from "../../src/internal/base32";
import { expectCode } from "./helpers";
import { asciiBytes, bytesEqual, RFC4648_BASE32 } from "./vectors";

describe("base32", () => {
  it("decodeRfcSecret_20Bytes", () => {
    const bytes = decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(bytes.length).toBe(20);
    expect(bytes[0]).toBe(49);
    expect(bytes[19]).toBe(48);
  });

  it("decodeTailGroupTruncate_MY", () => {
    const bytes = decode("MY");
    expect(bytes.length).toBe(1);
    expect(bytes[0]).toBe(0x66);
  });

  it("decodeCaseInsensitiveAndPaddingEquivalent", () => {
    const reference = decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(
      bytesEqual(decode("gezdgnbvgy3tqojqgezdgnbvgy3tqojq"), reference),
    ).toBe(true);
    expect(
      bytesEqual(decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ======"), reference),
    ).toBe(true);
  });

  it("decodeLeadingAndInternalWhitespace", () => {
    const reference = decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    const messy = decode("  \tGEZD GNBV\nGY3T\rQOJQ GEZDGNBV GY3TQOJQ  ");
    expect(bytesEqual(messy, reference)).toBe(true);
  });

  it("decodeMultiplePaddingAmounts", () => {
    const reference = decode("GEZDGNBVGY3TQOJQ");
    expect(bytesEqual(decode("GEZDGNBVGY3TQOJQ="), reference)).toBe(true);
    expect(bytesEqual(decode("GEZDGNBVGY3TQOJQ===="), reference)).toBe(true);
    expect(bytesEqual(decode("GEZDGNBVGY3TQOJQ======"), reference)).toBe(true);
    expect(bytesEqual(decode("GEZDGNBVGY3TQOJQ========"), reference)).toBe(
      true,
    );
  });

  it("decodeBoundaryLengths_1to64Bytes", () => {
    for (let n = 1; n <= 64; n++) {
      const arr = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        arr[i] = (i * 91 + 17) & 0xff;
      }
      const encoded = encode(arr);
      const decoded = decode(encoded);
      expect(decoded.length).toBe(n);
      expect(bytesEqual(decoded, arr)).toBe(true);
    }
  });

  it("decodeEmptyThrowsEmptySecret", () => {
    expectCode(() => decode(""), "EMPTY_SECRET");
    expectCode(() => decode("   "), "EMPTY_SECRET");
    expectCode(() => decode("===="), "EMPTY_SECRET");
  });

  it("decodeSingleCharThrowsTooShort", () => {
    expectCode(() => decode("A"), "SECRET_TOO_SHORT");
  });

  it("decodeSingleInvalidChar_charErrorFirst", () => {
    // 错误码归因（⚠ 别改成「长度先判」）：归一化后恰 1 字符时仍然先报字符错误，
    // 因为「你打错了一个字符」比「secret 太短」对排障更有用。改造前的实现就是这个顺序，
    // 单遍位缓冲也能保持它（SECRET_TOO_SHORT 放循环之后判定，见 decodeNormalized）。
    // 含尾部 '=' 的例子（"\t-=" 归一化后只剩 "-"）防止 normalize 与长度判定脱节。
    for (const input of ["1", "0", "!", "@", "\u212a", "\t-="]) {
      expectCode(() => decode(input), "INVALID_BASE32_CHAR");
      expectCode(() => decodeStrict(input), "INVALID_BASE32_CHAR");
    }
    // 合法单字符仍是「解不出 1 字节」，两种模式同码。
    expectCode(() => decode("A"), "SECRET_TOO_SHORT");
    expectCode(() => decodeStrict("A"), "SECRET_TOO_SHORT");
  });

  it("decodeIllegalChars", () => {
    expectCode(() => decode("AB1"), "INVALID_BASE32_CHAR");
    expectCode(() => decode("ab0"), "INVALID_BASE32_CHAR");
    // 字符错误始终先于长度 / 尾长校验（与该输入有多长无关）。
    expectCode(() => decode("1A"), "INVALID_BASE32_CHAR");
  });

  it("decodeStrict_rfc4648VectorsRoundTrip", () => {
    for (const v of RFC4648_BASE32) {
      const canonical = normalize(v.base32Padded);
      if (canonical === "") {
        continue; // 空串另有 EMPTY_SECRET 用例
      }
      const bytes = decodeStrict(canonical);
      expect(bytesEqual(bytes, asciiBytes(v.plain))).toBe(true);
      expect(encode(bytes)).toBe(canonical);
    }
  });

  it("decodeStrict_acceptsLenientNormalization", () => {
    const reference = decodeStrict("MY");
    expect(bytesEqual(decodeStrict("MY======"), reference)).toBe(true);
    expect(bytesEqual(decodeStrict("  my \n"), reference)).toBe(true);
    expect(bytesEqual(decodeStrict("My"), reference)).toBe(true);
    expect(reference[0]).toBe(0x66);
  });

  it("decodeStrict_rejectsNonZeroTailBits", () => {
    // 末字符低位填充位被翻为非 0（尾长合法但填充位非法）
    expectCode(() => decodeStrict("MB"), "INVALID_BASE32_PADDING");
    expectCode(() => decodeStrict("MZXR"), "INVALID_BASE32_PADDING");
    expectCode(() => decodeStrict("MZXW7"), "INVALID_BASE32_PADDING");
    expectCode(() => decodeStrict("MZXW6YT"), "INVALID_BASE32_PADDING");
    expectCode(() => decodeStrict("MZXW6YTBOJ"), "INVALID_BASE32_PADDING");
  });

  it("decodeStrict_rejectsImpossibleTailLength", () => {
    // 尾长 3 / 6 属结构性非法；尾长 1（单字符）见下条同码用例
    expectCode(() => decodeStrict("AAA"), "INVALID_BASE32_PADDING");
    expectCode(() => decodeStrict("MZXW6Y"), "INVALID_BASE32_PADDING");
  });

  it("decodeStrict_charErrorBeforeTailLength", () => {
    expectCode(() => decodeStrict("AB1"), "INVALID_BASE32_CHAR");
  });

  it("decodeStrict_emptyThrowsEmptySecret", () => {
    expectCode(() => decodeStrict(""), "EMPTY_SECRET");
    expectCode(() => decodeStrict("   "), "EMPTY_SECRET");
    expectCode(() => decodeStrict("===="), "EMPTY_SECRET");
  });

  it("decodeStrict_sameInputSameCodeAsLenient", () => {
    // 同一致命输入不因 strict 开关不同而换码：'A' 两种模式都是 SECRET_TOO_SHORT
    expectCode(() => decode("A"), "SECRET_TOO_SHORT");
    expectCode(() => decodeStrict("A"), "SECRET_TOO_SHORT");
  });

  it("encodeDecodeRoundTrip_Seeds", () => {
    const sha1Seed = asciiBytes("12345678901234567890");
    const sha256Seed = asciiBytes("12345678901234567890123456789012");
    const sha512Seed = asciiBytes(
      "1234567890123456789012345678901234567890123456789012345678901234",
    );
    expect(encode(sha1Seed)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(encode(sha256Seed)).toBe(
      "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA",
    );
    expect(encode(sha512Seed)).toBe(
      "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" +
        "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA",
    );
    expect(bytesEqual(decode(encode(sha512Seed)), sha512Seed)).toBe(true);
  });

  it("encodeEmptyReturnsEmptyString", () => {
    expect(encode(new Uint8Array(0))).toBe("");
  });

  it("encodeUppercaseNoPaddingAndLengthFormula", () => {
    const encoded = encode(asciiBytes("12345678901234567890"));
    expect(encoded === encoded.toUpperCase()).toBe(true);
    expect(encoded.indexOf("=")).toBe(-1);
    expect(encoded.length).toBe(32);
  });

  it("decode_toleratesAllJsWhitespace", () => {
    // 归一化的空白口径就是 JS 的 `\s`（含 NBSP / 全角空格 / BOM），
    // 位拼接层不重复判空白：解成单遍查表后，这条用例防止空白集合被悄悄收窄。
    const whitespace = [
      " ",
      "\t",
      "\n",
      "\r",
      "\v",
      "\f",
      "\u00a0",
      "\u1680",
      "\u2028",
      "\u3000",
      "\ufeff",
    ];
    for (const ch of whitespace) {
      const bytes = decode(`GEZDG${ch}NBVGY3TQOJQGEZDGNBVGY3TQOJQ`);
      expect(bytes.length).toBe(20);
    }
  });

  it("encodeDecodeRoundTrip_allByteLengths", () => {
    // 覆盖「每 5 字节一组」的末组所有余量（末组 1~5 字节）与跨组边界
    for (let length = 1; length <= 70; length++) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        bytes[i] = (i * 37 + length) & 0xff;
      }
      const text = encode(bytes);
      expect(text.length).toBe(Math.ceil((length * 8) / 5));
      expect(bytesEqual(decode(text), bytes)).toBe(true);
      expect(bytesEqual(decodeStrict(text), bytes)).toBe(true);
      // 宽松模式的归一化（大小写 / 空白 / 尾部填充）不影响结果
      expect(bytesEqual(decode(`${text.toLowerCase()}\n==`), bytes)).toBe(true);
    }
  });
});
