# 微信小程序 / 鸿蒙 OTP 库

[English](README.md) · **简体中文**

一个符合 RFC 4226 / RFC 6238 的 HOTP / TOTP 库，**两端共用同一份实现**：

- **微信小程序** → npm 包 [`@yansongda/miniprogram-otp`](https://www.npmjs.com/package/@yansongda/miniprogram-otp)
- **鸿蒙 / ArkTS** → OHPM 包 [`@yansongda/otp`](https://ohpm.openharmony.cn/)

协议逻辑（RFC 4226 HOTP、RFC 6238 TOTP、base32、`otpauth://` URI、动态截断、漂移窗口）全部位于一份与平台无关的 TypeScript core；两个包只补充各自的 crypto 实现与公开类型层，因此两端行为完全一致。

## 特性

- RFC 4226 HOTP + RFC 6238 TOTP
- SHA-1 / SHA-256 / SHA-512，6 / 7 / 8 位验证码
- `otpauth://` URI 解析与生成（`OTPAuthURI`、`TOTP.fromURI`、`HOTP.fromURI`）
- 漂移窗口校验与时钟偏移校准（`verify`、`syncClockOffset`）
- `TOTP.remaining()` / `TOTP.progress()`，便于倒计时与环形进度条
- 可选严格 base32 解析（用于导入边界）
- 恒定时间比较；错误消息与日志绝不包含 secret / token
- 18 个冻结错误码，统一 `OtpError`
- 零运行时依赖

## 包一览

| 包                                                                                       | 运行环境               | 安装                                     | 详细文档                                                                                        |
| ---------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`@yansongda/miniprogram-otp`](https://www.npmjs.com/package/@yansongda/miniprogram-otp) | 微信小程序（CommonJS） | `npm install @yansongda/miniprogram-otp` | [English](packages/miniprogram-otp/README.md) · [中文](packages/miniprogram-otp/README-cn.md)   |
| [`@yansongda/otp`](https://ohpm.openharmony.cn/)                                         | 鸿蒙 / ArkTS（HAR）    | `ohpm install @yansongda/otp`            | [English](packages/ohos-otp/library/README.md) · [中文](packages/ohos-otp/library/README-cn.md) |

## 快速开始

### 微信小程序

```bash
npm install @yansongda/miniprogram-otp
```

安装后在微信开发者工具执行 **工具 → 构建 npm**（包声明了 `"miniprogram": "dist"`）。

```ts
import { TOTP, HOTP, Secret, OTPAuthURI } from "@yansongda/miniprogram-otp";

// TOTP：默认 SHA-1 / 6 位 / 30 秒
const totp = new TOTP({ secret: "JBSWY3DPEHPK3PXP" });
totp.generate(); // 当前验证码
totp.remaining(); // 当前时间步剩余秒数
totp.progress(); // 0..1，供环形进度条

// 计数器型 HOTP
const hotp = new HOTP({ secret: "JBSWY3DPEHPK3PXP", counter: 0 });
hotp.generate(); // counter=0 的验证码

// 带 ±1 步漂移窗口校验
const token = totp.generate();
totp.verify(token, { window: 1 }); // 0 | -1 | 1 | null

// 解析 otpauth:// URI（例如来自二维码）
const params = OTPAuthURI.parse(
  "otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP&issuer=ACME",
);
```

### 鸿蒙 / ArkTS

```bash
ohpm install @yansongda/otp
```

```ts
import { TOTP, OtpAlgorithm } from "@yansongda/otp";

const totp = new TOTP({
  secret: "JBSWY3DPEHPK3PXP",
  algorithm: OtpAlgorithm.SHA256,
});
totp.generate();
totp.verify(token, { window: 1 });
```

## 关键行为

| 主题         | 行为                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| 校验         | 恒定时间比较；窗口内扫描完全部候选后才返回首个命中                             |
| 时钟漂移     | `verify()` 返回命中的步偏移；`syncClockOffset(delta)` 永久记录该偏移           |
| 错误模型     | `OtpError.code` 为 18 个冻结字符串码之一；消息固定，绝不包含 secret / token    |
| 密钥处理     | `Secret` 不实现 `toString()`；`JSON.stringify(secret)` 输出 `"[REDACTED]"`     |
| counter 范围 | 0 … 2^53-1（不使用 BigInt，兼容老 WebView）                                    |
| base32       | 默认宽松（大小写 / 空白 / 填充）；`{ strict: true }` 拒绝被截断或改写的 secret |

## 平台差异

|            | 微信小程序                                                                                  | 鸿蒙 / ArkTS                                  |
| ---------- | ------------------------------------------------------------------------------------------- | --------------------------------------------- |
| HMAC / SHA | 纯 JS 实现，打包进 `dist`                                                                   | `@kit.CryptoArchitectureKit` 同步 HMAC        |
| 随机源     | 微信无同步 CSPRNG；未注入 `RandomSource` 时 `Secret.generate()` 抛 `CRYPTO_NOT_INITIALIZED` | 默认注册 `cryptoFramework.generateRandomSync` |
| 类型层     | TS 字面量联合（`"SHA1"` 或 `OtpAlgorithm.SHA1`）                                            | ArkTS enum（`OtpAlgorithm.SHA1`）             |

## 仓库结构

```
packages/core/                # 唯一实现（不对外发布）
packages/miniprogram-otp/     # 微信 npm 包（tsdown 单文件打包）
packages/ohos-otp/            # DevEco 工程 + HAR 包
scripts/sync-core.mjs         # core -> ohos library 生成副本（CI 校验漂移）
```

## 开发

```bash
bun install
bun run check            # sync check + lint + typecheck + tests
bun run test             # core（242）+ miniprogram（9）
bun run sync:core        # 重新生成 ohos 的 core 副本
bun run sync:core:check  # 副本漂移则失败
```

鸿蒙构建与设备测试需要 DevEco Studio；精确命令见 [`packages/ohos-otp/AGENTS.md`](packages/ohos-otp/AGENTS.md)。

发布 tag：`miniprogram-vX.Y.Z`（npm，OIDC 自动发布）与 `ohos-vX.Y.Z`（OHPM，人工发布）。

## 许可证

MIT
