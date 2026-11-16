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
   * query 手写拆分 → label 按**原始串**首个冒号切分后逐段百分号解码（失败回退原串）→
   * digits / period / counter 只接受纯十进制整数（拒绝 0x / 科学计数 / 小数）→
   * secret 规范化为大写无填充 base32；未知参数忽略，query 的 issuer 优先于 label 前缀。
   * 无原始冒号的 label 一律视为 account；仅当 query issuer 存在且与 label 前缀一致时，
   * 才把历史形式 `issuer%3Aaccount` 的首个 %3A 当作分隔符（否则不猜，保留完整 account）。
   * options.strict === true 时 secret 必须是规范 base32，否则 INVALID_BASE32_PADDING。
   */
  static parse(uri: string, options?: ParseOptions): OtpAuthParams {
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
    let label = labelRaw;
    try {
      label = decodeURIComponent(labelRaw);
    } catch {
      label = labelRaw;
    }
    // 切分与解码顺序：必须**先按原始串**切分，再逐段解码。
    // build 会把 issuer 内部的冒号编码为 %3A（label 里只有分隔冒号是原字符），
    // 若先整体解码再切分，issuer 里的 %3A 会被误当分隔符（build → parse 往返丢 issuer）。
    let issuerFromLabel = "";
    let account = "";
    const colonIndex = labelRaw.indexOf(":");
    if (colonIndex !== -1) {
      issuerFromLabel = decodePart(labelRaw.substring(0, colonIndex));
      account = decodePart(labelRaw.substring(colonIndex + 1));
    } else {
      // 无原始分隔冒号：规范语义是「整段 label 就是 account」。
      // 唯一例外是历史 URI 把分隔符整体编码为 %3A（issuer%3Aaccount）：只有 query issuer
      // 同时存在、且与 label 前缀一致时，才能安全地把它当分隔符。否则宁可保留完整 account，
      // 也不猜——build 产物把 account 内的冒号编码为 %3A，猜错会把 account 截断。
      const issuerQueryForLabel = params.get("issuer");
      const pctIndex = labelRaw.toLowerCase().indexOf("%3a");
      if (
        pctIndex !== -1 &&
        issuerQueryForLabel !== undefined &&
        issuerQueryForLabel !== "" &&
        decodePart(labelRaw.substring(0, pctIndex)) === issuerQueryForLabel
      ) {
        issuerFromLabel = issuerQueryForLabel;
        account = decodePart(labelRaw.substring(pctIndex + 3));
      } else {
        account = decodePart(labelRaw);
      }
    }

    // secret 必填，经 Base32 校验（空 / 非法字符 / 过短各自抛码）；strict 追加规范形式校验
    const secretRaw = params.get("secret");
    if (secretRaw === undefined || secretRaw === "") {
      otpFail("EMPTY_SECRET");
    }
    const strict = options !== undefined && options.strict === true;
    const secret = encode(strict ? decodeStrict(secretRaw) : decode(secretRaw));

    // issuer：query 优先，其次 label 前缀
    let issuer = issuerFromLabel;
    const issuerQuery = params.get("issuer");
    if (issuerQuery !== undefined) {
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
   * label 仅由 account 派生：`issuer:account`（两者百分号编码、分隔冒号保留）；
   * account 为空时整个 label 省略（不把 issuer 写进 label）。algorithm 始终输出，
   * digits 仅 !== 6、period 仅 TOTP 且 !== 30 时输出（与 GA 二维码惯例一致），HOTP 始终输出 counter。
   * secret 先经 Base32 规范化（与 parse 对称）；非法 base32 抛对应错误码。
   *
   * 校验与 parse 对称：build 的产物必须能被 parse 接受，否则下游扫码方会拿到非法 URI。
   * params.label 是 parse 的回填字段（原始 label），build 一律由 issuer/account 派生，忽略该字段。
   */
  static build(params: OtpAuthParams): string {
    // 顺序与 parse / errors.ts 优先级一致：type → secret → algorithm → digits → period|counter
    const type = params.type;
    if (type !== "totp" && type !== "hotp") {
      otpFail("UNSUPPORTED_OTPAUTH_TYPE");
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

    // label：仅当 account 非空时输出（issuer:account 百分号编码、分隔冒号保留）。
    // account 为空时不把 issuer 写进 label：规范里无原始冒号的 label 就是 account，
    // 否则 build → parse 会凭空多出一个与 issuer 同名的 account。
    let label = "";
    if (account !== "") {
      if (issuer !== "") {
        label += `${encodeURIComponent(issuer)}:`;
      }
      label += encodeURIComponent(account);
    }

    const parts: string[] = [];
    parts.push(`secret=${secret}`);
    if (issuer !== "") {
      parts.push(`issuer=${encodeURIComponent(issuer)}`);
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
