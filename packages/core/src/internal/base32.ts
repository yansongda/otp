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
 * 归一化之后仍由本函数独占「什么算空白」的口径（`\s` 含全角空格 / NBSP 等），
 * 位拼接只面对大写字母表，不再重复判断空白。
 */
export function normalize(input: string): string {
  return input.replace(/\s/g, "").replace(/=+$/, "").toUpperCase();
}

/**
 * 字符码 → 5 bit 值（-1 = 非法）。
 * 表长 128 而非 256：归一化后只可能是大写 A-Z + 2-7（全 ASCII），越界码点一律按非法处理，
 * 这样越界判断只需 `code < 128` 一次。
 * 用查表替代 `BASE32_ALPHABET.indexOf(char)`（后者每个字符都要扫一遍 32 字符表）；
 * 实测 decode 16 字符串约 3.5x、decodeStrict 128 字符串约 1.8x（`bun run bench:ab` 同机 A/B）。
 *
 * 用显式循环而非 `Int8Array#fill`：`.fill` 是运行时 API，微信端「ES5 降级」不会补它；
 * 这里只在导入期跑一次，不值得为省两行代码引入一个兼容下限判断。
 */
const CHAR_VALUES = new Int8Array(128);
for (let i = 0; i < CHAR_VALUES.length; i++) {
  CHAR_VALUES[i] = -1;
}
for (let i = 0; i < BASE32_ALPHABET.length; i++) {
  CHAR_VALUES[BASE32_ALPHABET.charCodeAt(i)] = i;
}

/**
 * 归一化串 → 字节（单遍位缓冲：8 个 5 bit 组 = 5 字节，末组按剩余有效字节截断）。
 *
 * 位缓冲里只有低 12 位是「有意义的窗口」（循环顶 `bits ≤ 7`，每次 +5 bit、凑满 8 bit 即输出），
 * `& 0xffff` 把缓冲截在 16 位内，防止更早的陈旧位无限左移；输出侧
 * `(buffer >>> bits) & 0xff` 只读窗口内的那 8 位，所以陈旧位永不污染结果
 * （等价于 RFC 4648 的末组补 0）。
 *
 * 错误码顺序（与 decodeStrict 完全一致，也是改造前的既有契约）：先字符、后长度。
 * `SECRET_TOO_SHORT` 放在循环之后判定——先算长度只是为了分配结果数组，与
 * 「字符是否合法」无关；两条判定复用同一次遍历，没有额外遍历成本。
 */
function decodeNormalized(normalized: string): Uint8Array {
  const length = Math.floor((normalized.length * 5) / 8);
  const result = new Uint8Array(length);
  let buffer = 0;
  let bits = 0;
  let outIndex = 0;

  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    const value = code < 128 ? CHAR_VALUES[code] : -1;
    if (value < 0) {
      otpFail("INVALID_BASE32_CHAR");
    }
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      result[outIndex] = (buffer >>> bits) & 0xff;
      outIndex += 1;
    }
  }

  // 归一化后恰 1 字符（5 bit）解不出任何字节；字符非法已在循环里先报过。
  if (outIndex === 0) {
    otpFail("SECRET_TOO_SHORT");
  }

  return result;
}

/**
 * RFC 4648 §6 解码（先归一化）。
 * 空串抛 EMPTY_SECRET；非法字符抛 INVALID_BASE32_CHAR；解码长度 0（= 归一化后恰 1 字符）
 * 抛 SECRET_TOO_SHORT。
 */
export function decode(input: string): Uint8Array {
  const normalized = normalize(input);
  if (normalized.length === 0) {
    otpFail("EMPTY_SECRET");
  }
  return decodeNormalized(normalized);
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
 * 归一化自身（大小写 / 空白 / 尾部 '='）仍被容忍。错误码优先级与 decode 完全一致：
 * 空 → EMPTY_SECRET，非法字符 → INVALID_BASE32_CHAR，解码后不足 1 字节 → SECRET_TOO_SHORT
 * （与宽松模式同码，调用方切 strict 不会拿到不同的失败语义），再到 INVALID_BASE32_PADDING。
 */
export function decodeStrict(input: string): Uint8Array {
  const normalized = normalize(input);

  if (normalized.length === 0) {
    otpFail("EMPTY_SECRET");
  }

  // 先解码再判尾长：单字符（尾长 1）在宽松模式下已是 SECRET_TOO_SHORT，
  // 严格模式若先报 PADDING，同一致命输入会因开关不同而暴露两个不同错误码。
  const bytes = decodeNormalized(normalized);

  const tail = normalized.length % 8;
  if (tail === 1 || tail === 3 || tail === 6) {
    otpFail("INVALID_BASE32_PADDING");
  }

  if (encode(bytes) !== normalized) {
    otpFail("INVALID_BASE32_PADDING");
  }
  return bytes;
}
