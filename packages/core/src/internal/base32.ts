/**
 * RFC 4648 §6 base32 编解码（纯函数，零平台依赖）。
 * 字母表 A-Z + 2-7；encode 输出大写无填充；decode 宽松（容忍空白 / 大小写 / 尾部 '='），
 * decodeStrict 追加尾长与填充位校验（供 { strict: true } 使用）。
 */
import { otpFail } from "../errors";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * 归一化：去空白 → 去尾部 '=' → 转大写。
 * decode 与 decodeStrict 必须共用本函数：各自复制一份会让「规范形式」的判据漂移。
 */
export function normalize(input: string): string {
  return input.replace(/\s/g, "").replace(/=+$/, "").toUpperCase();
}

/**
 * 归一化串 → 每字符 5 bit 数值；非法字符抛 INVALID_BASE32_CHAR。
 * 一次查表供后续位拼接复用：原先校验与拼接各查一遍（每组还额外分配 number[]）。
 */
function valuesOf(normalized: string): Uint8Array {
  const values = new Uint8Array(normalized.length);
  for (let i = 0; i < normalized.length; i++) {
    const value = BASE32_ALPHABET.indexOf(normalized.charAt(i));
    if (value === -1) {
      otpFail("INVALID_BASE32_CHAR");
    }
    values[i] = value;
  }
  return values;
}

/** 取第 i 个 5 bit 值；越界按 0 补位（RFC 4648 末组缺位补 0）。 */
function valueAt(values: Uint8Array, index: number): number {
  return index < values.length ? values[index] : 0;
}

/**
 * 5 bit 值 → 字节（8 字符一组 = 5 字节，末组按剩余有效字节截断）。
 * 长度 0（即输入仅 1 字符）时抛 SECRET_TOO_SHORT。
 */
function assemble(values: Uint8Array): Uint8Array {
  const length = Math.floor((values.length * 5) / 8);
  if (length === 0) {
    otpFail("SECRET_TOO_SHORT");
  }

  const result = new Uint8Array(length);
  let outIndex = 0;

  for (let start = 0; start < values.length; start += 8) {
    const end = Math.min(start + 8, values.length);
    const bytesInGroup = Math.floor(((end - start) * 5) / 8);

    const b0 = valueAt(values, start);
    const b1 = valueAt(values, start + 1);
    const b2 = valueAt(values, start + 2);
    const b3 = valueAt(values, start + 3);
    const b4 = valueAt(values, start + 4);
    const b5 = valueAt(values, start + 5);
    const b6 = valueAt(values, start + 6);
    const b7 = valueAt(values, start + 7);

    // RFC 4648 位拼接；每字节 & 0xff 收敛为无符号字节。
    if (bytesInGroup >= 1) {
      result[outIndex] = ((b0 << 3) | (b1 >> 2)) & 0xff;
    }
    if (bytesInGroup >= 2) {
      result[outIndex + 1] = ((b1 << 6) | (b2 << 1) | (b3 >> 4)) & 0xff;
    }
    if (bytesInGroup >= 3) {
      result[outIndex + 2] = ((b3 << 4) | (b4 >> 1)) & 0xff;
    }
    if (bytesInGroup >= 4) {
      result[outIndex + 3] = ((b4 << 7) | (b5 << 2) | (b6 >> 3)) & 0xff;
    }
    if (bytesInGroup >= 5) {
      result[outIndex + 4] = ((b6 << 5) | b7) & 0xff;
    }
    outIndex += bytesInGroup;
  }

  return result;
}

/**
 * RFC 4648 §6 解码（先归一化）。
 * 空串抛 EMPTY_SECRET；非法字符抛 INVALID_BASE32_CHAR；解码长度 0 抛 SECRET_TOO_SHORT。
 */
export function decode(input: string): Uint8Array {
  const normalized = normalize(input);
  if (normalized.length === 0) {
    otpFail("EMPTY_SECRET");
  }
  return assemble(valuesOf(normalized));
}

/**
 * RFC 4648 §6 编码（大写、无填充）。输出字符数 = ceil(len*8/5)；空数组返回空串。
 * 实现：8 位进 / 5 位出的位缓冲拼接，不经过逐字符二进制字符串。
 */
export function encode(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  const parts: string[] = [];
  let buffer = 0;
  let bitsLeft = 0;
  for (let i = 0; i < bytes.length; i++) {
    buffer = (buffer << 8) | bytes[i];
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      parts.push(BASE32_ALPHABET.charAt((buffer >>> (bitsLeft - 5)) & 31));
      bitsLeft -= 5;
    }
  }
  // 末组余量左移补 0（无填充）。
  if (bitsLeft > 0) {
    parts.push(BASE32_ALPHABET.charAt((buffer << (5 - bitsLeft)) & 31));
  }
  return parts.join("");
}

/**
 * 严格解码：归一化后必须是「解码再编码可无损还原」的规范形式。
 *
 * 为什么这样判定：RFC 4648 §6 以 8 字符（40 bit = 5 字节）为单位，合法尾长只有 {0,2,4,5,7}；
 * 尾长 ∈ {1,3,6} 会让 decode 静默丢弃余量位。尾长合法时，末字符低位填充位必须为 0
 * —— 等价于 encode(decode(s)) === s，一次再编码比对即可覆盖两种失真。
 *
 * 归一化自身（大小写 / 空白 / 尾部 '='）仍被容忍。错误码优先级与 decode 一致：
 * 空 → EMPTY_SECRET，非法字符 → INVALID_BASE32_CHAR，再到 INVALID_BASE32_PADDING。
 */
export function decodeStrict(input: string): Uint8Array {
  const normalized = normalize(input);

  if (normalized.length === 0) {
    otpFail("EMPTY_SECRET");
  }

  const values = valuesOf(normalized);

  const tail = normalized.length % 8;
  if (tail === 1 || tail === 3 || tail === 6) {
    otpFail("INVALID_BASE32_PADDING");
  }

  const bytes = assemble(values);
  if (encode(bytes) !== normalized) {
    otpFail("INVALID_BASE32_PADDING");
  }
  return bytes;
}
