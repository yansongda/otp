// AUTO-GENERATED from packages/core/src/otpauth-uri.ts (core@6f08177). DO NOT EDIT. Run: bun run sync:core
/**
 * OTPAuthURI：otpauth:// URI 解析与生成（零平台依赖）。
 * 遵循 Google Authenticator Key URI Format（IANA Provisional #13829）与 IETF 个人稿
 * draft-andesco-otpauth-uri-01（§3.1 label 解析顺序 / §3.3 label 产生式 / §3.4 参数唯一性 /
 * §4 issuer 参数权威性）；query 手写拆分，不依赖平台 URL 查询解析 API。
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

/**
 * 百分号解码；失败回退原串（不抛错，最大化互操作）。
 * 没有 `%` 时 `decodeURIComponent` 只会原样返回（也抛不出错），直接短路：
 * parse 的 label / issuer / account 与 query 键值都走这里，纯文本占多数。
 */
function decodePart(raw: string): string {
  if (raw.indexOf("%") === -1) {
    return raw;
  }
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
 * 也与主流实现（如 hectorm/otpauth 的 `split(/(?::|%3A) *(.+)/i)`）一致；草案 §3.1 把这条
 * consumer 规则写死为「先按原始串首个分隔符切分，再逐段百分号解码」。
 * 刻意不依赖 query 里有没有 issuer、也不比较前缀与 issuer 是否相等：草案 §4 规定 consumer
 * MUST NOT「仅因两个值不同就拒收」，issuer 量以 query 为准（见 parse）；不一致属于签发方的
 * 数据问题，不应改变分隔符的判定（否则同一 label 会有两种解释）。
 * 返回分隔符起点下标；没有分隔符返回 -1（宽度由 `:` / `%3A` 再判：1 或 3）。
 */
function findLabelSeparator(input: string): number {
  const colon = input.indexOf(":");
  const pct = indexOfPercentEncodedColon(input);
  if (colon === -1) {
    return pct;
  }
  if (pct === -1 || colon < pct) {
    return colon;
  }
  return pct;
}

/**
 * 原始串里首个 `%3A`（十六进制大小写不敏感）的下标，没有则 -1。
 * 不用 `input.toLowerCase().indexOf("%3a")`：`İ`、`ẞ` 这类小写后长度会变的字符会让下标与
 * 原始串错位；也不用逐字符 `charAt` 循环（逐字符 JS 循环在纯文本 label 上是 parse 的主要
 * 成本）——先找 `%3` 候选、再判第三个字符是 `a`/`A`，纯文本 label 上只需几次原生扫描。
 */
function indexOfPercentEncodedColon(input: string): number {
  let i = input.indexOf("%3");
  while (i !== -1) {
    if (i + 2 < input.length) {
      const c = input.charAt(i + 2);
      if (c === "a" || c === "A") {
        return i;
      }
    }
    i = input.indexOf("%3", i + 1);
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
 * 是否含「孤立代理字符」——`encodeURIComponent` 遇到未配对的 UTF-16 半字会抛原生
 * `URIError`，即该字符串无法百分号编码。与 `encodePart` 的失败条件等价，但只做一次扫描、
 * 不构造异常：parse 用它保证「解析出来的参数一定能被 build 序列化」。
 */
/** 代理区（含成对与孤立）快速判定：纯 ASCII / BMP 文本一次原生扫描即排除。 */
const SURROGATE_RE = /[\uD800-\uDFFF]/;

function hasLoneSurrogate(raw: string): boolean {
  if (!SURROGATE_RE.test(raw)) {
    return false;
  }
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < raw.length ? raw.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      i += 1;
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * 已知 query 参数（Key URI Format / draft-andesco-otpauth-uri-01 §3.1 的 parameter 产生式）。
 * 已知参数重复出现 → 整条 URI 拒绝（草案 §3.4："A consumer MUST reject the URI if any known
 * parameter appears more than once"）；未知参数重复仍忽略（草案 §3.4.7：SHOULD ignore）。
 */
const KNOWN_QUERY_KEYS = new Set<string>([
  "secret",
  "issuer",
  "algorithm",
  "digits",
  "period",
  "counter",
]);

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
   * label 按 Key URI Format 的 ABNF 解析（草案 §3.1/§3.3 同规则）：
   * `label = accountname / issuer (":" / "%3A") *"%20" accountname` —— 原始串中首个 `:` 或
   * `%3A`（十六进制大小写不敏感）即分隔符，其后空格是 padding；没有分隔符时整段就是 account。
   * query 的 `issuer` 与 label 前缀不一致时以 query 为准（草案 §4：MUST NOT 仅因不同而拒收）。
   * label 段与 build 对称（fail-closed）：account 缺失 / 为空、account 含冒号、或 label 段
   * 不可百分号编码（孤立代理字符）→ INVALID_OTPAUTH_URI；已知 query 参数重复亦拒绝。
   * 因此 parse 的返回值**一定能被 build 序列化**（`build(parse(uri))` 恒不抛错）。
   * options.strict 非 false（见 isStrictOption）时 secret 必须是规范 base32，否则 INVALID_BASE32_PADDING。
   * 入参不是字符串（JS 调用方）→ INVALID_OTPAUTH_URI，不漏原生 TypeError；
   * options 传 null 与未传等价。
   */
  static parse(uri: string, options?: ParseOptions | null): OtpAuthParams {
    // ⓪ 先判容器：TS 类型只约束编译期，`uri.toLowerCase()` 在非字符串入参上会漏 TypeError
    if (typeof uri !== "string") {
      otpFail("INVALID_OTPAUTH_URI");
    }

    // ① scheme 大小写不敏感。只小写前 prefix.length 个字符：整串 toLowerCase() 在大 URI
    // 上是一次与内容等长的额外分配，而判定只需要前缀（substring 短串时返回整串，自然不匹配）。
    const prefix = "otpauth://";
    if (uri.substring(0, prefix.length).toLowerCase() !== prefix) {
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
        const decodedKey = decodePart(key).toLowerCase();
        if (KNOWN_QUERY_KEYS.has(decodedKey) && params.has(decodedKey)) {
          // 已知参数重复：不得静默「后者覆盖前者」，否则 algorithm/digits 可被后段改写
          otpFail("INVALID_OTPAUTH_URI");
        }
        params.set(decodedKey, decodePart(value));
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

    // ⑤ label 段契约：与 build 对称，保证「parse 成功 ⇒ 参数一定可被 build 序列化」。
    // 放在既有校验之后，任何原本抛某码的输入都不换码（见 errors.ts 的优先级表）。
    // account 必填：Key URI Format 的 label 必填、ABNF 无空分支（草案 §3.1 account = 1*）；
    // 段内不得含冒号：规范明文 + 草案 consumer MUST reject；且必须可百分号编码。
    if (account === "") {
      otpFail("INVALID_OTPAUTH_URI");
    }
    if (account.indexOf(":") !== -1) {
      otpFail("INVALID_OTPAUTH_URI");
    }
    if (
      hasLoneSurrogate(account) ||
      (issuer !== "" && hasLoneSurrogate(issuer))
    ) {
      otpFail("INVALID_OTPAUTH_URI");
    }

    const result: OtpAuthParams = {
      type,
      secret,
      algorithm,
      digits,
      account,
    };
    if (type === "totp") {
      result.period = period;
    } else {
      result.counter = counter;
    }
    if (issuer !== "") {
      result.issuer = issuer;
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
   * **account 不得含冒号**（ABNF 明文 "Neither issuer nor account name may themselves
   * contain a colon" → INVALID_OTPAUTH_URI）：label 段里的冒号必然被规范解析器当分隔符
   * 切开，无法表示，只能拒绝。
   * **issuer 含冒号、或 account 以空格开头时省略 label 前缀**（只写 `issuer=` query）：
   * issuer 参数是 pchar（RFC 3986 允许冒号）而 label 前缀不允许；分隔符后的空格按 ABNF
   * 是 padding —— 这两种组合写进前缀会让 `build → parse` 不闭合，省略这个**可选**前缀后
   * 即可无损往返（草案：producer MAY include an issuer label prefix）。
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
    // 运行时（JS 调用方 / JSON 反序列化）可能缺字段或传非字符串：按 typeof 判容器后再取用，
    // 既不改运行时契约（INVALID_OTPAUTH_URI，绝不把 null 写成 "null"）。
    // 刻意不用 `unknown` 中转：生成副本要过 ArkTS 编译，ArkTS 不对 `unknown` 做收窄。
    const issuerRaw = params.issuer;
    if (issuerRaw !== undefined && typeof issuerRaw !== "string") {
      otpFail("INVALID_OTPAUTH_URI");
    }
    const accountRaw = params.account;
    if (typeof accountRaw !== "string") {
      otpFail("INVALID_OTPAUTH_URI");
    }
    const issuer: string = issuerRaw === undefined ? "" : issuerRaw;
    const account: string = accountRaw;

    // account 必填：Key URI Format 的 label 必填，而 label 只能由 account 派生。
    // 也不允许拿 issuer 顶替——无原始冒号的 label 会被 parse 读成 account，
    // build → parse 就凭空多出一个与 issuer 同名的账号。
    if (account === "") {
      otpFail("INVALID_OTPAUTH_URI");
    }
    // label 段不得含冒号：无论怎么百分号编码都会被规范解析器当分隔符切开，不可表示
    if (account.indexOf(":") !== -1) {
      otpFail("INVALID_OTPAUTH_URI");
    }
    // label 前缀是可选装饰（issuer 参数才是权威来源）：issuer 含冒号（参数侧 pchar 允许、
    // 前缀侧 ABNF 不允许），或 account 以空格开头（分隔符后的空格是 padding，parse 会剥掉）
    // 时，写前缀会让 build → parse 不闭合 —— 直接省略前缀，只写 issuer= 参数。
    const withPrefix =
      issuer !== "" && issuer.indexOf(":") === -1 && account.charAt(0) !== " ";
    const label = withPrefix
      ? `${encodePart(issuer)}:${encodePart(account)}`
      : encodePart(account);

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
