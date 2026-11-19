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
- 统一 `OtpError` 与 22 个冻结字符串错误码（`OtpErrorCode` 由共享 core 复用）
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
const totp = new TOTP({
  secret: "JBSWY3DPEHPK3PXP",
  issuer: "ACME", // 可选
  account: "alice@example.com", // toURI() 必填（label 的唯一来源）
});

totp.generate(); // 当前验证码
totp.remaining(); // 当前窗口剩余整秒：1..period
totp.progress(); // 当前窗口进度：0..1

// 带 1 步漂移窗口校验；返回 delta 或 null
const delta = totp.verify(code, { window: 1 });
if (delta !== null) {
  totp.syncClockOffset(delta); // RFC 6238 §6 重新同步
}

const uri = totp.toURI(); // 需要 account，否则抛 INVALID_OTPAUTH_URI
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

| 类型                | 字段                                                                             | 默认值                    |
| ------------------- | -------------------------------------------------------------------------------- | ------------------------- |
| `HmacOptions`       | `secret: string`（必填，Base32 宽松解析）                                        | —                         |
|                     | `algorithm?: OtpAlgorithm`                                                       | `SHA1`                    |
|                     | `digits?: number`（仅 6 / 7 / 8）                                                | `6`                       |
|                     | `minSecretBits?: number`（非负安全整数）                                         | `0`（不强制）             |
| `TotpOptions`       | `period?: number`（秒）                                                          | `30`                      |
|                     | `t0?: number`（秒）                                                              | `0`                       |
|                     | `clockOffsetMs?: number`（安全整数毫秒）                                         | `0`                       |
|                     | `issuer?` / `account?: string`（构造期可选；`toURI()` 必填）                     | 空                        |
| `HotpOptions`       | `counter?: number`                                                               | `0`                       |
|                     | `issuer?` / `account?: string`（构造期可选；`toURI()` 必填）                     | 空                        |
| `VerifyOptions`     | `HotpVerifyOptions` / `TotpVerifyOptions` 的超集（同时接受两者），优先用按类选项 | —                         |
| `HotpVerifyOptions` | `counter?: number`、`window?: number`（[0, 10] 步）                              | `window: 0`               |
| `TotpVerifyOptions` | `timestamp?: number`（epoch ms 安全整数）、`window?: number`（[0, 10] 步）       | `Date.now()`、`window: 0` |
| `MAX_VERIFY_WINDOW` | 漂移窗口上限（步，双向）                                                         | `10`                      |

### 类与方法

| API                                                                                         | 说明                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new TOTP(options: TotpOptions)`                                                            | 构造期同步校验；非法即抛 `OtpError`                                                                                                                                                                                                                                             |
| `totp.generate(timestampMs?: number): string`                                               | 生成验证码；缺省当前时刻                                                                                                                                                                                                                                                        |
| `totp.verify(token: string, options?: TotpVerifyOptions): number \| null`                   | 恒定时间比对；返回命中 delta 或 `null`                                                                                                                                                                                                                                          |
| `totp.remaining(timestampMs?: number): number`                                              | 当前窗口剩余整秒，`[1, period]`                                                                                                                                                                                                                                                 |
| `totp.progress(timestampMs?: number): number`                                               | 当前窗口进度，`[0, 1)`                                                                                                                                                                                                                                                          |
| `totp.syncClockOffset(delta: number): void`                                                 | `clockOffsetMs += delta * period * 1000`（delta 须为安全整数，可为负）                                                                                                                                                                                                          |
| `totp.clockOffsetMs: number`                                                                | 当前时钟偏移（毫秒）                                                                                                                                                                                                                                                            |
| `totp.toURI(): string` / `TOTP.fromURI(uri: string): TOTP`                                  | 序列化 / 恢复 TOTP                                                                                                                                                                                                                                                              |
| `new HOTP(options: HotpOptions)`                                                            | 构造期同步校验                                                                                                                                                                                                                                                                  |
| `hotp.generate(counter?: number): string`                                                   | 生成验证码；缺省构造值                                                                                                                                                                                                                                                          |
| `hotp.verify(token: string, options?: HotpVerifyOptions): number \| null`                   | 返回 counter 偏移或 `null`                                                                                                                                                                                                                                                      |
| `hotp.toURI(): string` / `HOTP.fromURI(uri: string): HOTP`                                  | 序列化 / 恢复 HOTP                                                                                                                                                                                                                                                              |
| `Secret.fromBase32(s: string, options?: ParseOptions): Secret`                              | 解析 Base32；默认宽松（入参非字符串抛 `INVALID_SECRET_CONTAINER`）                                                                                                                                                                                                              |
| `Secret.fromBytes(bytes: Uint8Array \| Uint8ClampedArray \| ArrayBuffer): Secret`           | 拷贝字节（8 位无符号视图 + `ArrayBuffer`）；空数据抛 `EMPTY_SECRET`，非字节容器抛 `INVALID_SECRET_CONTAINER`                                                                                                                                                                    |
| `Secret.generate(bytes = 20): Secret`                                                       | 经内部 `RandomSource` 注册表生成；微信端默认未注册，见限制                                                                                                                                                                                                                      |
| `secret.toBase32(): string`                                                                 | 规范化大写、无填充 Base32                                                                                                                                                                                                                                                       |
| `secret.bytes` / `secret.byteLength` / `secret.bitLength`                                   | 字节视图（拷贝）/ 字节长度 / 位数                                                                                                                                                                                                                                               |
| `secret.toJSON(): string`                                                                   | 固定返回 `[REDACTED]`；`JSON.stringify` 安全                                                                                                                                                                                                                                    |
| `OTPAuthURI.parse(uri: string, options?: ParseOptions): OtpAuthParams`                      | 解析 `otpauth://`；未知参数与 type 不适用的参数（TOTP 的 `counter`、HOTP 的 `period`）均忽略；label 按 Key URI Format 的 ABNF 切分（分隔符为 `:` 或 `%3A`，其后空格是 padding）。label 非法（`account` 缺失 / 为空 / 含冒号、段不可编码）或已知参数重复 → `INVALID_OTPAUTH_URI` |
| `OTPAuthURI.build(params: OtpAuthParams): string`                                           | 生成规范 `otpauth://`；label 仅由 `account` 派生（`account` 必填且不得含冒号，违者抛 `INVALID_OTPAUTH_URI`）。`issuer` 含冒号或 `account` 以空格开头时省略 label 前缀（只写 `issuer=`）                                                                                         |
| `interface ParseOptions { strict?: boolean }`                                               | `Secret.fromBase32` / `OTPAuthURI.parse` 共用                                                                                                                                                                                                                                   |
| `OtpAlgorithm` / `OtpType`                                                                  | 字符串常量；也接受 `"SHA1"` 等字面量                                                                                                                                                                                                                                            |
| `class OtpError extends Error { readonly code: OtpErrorCode; readonly codeString: string }` | 稳定错误码，便于分支（未知码用 `codeString` 保留原值）                                                                                                                                                                                                                          |

## 严格 Base32

`{ strict: true }` 在库内归一化之后，拒绝「规范 Base32 不可能产生」的文本；大小写、空白、尾部 `=` 仍被容忍：

| 归一化后输入                                      | `len % 8`     | 默认                  | `{ strict: true }`                |
| ------------------------------------------------- | ------------- | --------------------- | --------------------------------- |
| `JBSWY3DPEHPK3PXP`                                | 0             | OK                    | OK                                |
| `MY` / `MZXQ` / `MZXW6` / `MZXW6YQ`               | 2 / 4 / 5 / 7 | OK                    | OK                                |
| `MB` / `MZXR` / `MZXW7` / `MZXW6YT`（填充位非 0） | 2 / 4 / 5 / 7 | 静默重编码            | `INVALID_BASE32_PADDING`          |
| `A`（尾长 1，解码后 0 字节）                      | 1             | `SECRET_TOO_SHORT`    | `SECRET_TOO_SHORT`（同码）        |
| `AAA` / `MZXW6Y`（尾长 3 / 6，结构性非法）        | 3 / 6         | OK                    | `INVALID_BASE32_PADDING`          |
| `AB1`（非法字符）                                 | 3             | `INVALID_BASE32_CHAR` | `INVALID_BASE32_CHAR`（优先校验） |

## otpauth label 语义

label 是 account 的唯一来源。规范文本是 Google 的 Key URI Format（IANA 只把 `otpauth` 注册为
provisional，CRI #13829，**不是 RFC**）：
`label = accountname / issuer (":" / "%3A") *"%20" accountname`。

- **切分**：分隔符是**原始串**中首个 `:` 或 `%3A`（十六进制大小写不敏感），其后紧邻的空格与
  `%20` 都是 padding；没有分隔符时整段就是 account。判定与 query 里有没有 `issuer` 无关
  （`issuer` 参数仍作为取值优先）。
- **两侧同口径（fail-closed）**：`account` 缺失 / 为空 / 含冒号、label 段不可百分号编码
  （孤立代理字符）、已知 query 参数（`secret` / `issuer` / `algorithm` / `digits` / `period` /
  `counter`）重复出现 → `INVALID_OTPAUTH_URI`。因此 `build(parse(uri))` 恒不抛错。
- **label 前缀可省略**：`issuer` 含冒号（`issuer` **参数**是 `pchar`，允许冒号；label 前缀
  不允许），或 `account` 以空格开头（前缀形态下会被当 padding 剥掉）时，`build` 只写
  `issuer=` 参数、不写 label 前缀。
- **已知偏离（宽容超集）**：分隔符后的**原始空格**也按 padding 剥离。ABNF 只写了 `%20`，
  而原始空格本身不是合法 URI 字符 —— 真实签发方确实会这么写，故容忍。需要严格请自行预清洗。

## 错误码

一切失败均抛 `OtpError`，消息为固定文案，绝不包含 secret、token 或派生密钥。

| 错误码                     | 含义                                                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EMPTY_SECRET`             | secret 缺失或为空（含 0 字节容器）                                                                                                                                                                                                                             |
| `INVALID_SECRET_CONTAINER` | secret 容器类型不对：`fromBase32` 入参不是字符串；`fromBytes` 入参不是 8 位无符号视图（`Uint8Array` / `Uint8ClampedArray`）或 `ArrayBuffer`（如字符串、array-like、`null`、`DataView`、`Int8Array`、`Uint16Array`）；`OTPAuthURI.build` 的 `secret` 不是字符串 |
| `INVALID_BASE32_CHAR`      | 字符不在 Base32 字母表                                                                                                                                                                                                                                         |
| `INVALID_BASE32_PADDING`   | strict：尾长非规范或填充位非 0                                                                                                                                                                                                                                 |
| `SECRET_TOO_SHORT`         | 解码后不足 1 字节                                                                                                                                                                                                                                              |
| `SECRET_TOO_WEAK`          | `minSecretBits` 校验失败（仅强度问题）                                                                                                                                                                                                                         |
| `INVALID_SECRET_LENGTH`    | `Secret.generate(bytes)` 的 bytes 非 [1,4096] 整数（平台随机源长度越界同码）                                                                                                                                                                                   |
| `INVALID_MIN_SECRET_BITS`  | `minSecretBits` 非非负安全整数（fail-closed，不静默关闭校验）                                                                                                                                                                                                  |
| `INVALID_ALGORITHM`        | 非 SHA1 / SHA256 / SHA512                                                                                                                                                                                                                                      |
| `INVALID_DIGITS`           | 非 6 / 7 / 8                                                                                                                                                                                                                                                   |
| `INVALID_PERIOD`           | 周期不是正安全整数                                                                                                                                                                                                                                             |
| `INVALID_T0`               | `t0` 不是非负安全整数                                                                                                                                                                                                                                          |
| `INVALID_COUNTER`          | counter 不在 `[0, 2^53-1]`                                                                                                                                                                                                                                     |
| `INVALID_TIMESTAMP`        | 时间戳不是非负安全整数（epoch 0 合法）                                                                                                                                                                                                                         |
| `INVALID_CLOCK_OFFSET`     | `clockOffsetMs` 非安全整数、`syncClockOffset` delta 非安全整数/溢出，或偏移使 `timestamp`/当前时刻变为负值或超出安全整数范围                                                                                                                                   |
| `INVALID_WINDOW`           | window 不是 [0, 10]（`MAX_VERIFY_WINDOW`）内的整数                                                                                                                                                                                                             |
| `INVALID_TOKEN`            | token 不是字符串、非纯数字，或长度不等于 digits                                                                                                                                                                                                                |
| `CRYPTO_FAILED`            | 内部 HMAC 失败（原生 crypto 异常）；不泄漏密钥                                                                                                                                                                                                                 |
| `CRYPTO_NOT_INITIALIZED`   | 未注册 provider；应从包 barrel 导入                                                                                                                                                                                                                            |
| `INVALID_OTPAUTH_URI`      | URI 不是字符串、不以 `otpauth://` 开头（大小写不敏感）、已知 query 参数重复、label 非法（`account` 缺失 / 为空 / 含冒号，或 label 段无法百分号编码），或 build 的 `issuer`·`account` 非字符串 / 无法百分号编码                                                 |
| `UNSUPPORTED_OTPAUTH_TYPE` | 类型不是 `totp` / `hotp`（parse 与 build）                                                                                                                                                                                                                     |
| `NOT_IMPLEMENTED`          | 平台无法映射错误码时的兜底（库内不抛出；`codeString` 保留原始值）                                                                                                                                                                                              |

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
- URI 未知 query 参数与 type 不适用的参数（TOTP 的 `counter`、HOTP 的 `period`）会被忽略，以最大化互操作。
- `verify()` 默认 `window: 0`；需要容忍 RFC 6238 §5.2 的一步网络延迟时显式传 `window: 1`。window 上限 `MAX_VERIFY_WINDOW = 10` 步（超出抛 `INVALID_WINDOW`）：动态验证码 ±3 步已很宽松，10（默认周期下 ±5 分钟）是安全上限而非可调参数。需要更大跨度（例如服务端 HOTP resync）时**不要**放开上限：按 counter 迭代 `hotp.verify(token, { counter, window: 0 })`。
- `verify(token, options)` **只读取对象形态**的 `options`：`null` 或其他非对象值（裸数字 / 字符串）等价于未传，裸数字**不会**被当作 `window`，开窗口必须显式传 `{ window: 1 }`。
- 不提供 Steam Guard、SHA224/SHA384/SM3、BigInt counter、throttling（RFC 4226 §7.3 属服务端职责）、二维码渲染 / 扫码。
- 纯 JS HMAC 比系统 crypto 慢；本库面向端内算码，不用于服务端批量校验。

## 共享 core 与平台差异

- 公开 API、DTO 字段名、22 个错误码与 RFC 行为与鸿蒙包（`@yansongda/otp`）一致：两者消费同一个 `packages/core`，错误模型不会漂移。
- 两个包都消费 `packages/core`；差异只在类型层与 crypto provider。
- `OtpAlgorithm` 在 TS 侧为 `const` 对象 + 字符串联合，而不是 ArkTS `enum`；`"SHA1"` 与 `OtpAlgorithm.SHA1` 都可用。
- `OtpError` 设置 `name`，且**仅在原型退化为 `Error.prototype` 时**执行 `Object.setPrototypeOf`，保证微信 ES5 降级后 `instanceof` 可靠；无条件重设会改写子类实例原型。ES5 + 自定义子类仍需自行修正原型链。
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
