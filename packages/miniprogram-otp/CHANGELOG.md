# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Breaking changes

- `verify({ window })` 上限 1000 → 10（`MAX_VERIFY_WINDOW`，超出抛 `INVALID_WINDOW`）
- 时间参数统一要求安全整数：`timestamp`（非负）、`period`（正）、`t0`（非负）、`clockOffsetMs`；小数 / `NaN` / 超大值不再静默接受
- 错误码归因调整：`Secret.generate` 长度越界 → `INVALID_SECRET_LENGTH`；`clockOffsetMs` 非法、同步偏移越界 → `INVALID_CLOCK_OFFSET`；`minSecretBits` 非法 → `INVALID_MIN_SECRET_BITS`（fail-closed，不再静默关闭强度校验）
- `Secret.fromBytes` 非字节容器 → `INVALID_SECRET_CONTAINER`；`ArrayBuffer` 入参改为真正的拷贝语义（原先是内存别名）
- `OTPAuthURI.parse` 的 `digits` / `period` / `counter` 只认纯十进制整数；`OTPAuthURI.build` 对非法参数改为抛错
- `OTPAuthURI` label：无原始冒号的 label 一律视为 account；仅当 query `issuer` 与 label 前缀一致时才把首个 `%3A` 当历史分隔符。仅有 label 前缀、不带 query `issuer` 的旧式 `issuer%3Aaccount` URI 将只保留完整 account（issuer 丢失）
- `HOTP.verify` 不再接受 `timestamp`、`TOTP.verify` 不再接受 `counter`（对象字面量会编译失败）
- 移除类型别名 `OtpFailureCode`；`OtpErrorCode` 取值由 core 唯一提供
- 非字符串入参不再漏原生 `TypeError`：`secret` → `INVALID_SECRET_CONTAINER`、`token` → `INVALID_TOKEN`、`uri` / `build` 的 `issuer`·`account` → `INVALID_OTPAUTH_URI`（含无法百分号编码的孤立代理字符）

### Added

- 新错误码 `INVALID_SECRET_CONTAINER`（字节容器类型不对，与「空密钥」区分）
- `OtpError.codeString`：保留原始错误码字符串（未知码兜底时仍可拿到真实值）
- 导出 `MAX_VERIFY_WINDOW`、`HotpVerifyOptions`、`TotpVerifyOptions`

### Changed

- `OtpError.name` 固定为 `OtpError`；provider 错误契约收紧（仅未知错误收敛为 `CRYPTO_FAILED`，已知错误码原样上抛）
- `OtpErrorCode` 收敛到 core 单源，平台层不再手抄码表
- 参数校验顺序固定为逐入口顺序表（构造 / URI parse / URI build / verify）

### Fixed

- `Secret.fromBytes(ArrayBuffer)` 改为拷贝，调用方清零/改写原 buffer 不再影响实例密钥
- `TOTP` 显式 timestamp 合法但叠加偏移后为负或越界 → `INVALID_CLOCK_OFFSET`（不归咎入参）
- provider 摘要长度与算法不匹配统一收敛为 `CRYPTO_FAILED`
- 随机源返回非 `Uint8Array` / 长度不符 / 抛出非 `OtpError` 一律收敛为 `CRYPTO_FAILED`
- `OTPAuthURI.build` / `toURI()` 不再漏原生 `URIError`：孤立代理字符（如被 `slice` 截断的 emoji）收敛为 `INVALID_OTPAUTH_URI`
- 历史 `%3A` 分隔符识别改为大小写不敏感扫描：小写后会变长的字符（`İ`）不再导致下标错位、丢 issuer

## [1.0.1] - 2026-11-12

发布链路验证版：无代码变更，用于通过 OIDC Trusted Publishing 完成一次真实发布。

### Engineering

- 通过 `release-miniprogram.yml` 的 OIDC Trusted Publishing 完成首发后的首次自动化发布验证
- 发布物内容与 1.0.0 一致

## [1.0.0] - 2026-11-12

### Added

- 从 `yansongda-application/wechat/miniprogram/totp/src/otp` 提取为独立 npm 包 `@yansongda/miniprogram-otp`
- RFC 4226 HOTP / RFC 6238 TOTP（SHA1 / SHA256 / SHA512，6 / 7 / 8 位）
- `verify` 漂移窗口、`syncClockOffset` 时钟校准、`remaining` / `progress`
- `Secret` 规范化、严格 Base32、字节/位数自省、`toJSON()` 脱敏
- `otpauth://` URI 解析与生成、`TOTP.fromURI` / `HOTP.fromURI`
- 统一 `OtpError` 与 18 个冻结错误码
- 纯 JS HMAC / SHA，零运行时依赖，TypeScript 类型声明
- 新增 tag `miniprogram-v*` 触发的 OIDC 发布 workflow（`.github/workflows/release-miniprogram.yml`）：tag/version 校验、`release:check`、已发布版本跳过、npm provenance
- 实现收敛到 monorepo 共享 core（`packages/core`）；`tsdown` 输出单文件 CJS + 单文件 d.ts，发布物自包含
- core 测试 242 项 + 平台契约测试 9 项、不变量守卫、构建产物冒烟、GitHub Actions CI

### Compatibility

- 公开 API、DTO 字段、错误码与算法行为对齐 `ohos-otp/library` v1.1.0
- 与 OHOS 的差异：HMAC 为纯 JS；微信无同步 CSPRNG，默认不注册随机源
