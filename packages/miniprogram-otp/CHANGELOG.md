# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- `OtpError.codeString`：保留 core 传入的原始错误码字符串（平台码表是强类型投影，
  未来新增码在枚举尚未同步时仍可拿到真实值）
- `OtpErrorCode` 取值由 core 唯一提供（barrel 导出），平台层不再手抄码表

### Changed

- 三端 `OtpError.name` 契约统一为 `OtpError`（provider 错误契约：core 的 engine 靠它区分
  「已知错误原样上抛」与「provider 实现缺陷」）；**本包此前已是该值，行为不变**，本次新增的是守卫
- 错误抛出统一走 core 的 `otpFail` → 平台工厂：core 与平台不再有两条错误构造路径
- 原型链修复改为**只在原型退化为 `Error.prototype` 时**执行（此前无条件
  `Object.setPrototypeOf` 会把 `OtpError` 子类实例的原型改回基类：`instanceof` 子类失效、
  原型方法丢失；ES5 + 自定义子类仍需调用方自行修正原型链）
- `otpFail` 校验工厂返回值：返回非 `Error` 或缺少字符串 `code` 时兜底 core 默认类，
  调用方始终能拿到 `instanceof Error` + 可分支的 `code`
- **对 npm 用户无破坏性变更**：本包对外只新增 `OtpError.codeString`，无删除、无签名变更

### Removed

- core 内部类型别名 `OtpFailureCode`（与 `OtpErrorCode` 等价，重复声明）。它**从未出现在本包
  发布的类型声明里**（`dist/index.d.ts` 无此名），属于内部清理，npm 用户无感

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
