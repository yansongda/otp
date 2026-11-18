// AUTO-GENERATED from packages/core/src/otpauth-uri.ts. DO NOT EDIT. Run: bun run sync:core
/**
 * OTPAuthURI：otpauth:// URI 解析与生成（零平台依赖）。
 * 遵循 Google Authenticator Key URI Format（IANA Provisional #13829）；
 * query 手写拆分，不依赖平台 URL 查询解析 API。
 */
import { otpFail } from "./errors";
import { decode, decodeStrict, encode } from "./internal/base32";
import { isSafeCounter } from "./internal/counter";
import { isValidAlgorithm, isValidDigits } from "./internal/digits";
import type { OtpAuthParams, ParseOptions } from "./options";
import {
  DEFAULT_ALGORITHM,
  DEFAULT_COUNTER,
  DEFAULT_DIGITS,
  DEFAULT_PERIOD,
  isStrictOption,
} from "./options";

/** 百分号解码；失败回退原串（不抛错，最大化互操作）。 */
function decodePart(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * 百分号编码；`encodeURIComponent` 遇到孤立代理字符（未配对的 UTF-16 半字）会抛原生 `URIError`。
 * 公开契约是「一切失败均抛 OtpError」（`toURI()` 也走这里），因此收敛为 `INVALID_OTPAUTH_URI`
 * ——该 URI 无法被任何扫码方还原，属构建期非法输入，而不是 crypto 或 base32 的问题。
 */
function encodePart(raw: string): string {
  try {
    return encodeURIComponent(raw);
  } catch {
    return otpFail("INVALID_OTPAUTH_URI");
  }
}

/**
 * 按 Key URI Format 的 label ABNF（IANA Provisional #13829）定位分隔符：
 *
 *   label = accountname / issuer (":" / "%3A") *"%20" accountname
 *
 * 判定是「原始串中首个 `:` 或 `%3A`（十六进制大小写不敏感）」，与 ABNF 的书写顺序一致，
 * 也与主流实现（如 hectorm/otpauth 的 `split(/(?::|%3A) *(.+)/i)`）一致。
 * 刻意不依赖 query 里有没有 issuer、也不比较前缀与 issuer 是否相等：规范要求两者相等，
 * 不相等属于签发方的数据问题，不应改变分隔符的判定（否则同一 label 会有两种解释）。
 * 手工扫描而非 `toLowerCase().indexOf("%3a")`：`İ`、`ẞ` 这类小写后长度会变的字符会让
 * 下标与原始串错位。返回分隔符起点下标；没有分隔符返回 -1（宽度由 `:` / `%3A` 再判：1 或 3）。
 */
function findLabelSeparator(input: string): number {
  for (let i = 0; i < input.length; i++) {
    const c = input.charAt(i);
    if (c === ":") {
      return i;
    }
    if (
      c === "%" &&
      i + 2 < input.length &&
      input.charAt(i + 1) === "3" &&
      input.charAt(i + 2).toLowerCase() === "a"
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * 剥掉分隔符之后的前导空格 padding（ABNF 的 `*"%20"`：`%20` 序列与原始空格都算）。
 * 这些空格属于 label 的语法分隔，不属于 account 名。与之对称，build 在 issuer 非空时
 * 拒绝以空格开头的 account，保证 `build → parse` 往返闭合。
 */
function stripPadding(raw: string): string {
  let i = 0;
  while (i < raw.length) {
    if (raw.charAt(i) === " ") {
      i += 1;
      continue;
    }
    if (
      raw.charAt(i) === "%" &&
      raw.charAt(i + 1) === "2" &&
      raw.charAt(i + 2) === "0"
    ) {
      i += 3;
      continue;
    }
    break;
  }
  return raw.substring(i);
}

/**
 * URI 数字参数解析：只接受纯十进制数字串（拒绝 0x / 科学计数 / 正负号 / 小数 / 空白）。
 * 为什么不用 Number()：`Number("0x7") === 7`、`Number("1e3") === 1000`，会把扫码导入边界
 * 变成宽松解析；返回 null 表示非法，范围与安全整数判定由调用方按各自错误码处理。
 */
function parseDecimal(raw: string): number | null {
  if (raw.length === 0) {
    return null;
  }
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 48 || c > 57) {
      return null;
    }
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export class OTPAuthURI {
  /**
   * 解析 otpauth:// URI 为 OtpAuthParams：scheme 大小写不敏感 → type 限 totp/hotp →
   * query 手写拆分 → label 在**原始串**上定位 ABNF 分隔符后逐段百分号解码（失败回退原串）→
   * digits / period / counter 只接受纯十进制整数（拒绝 0x / 科学计数 / 小数）→
   * secret 规范化为大写无填充 base32；未知参数忽略，query 的 issuer 优先于 label 前缀。
   * label 按 Key URI Format 的 ABNF 解析：`label = accountname / issuer (":" / "%3A")
   * *"%20" accountname` —— 原始串中首个 `:` 或 `%3A`（十六进制大小写不敏感）即分隔符，
   * 其后空格是 padding；没有分隔符时整段就是 account。
   * label 为空（`otpauth://totp/?...`，没有 account）时保持宽松：结果不带 account，
   * 由调用方决定是否使用；但 build 拒绝这种参数（Key URI Format 的 label 必填）。
   * options.strict 非 false（见 isStrictOption）时 secret 必须是规范 base32，否则 INVALID_BASE32_PADDING。
   * 入参不是字符串（JS 调用方）→ INVALID_OTPAUTH_URI，不漏原生 TypeError；
   * options 传 null 与未传等价。
   */
  static parse(uri: string, options?: ParseOptions | null): OtpAuthParams {
    // ⓪ 先判容器：TS 类型只约束编译期，`uri.toLowerCase()` 在非字符串入参上会漏 TypeError
    if (typeof uri !== "string") {
      otpFail("INVALID_OTPAUTH_URI");
    }

    // ① scheme 大小写不敏感
    const prefix = "otpauth://";
    if (uri.toLowerCase().indexOf(prefix) !== 0) {
      otpFail("INVALID_OTPAUTH_URI");
    }
    const rest = uri.substring(prefix.length);
    const qIndex = rest.indexOf("?");
    const beforeQuery = qIndex === -1 ? rest : rest.substring(0, qIndex);
    const queryPart = qIndex === -1 ? "" : rest.substring(qIndex + 1);

    // ② type：'?' 之前、'/' 之后，小写化；非 totp/hotp 抛 UNSUPPORTED_OTPAUTH_TYPE
    const slashIndex = beforeQuery.indexOf("/");
    const typeRaw =
      slashIndex === -1 ? beforeQuery : beforeQuery.substring(0, slashIndex);
    const type = typeRaw.toLowerCase();
    if (type !== "totp" && type !== "hotp") {
      otpFail("UNSUPPORTED_OTPAUTH_TYPE");
    }

    // ③ query 手写拆分：'&' 分段、'=' 分键值，键值均百分号解码（失败回退原串）
    const params = new Map<string, string>();
    if (queryPart !== "") {
      const pairs = queryPart.split("&");
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        if (pair === "") {
          continue;
        }
        const eqIndex = pair.indexOf("=");
        let key: string;
        let value: string;
        if (eqIndex === -1) {
          key = pair;
          value = "";
        } else {
          key = pair.substring(0, eqIndex);
          value = pair.substring(eqIndex + 1);
        }
        params.set(decodePart(key).toLowerCase(), decodePart(value));
      }
    }

    // ④ label：'/' 之后、'?' 之前的部分
    const labelRaw =
      slashIndex === -1 ? "" : beforeQuery.substring(slashIndex + 1);
    // label 字段（parse 回填用）保留整体解码结果；失败回退原串
    const label = decodePart(labelRaw);
    // 切分与解码顺序：先在**原始串**上按 ABNF 定位分隔符，再逐段百分号解码。
    // 不在解码后的串上切：`%3A` 解码后就与分隔冒号无法区分（回填的 label 也因此不保证
    // 能反推出 issuer/account，见 options.ts 的说明）；先切后解码则每段只解一次。
    let issuerFromLabel = "";
    let account = "";
    const sepIndex = findLabelSeparator(labelRaw);
    if (sepIndex === -1) {
      // 无分隔符：ABNF 的 `label = accountname`，整段都是账号（与 label 同值，省一次解码）
      account = label;
    } else {
      const sepWidth = labelRaw.charAt(sepIndex) === ":" ? 1 : 3;
      issuerFromLabel = decodePart(labelRaw.substring(0, sepIndex));
      account = decodePart(
        stripPadding(labelRaw.substring(sepIndex + sepWidth)),
      );
    }

    // secret 必填，经 Base32 校验（空 / 非法字符 / 过短各自抛码）；strict 追加规范形式校验
    const secretRaw = params.get("secret");
    if (secretRaw === undefined || secretRaw === "") {
      otpFail("EMPTY_SECRET");
    }
    const strict = isStrictOption(options);
    const secret = encode(strict ? decodeStrict(secretRaw) : decode(secretRaw));

    // issuer：query 优先，其次 label 前缀；空 query 值按「未提供」处理（否则会凭空抹掉
    // label 里合法的 issuer，与 digits/period/counter 的「空值=缺省」口径也不一致）
    let issuer = issuerFromLabel;
    const issuerQuery = params.get("issuer");
    if (issuerQuery !== undefined && issuerQuery !== "") {
      issuer = issuerQuery;
    }

    // algorithm：大小写不敏感，默认 SHA1；非三值抛 INVALID_ALGORITHM
    let algorithm: string = DEFAULT_ALGORITHM;
    const algorithmRaw = params.get("algorithm");
    if (algorithmRaw !== undefined && algorithmRaw !== "") {
      const upper = algorithmRaw.toUpperCase();
      if (!isValidAlgorithm(upper)) {
        otpFail("INVALID_ALGORITHM");
      }
      algorithm = upper;
    }

    // digits：默认 6，仅 6/7/8，否则 INVALID_DIGITS（只认十进制）
    let digits: number = DEFAULT_DIGITS;
    const digitsRaw = params.get("digits");
    if (digitsRaw !== undefined && digitsRaw !== "") {
      const d = parseDecimal(digitsRaw);
      if (d === null || !isValidDigits(d)) {
        otpFail("INVALID_DIGITS");
      }
      digits = d;
    }

    // period（仅 TOTP）：默认 30，正整数，否则 INVALID_PERIOD
    // counter（仅 HOTP）：默认 0，非负整数，否则 INVALID_COUNTER
    let period: number = DEFAULT_PERIOD;
    let counter: number = DEFAULT_COUNTER;
    if (type === "totp") {
      const periodRaw = params.get("period");
      if (periodRaw !== undefined && periodRaw !== "") {
        const p = parseDecimal(periodRaw);
        if (p === null || p <= 0) {
          otpFail("INVALID_PERIOD");
        }
        period = p;
      }
    } else {
      const counterRaw = params.get("counter");
      if (counterRaw !== undefined && counterRaw !== "") {
        const c = parseDecimal(counterRaw);
        if (c === null) {
          otpFail("INVALID_COUNTER");
        }
        counter = c;
      }
    }

    const result: OtpAuthParams = {
      type,
      secret,
      algorithm,
      digits,
    };
    if (type === "totp") {
      result.period = period;
    } else {
      result.counter = counter;
    }
    if (issuer !== "") {
      result.issuer = issuer;
    }
    if (account !== "") {
      result.account = account;
    }
    if (label !== "") {
      result.label = label;
    }
    return result;
  }

  /**
   * 由 OtpAuthParams 生成规范 URI。参数顺序固定：secret, issuer, algorithm, digits, period|counter。
   * label 仅由 account 派生：`issuer:account`（两者百分号编码、分隔冒号保留）。
   * **account 必填**（缺失 / 空串 → INVALID_OTPAUTH_URI）：Key URI Format 要求 label 必填，
   * 而 label 只能由 account 派生——issuer 单独写进 label 会被 parse 读成 account。
   * **issuer / account 不得含冒号**（ABNF 明文禁止 → INVALID_OTPAUTH_URI）：含冒号的段
   * 必然被任何按规范实现的解析器（包括本库 parse）当分隔符切开；`issuer` 非空时 account
   * 也不得以空格开头（分隔符后的空格是 ABNF 的 padding，parse 会剥掉，往返不闭合）。
   * algorithm 始终输出，
   * digits 仅 !== 6、period 仅 TOTP 且 !== 30 时输出（与 GA 二维码惯例一致），HOTP 始终输出 counter。
   * secret 先经 Base32 规范化（与 parse 对称）；非法 base32 抛对应错误码。
   * 非字符串 `secret`（JS 调用方）→ INVALID_SECRET_CONTAINER；非字符串 / 无法百分号编码的
   * `issuer`·`account`（含孤立代理字符）→ INVALID_OTPAUTH_URI，绝不静默写成 "null"。
   *
   * 校验与 parse 对称：build 的产物必须能被 parse 接受，否则下游扫码方会拿到非法 URI。
   * params.label 是 parse 的回填字段（原始 label），build 一律由 issuer/account 派生，忽略该字段。
   */
  static build(params: OtpAuthParams): string {
    // 顺序与 parse / errors.ts 优先级一致：type → secret → algorithm → digits →
    // account（label 必填）→ period|counter。
    // 非对象（JS 调用方传 null / 字符串 / 数字）→ INVALID_OTPAUTH_URI，不漏原生 TypeError；
    // 数组与缺字段的对象仍走字段校验（首个失败点通常是 UNSUPPORTED_OTPAUTH_TYPE）。
    if (params === null || typeof params !== "object") {
      otpFail("INVALID_OTPAUTH_URI");
    }
    const type = params.type;
    if (type !== "totp" && type !== "hotp") {
      otpFail("UNSUPPORTED_OTPAUTH_TYPE");
    }
    // 运行时（JS 调用方）可能传非字符串：先判容器再 decode，避免漏原生 TypeError
    if (typeof params.secret !== "string") {
      otpFail("INVALID_SECRET_CONTAINER");
    }
    const secret = encode(decode(params.secret));
    if (!isValidAlgorithm(params.algorithm)) {
      otpFail("INVALID_ALGORITHM");
    }
    if (!isValidDigits(params.digits)) {
      otpFail("INVALID_DIGITS");
    }
    const issuer = params.issuer === undefined ? "" : params.issuer;
    const account = params.account === undefined ? "" : params.account;
    // 非字符串（如 null）绝不能静默变成 "null" 写进 URI：它属于 label 参数非法
    if (typeof issuer !== "string" || typeof account !== "string") {
      otpFail("INVALID_OTPAUTH_URI");
    }

    // account 必填：Key URI Format 的 label 必填，而 label 只能由 account 派生。
    // 也不允许拿 issuer 顶替——无原始冒号的 label 会被 parse 读成 account，
    // build → parse 就凭空多出一个与 issuer 同名的账号。
    if (account === "") {
      otpFail("INVALID_OTPAUTH_URI");
    }
    // ABNF 明文：issuer 与 account 都不允许含冒号（"Neither issuer nor account name may
    // themselves contain a colon"）。含冒号的段无论怎么百分号编码，都会被规范解析器
    // 当分隔符切开——编码侧 fail-closed，不产出必然被别人读错的 URI。
    if (issuer.indexOf(":") !== -1 || account.indexOf(":") !== -1) {
      otpFail("INVALID_OTPAUTH_URI");
    }
    // 分隔符后的空格按 ABNF 是 padding，parse 会剥掉；因此 issuer 形态下 account 不得
    // 以空格开头（否则 build → parse 不闭合）。无 issuer 时没有分隔符，前导空格属于账号。
    if (issuer !== "" && account.charAt(0) === " ") {
      otpFail("INVALID_OTPAUTH_URI");
    }
    const label =
      issuer === ""
        ? encodePart(account)
        : `${encodePart(issuer)}:${encodePart(account)}`;

    const parts: string[] = [];
    parts.push(`secret=${secret}`);
    if (issuer !== "") {
      parts.push(`issuer=${encodePart(issuer)}`);
    }
    parts.push(`algorithm=${params.algorithm}`);
    if (params.digits !== DEFAULT_DIGITS) {
      parts.push(`digits=${params.digits}`);
    }
    if (type === "totp") {
      const period =
        params.period === undefined ? DEFAULT_PERIOD : params.period;
      if (!Number.isSafeInteger(period) || period <= 0) {
        otpFail("INVALID_PERIOD");
      }
      if (period !== DEFAULT_PERIOD) {
        parts.push(`period=${period}`);
      }
    } else {
      const counter =
        params.counter === undefined ? DEFAULT_COUNTER : params.counter;
      if (!isSafeCounter(counter)) {
        otpFail("INVALID_COUNTER");
      }
      parts.push(`counter=${counter}`);
    }

    return `otpauth://${type}/${label}?${parts.join("&")}`;
  }
}
