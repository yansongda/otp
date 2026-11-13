/**
 * 平台错误模型：错误码唯一来源是 `@yansongda/otp-core`（本包不再抄一份码表），
 * 这里只保留平台拥有的错误类（code 为 TS 字面量联合）。
 *
 * 微信编译器可能把 class 降级到 ES5，届时 `extends Error` 会丢原型链：
 * 只在原型退化为 `Error.prototype` 时修复链，无条件重设会把 `OtpError` 子类实例的
 * 原型改回基类（`instanceof` 子类失效、原型方法丢失）。
 */

import type { OtpErrorCode as OtpErrorCodeType } from "@yansongda/otp-core";
import { OtpErrorCode } from "@yansongda/otp-core";

export { OtpErrorCode };

/**
 * 统一错误类：调用方可通过 code 精确分支处理。
 * codeString 保留原始字符串：外部传入 / 平台映射产生的未知码仍能拿到真实值
 * （本包 `code` 的联合类型直接复用 core 码表，重建即自动同步；ohos 的 enum 才需手动映射）。
 */
export class OtpError extends Error {
  readonly code: OtpErrorCodeType;
  readonly codeString: string;

  constructor(
    code: OtpErrorCodeType,
    message: string,
    codeString: string = code,
  ) {
    super(message);
    this.name = "OtpError";
    if (Object.getPrototypeOf(this) === Error.prototype) {
      Object.setPrototypeOf(this, OtpError.prototype);
    }
    this.code = code;
    this.codeString = codeString;
  }
}
