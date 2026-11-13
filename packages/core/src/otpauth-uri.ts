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

export class OTPAuthURI {
  /**
   * 解析 otpauth:// URI 为 OtpAuthParams：scheme 大小写不敏感 → type 限 totp/hotp →
   * label 百分号解码（失败回退原串）后按首个冒号切 issuer/account → query 手写拆分 →
   * secret 规范化为大写无填充 base32；未知参数忽略，query 的 issuer 优先于 label 前缀。
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

    // ③ label：'/' 之后、'?' 之前的部分，百分号解码（失败回退原串）
    const labelRaw =
      slashIndex === -1 ? "" : beforeQuery.substring(slashIndex + 1);
    let label = labelRaw;
    try {
      label = decodeURIComponent(labelRaw);
    } catch {
      label = labelRaw; // 解码失败回退原串
    }
    // 按首个冒号切分 issuer/account；解码失败回退原串时兼容 '%3A' 分隔形式
    let issuerFromLabel = "";
    let account = "";
    const colonIndex = label.indexOf(":");
    if (colonIndex !== -1) {
      issuerFromLabel = label.substring(0, colonIndex);
      account = label.substring(colonIndex + 1);
    } else {
      const pctIndex = label.indexOf("%3A");
      if (pctIndex !== -1) {
        issuerFromLabel = label.substring(0, pctIndex);
        account = label.substring(pctIndex + 3);
      } else {
        account = label;
      }
    }

    // ④ query 手写拆分：'&' 分段、'=' 分键值，键值均百分号解码（失败回退原串）
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
        try {
          key = decodeURIComponent(key);
        } catch {
          // 键解码失败回退原串
        }
        try {
          value = decodeURIComponent(value);
        } catch {
          // 值解码失败回退原串
        }
        params.set(key.toLowerCase(), value);
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

    // digits：默认 6，仅 6/7/8，否则 INVALID_DIGITS
    let digits: number = DEFAULT_DIGITS;
    const digitsRaw = params.get("digits");
    if (digitsRaw !== undefined && digitsRaw !== "") {
      const d = Number(digitsRaw);
      if (!isValidDigits(d)) {
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
        const p = Number(periodRaw);
        if (!Number.isSafeInteger(p) || p <= 0) {
          otpFail("INVALID_PERIOD");
        }
        period = p;
      }
    } else {
      const counterRaw = params.get("counter");
      if (counterRaw !== undefined && counterRaw !== "") {
        const c = Number(counterRaw);
        if (!isSafeCounter(c)) {
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
   * label 形如 issuer:account（两者百分号编码、冒号保留，为空则省略）；algorithm 始终输出，
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

    // label：issuer:account 均百分号编码、冒号保留；缺省方省略
    let label = "";
    if (issuer !== "") {
      label += encodeURIComponent(issuer);
    }
    if (account !== "") {
      if (label !== "") {
        label += ":";
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
