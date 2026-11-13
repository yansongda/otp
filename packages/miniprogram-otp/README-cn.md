# @yansongda/miniprogram-otp

面向 **微信小程序** 的零依赖 RFC 4226 / RFC 6238 HOTP / TOTP 库，发布为 CommonJS。

协议实现来自本 monorepo 的共享 core（`packages/core`）；本包只补微信运行时层——纯 JS HMAC/SHA provider（不假设存在同步 CSPRNG）与 TypeScript 公开类型。公开 API 与错误模型对齐鸿蒙包 [`@yansongda/otp`](https://github.com/yansongda/otp/tree/main/packages/ohos-otp/library)。

## 特性

- HOTP（RFC 4226）与 TOTP（RFC 6238）
- SHA1 / SHA256 / SHA512
- 6 / 7 / 8 位验证码
- `verify()` 漂移窗口与 `syncClockOffset()` 时钟校准
- `TOTP.remaining()` / `TOTP.progress()` 倒计时与环形进度
- `otpauth://` URI 解析与生成（`OTPAuthURI`、`TOTP.fromURI`、`HOTP.fromURI`）
- `Secret` 规范化、校验、字节/位数自省与 `toJSON()` 脱敏
- 可选严格 Base32 解析（`{ strict: true }`）
- 统一 `OtpError` 与 20 个冻结字符串错误码（`OtpErrorCode` 由共享 core 复用）
- 零运行时依赖
- 自带 TypeScript 类型声明

## 安装

```bash
npm install @yansongda/miniprogram-otp
```

安装后在微信开发者工具执行 **工具 → 构建 npm**。包声明了 `"miniprogram": "dist"`，因此会将编译后的 `dist/` 拷贝到 `miniprogram_npm/`。

```ts
import {
  TOTP,
  HOTP,
  Secret,
  OTPAuthURI,
  OtpError,
} from "@yansongda/miniprogram-otp";
```

也支持 CommonJS：

```js
const { TOTP } = require("@yansongda/miniprogram-otp");
```

## 快速开始

```ts
import {
  TOTP,
  HOTP,
  Secret,
  OTPAuthURI,
  OtpError,
} from "@yansongda/miniprogram-otp";

// TOTP：默认 SHA1 / 6 位 / 30 秒
const totp = new TOTP({ secret: "JBSWY3DPEHPK3PXP" });

totp.generate(); // 当前验证码
totp.remaining(); // 当前窗口剩余整秒：1..period
totp.progress(); // 当前窗口进度：0..1

// 带 1 步漂移窗口校验；返回 delta 或 null
const delta = totp.verify(code, { window: 1 });
if (delta !== null) {
  totp.syncClockOffset(delta); // RFC 6238 §6 重新同步
}

const uri = totp.toURI();
const restored = TOTP.fromURI(uri);

// HOTP：基于计数器
const hotp = new HOTP({ secret: "JBSWY3DPEHPK3PXP", counter: 0 });
hotp.generate();
hotp.verify(hotp.generate(), { window: 5 });

// Secret 工具
const secret = Secret.fromBase32("JBSWY3DPEHPK3PXP");
const strict = Secret.fromBase32("JBSWY3DPEHPK3PXP", { strict: true });
const canonical = secret.toBase32();
const bits = secret.bitLength;

// 一切失败均为 OtpError，可按 code 分支
try {
  new TOTP({ secret: "JBSWY3DPEHPK3PXP", digits: 5 });
} catch (e) {
  if (e instanceof OtpError) {
    console.log(e.code); // INVALID_DIGITS
  }
}
```

## API

### 选项

| 类型            | 字段                                                | 默认值           |
| --------------- | --------------------------------------------------- | ---------------- |
| `HmacOptions`   | `secret: string`（必填，Base32 宽松解析）           | —                |
|                 | `algorithm?: OtpAlgorithm`                          | `SHA1`           |
|                 | `digits?: number`（仅 6 / 7 / 8）                   | `6`              |
|                 | `minSecretBits?: number`                            | `0`（不强制）    |
| `TotpOptions`   | `period?: number`（秒）                             | `30`             |
|                 | `t0?: number`（秒）                                 | `0`              |
|                 | `clockOffsetMs?: number`                            | `0`              |
|                 | `issuer?` / `account?: string`（仅 `toURI()` 使用） | 空               |
| `HotpOptions`   | `counter?: number`                                  | `0`              |
|                 | `issuer?` / `account?: string`（仅 `toURI()` 使用） | 空               |
| `VerifyOptions` | `timestamp?: number`（epoch ms，仅 TOTP）           | `Date.now()`     |
|                 | `counter?: number`（仅 HOTP）                       | 构造时的 counter |
|                 | `window?: number`（步）                             | `0`（严格）      |

### 类与方法

| API                                                                    | 说明                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| `new TOTP(options: TotpOptions)`                                       | 构造期同步校验；非法即抛 `OtpError`                        |
| `totp.generate(timestampMs?: number): string`                          | 生成验证码；缺省当前时刻                                   |
| `totp.verify(token: string, options?: VerifyOptions): number \| null`  | 恒定时间比对；返回命中 delta 或 `null`                     |
| `totp.remaining(timestampMs?: number): number`                         | 当前窗口剩余整秒，`[1, period]`                            |
| `totp.progress(timestampMs?: number): number`                          | 当前窗口进度，`[0, 1)`                                     |
| `totp.syncClockOffset(delta: number): void`                            | `clockOffsetMs += delta * period * 1000`                   |
| `totp.clockOffsetMs: number`                                           | 当前时钟偏移（毫秒）                                       |
| `totp.toURI(): string` / `TOTP.fromURI(uri: string): TOTP`             | 序列化 / 恢复 TOTP                                         |
| `new HOTP(options: HotpOptions)`                                       | 构造期同步校验                                             |
| `hotp.generate(counter?: number): string`                              | 生成验证码；缺省构造值                                     |
| `hotp.verify(token: string, options?: VerifyOptions): number \| null`  | 返回 counter 偏移或 `null`                                 |
| `hotp.toURI(): string` / `HOTP.fromURI(uri: string): HOTP`             | 序列化 / 恢复 HOTP                                         |
| `Secret.fromBase32(s: string, options?: ParseOptions): Secret`         | 解析 Base32；默认宽松                                      |
| `Secret.fromBytes(bytes: Uint8Array): Secret`                          | 拷贝字节；空数组抛 `EMPTY_SECRET`                          |
| `Secret.generate(bytes = 20): Secret`                                  | 经内部 `RandomSource` 注册表生成；微信端默认未注册，见限制 |
| `secret.toBase32(): string`                                            | 规范化大写、无填充 Base32                                  |
| `secret.bytes` / `secret.byteLength` / `secret.bitLength`              | 字节视图（拷贝）/ 字节长度 / 位数                          |
| `secret.toJSON(): string`                                              | 固定返回 `[REDACTED]`；`JSON.stringify` 安全               |
| `OTPAuthURI.parse(uri: string, options?: ParseOptions): OtpAuthParams` | 解析 `otpauth://`；未知参数忽略                            |
| `OTPAuthURI.build(params: OtpAuthParams): string`                      | 生成规范 `otpauth://`                                      |
| `interface ParseOptions { strict?: boolean }`                          | `Secret.fromBase32` / `OTPAuthURI.parse` 共用              |
| `OtpAlgorithm` / `OtpType`                                             | 字符串常量；也接受 `"SHA1"` 等字面量                       |
| `class OtpError extends Error { readonly code: OtpErrorCode }`         | 稳定错误码，便于分支                                       |

## 严格 Base32

`{ strict: true }` 在库内归一化之后，拒绝「规范 Base32 不可能产生」的文本；大小写、空白、尾部 `=` 仍被容忍：

| 归一化后输入                                      | `len % 8`     | 默认                         | `{ strict: true }`                |
| ------------------------------------------------- | ------------- | ---------------------------- | --------------------------------- |
| `JBSWY3DPEHPK3PXP`                                | 0             | OK                           | OK                                |
| `MY` / `MZXQ` / `MZXW6` / `MZXW6YQ`               | 2 / 4 / 5 / 7 | OK                           | OK                                |
| `MB` / `MZXR` / `MZXW7` / `MZXW6YT`（填充位非 0） | 2 / 4 / 5 / 7 | 静默重编码                   | `INVALID_BASE32_PADDING`          |
| `A` / `AAA` / `MZXW6Y`（不可能尾长）              | 1 / 3 / 6     | `SECRET_TOO_SHORT` / OK / OK | `INVALID_BASE32_PADDING`          |
| `AB1`（非法字符）                                 | 3             | `INVALID_BASE32_CHAR`        | `INVALID_BASE32_CHAR`（优先校验） |

## 错误码

一切失败均抛 `OtpError`，消息为固定文案，绝不包含 secret、token 或派生密钥。

| 错误码                     | 含义                                                           |
| -------------------------- | -------------------------------------------------------------- |
| `EMPTY_SECRET`             | secret 缺失或为空                                              |
| `INVALID_BASE32_CHAR`      | 字符不在 Base32 字母表                                         |
| `INVALID_BASE32_PADDING`   | strict：尾长非规范或填充位非 0                                 |
| `SECRET_TOO_SHORT`         | 解码后不足 1 字节                                              |
| `SECRET_TOO_WEAK`          | `minSecretBits` 校验失败（仅强度问题）                         |
| `INVALID_SECRET_LENGTH`    | `Secret.generate(bytes)` 的 bytes 非 [1,4096] 整数             |
| `INVALID_ALGORITHM`        | 非 SHA1 / SHA256 / SHA512                                      |
| `INVALID_DIGITS`           | 非 6 / 7 / 8                                                   |
| `INVALID_PERIOD`           | 周期不是正整数                                                 |
| `INVALID_T0`               | `t0` 不是非负整数                                              |
| `INVALID_COUNTER`          | counter 不在 `[0, 2^53-1]`                                     |
| `INVALID_TIMESTAMP`        | 时间戳不是 ≥0 的有限数（epoch 0 合法）                         |
| `INVALID_CLOCK_OFFSET`     | `clockOffsetMs` 非有限，或 `syncClockOffset` delta 非整数/溢出 |
| `INVALID_WINDOW`           | window 不是 [0, 1000] 内的整数                                 |
| `INVALID_TOKEN`            | token 非纯数字或长度不等于 digits                              |
| `CRYPTO_FAILED`            | 内部 HMAC 失败；不泄漏密钥                                     |
| `CRYPTO_NOT_INITIALIZED`   | 未注册 provider；应从包 barrel 导入                            |
| `INVALID_OTPAUTH_URI`      | URI 不以 `otpauth://` 开头（大小写不敏感）                     |
| `UNSUPPORTED_OTPAUTH_TYPE` | 类型不是 `totp` / `hotp`（parse 与 build）                     |
| `NOT_IMPLEMENTED`          | 平台无法映射错误码时的兜底（库内不抛出）                       |

## 微信小程序限制

### 随机 secret

微信只提供**异步** `wx.getRandomValues`（基础库 2.15.0+），而 `Secret.generate()` 是同步 API。因此本包**不会**在微信端注册默认随机源；`Secret.generate()` 会抛 `CRYPTO_NOT_INITIALIZED`。

请使用平台随机数 + `Secret.fromBytes()`：

```ts
import { Secret } from "@yansongda/miniprogram-otp";

wx.getRandomValues({
  length: 20,
  success: (res) => {
    const secret = Secret.fromBytes(new Uint8Array(res.randomValues));
    // 持久化 secret.toBase32()
  },
});
```

这是与 OHOS 库唯一的实质性功能差异；OHOS 默认注册同步的 `CryptoFrameworkRandom`。`RandomSource` 注册表按设计不公开，微信端请使用 `Secret.fromBytes()` 接收平台随机字节。

### 密码学实现

微信小程序没有 WebCrypto / SubtleCrypto。HMAC-SHA1/256/512 由纯 TypeScript 实现，位运算保证 32 位安全；SHA-512 使用 hi/lo 半字，**不使用 BigInt**，兼容老设备。

### 其他限制

- counter 上限为 `2^53-1`（JavaScript number 精确整数上限）。
- `otpauth://` 不是 RFC，而是 Google Authenticator 事实标准（IANA Provisional #13829）。
- URI 未知 query 参数会被忽略，以最大化互操作。
- `verify()` 默认 `window: 0`；需要容忍 RFC 6238 §5.2 的一步网络延迟时显式传 `window: 1`。window 上限 1000 步（超出抛 `INVALID_WINDOW`），避免外部传入的 window 被放大成 HMAC 计算炸弹。
- 不提供 Steam Guard、SHA224/SHA384/SM3、BigInt counter、throttling（RFC 4226 §7.3 属服务端职责）、二维码渲染 / 扫码。
- 纯 JS HMAC 比系统 crypto 慢；本库面向端内算码，不用于服务端批量校验。

## 共享 core 与平台差异

- 公开 API、DTO 字段名、18 个错误码与 RFC 行为对齐鸿蒙包（`@yansongda/otp` v1.1.0）。
- 两个包都消费 `packages/core`；差异只在类型层与 crypto provider。
- `OtpAlgorithm` 在 TS 侧为 `const` 对象 + 字符串联合，而不是 ArkTS `enum`；`"SHA1"` 与 `OtpAlgorithm.SHA1` 都可用。
- `OtpError` 额外设置 `name` 与 `Object.setPrototypeOf`，保证微信 ES5 降级后 `instanceof` 可靠。
- HMAC 使用共享的纯 JS provider（`packages/core/src/pure-js`），不使用 `@kit.CryptoArchitectureKit`。
- 默认不注册随机源；见上。

## 开发

```bash
bun install
bun run lint              # biome check
bun run typecheck         # tsc --noEmit
bun test                  # 平台契约测试
bun run build             # tsdown -> dist（单文件 CommonJS + 单文件 d.ts）
bun run check:invariants  # 仓库不变量
bun run smoke:dist        # require dist 并验证 RFC 向量
bun run release:check     # 发版前全量检查（含 npm pack --dry-run）
```

Bun 版本固定于 `.bun-version`（当前 `1.4.4`）；CI 另有一个非阻塞的 latest Bun 兼容任务。`bun fmt` 可格式化 README/JSON，但 CI 的格式判定以 Biome 为准。

发版：`.github/workflows/release-miniprogram.yml` 在 tag `miniprogram-v*` 上通过 GitHub OIDC Trusted Publishing 发布到 npm；首次发布手动完成，详见 `.agents/skills/release-miniprogram/SKILL.md`。

## 许可证

MIT
