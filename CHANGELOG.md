# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-11-11

### Added

- 从 `yansongda-application/wechat/miniprogram/totp/src/otp` 提取为独立 npm 包 `@yansongda/miniprogram-otp`
- RFC 4226 HOTP / RFC 6238 TOTP（SHA1 / SHA256 / SHA512，6 / 7 / 8 位）
- `verify` 漂移窗口、`syncClockOffset` 时钟校准、`remaining` / `progress`
- `Secret` 规范化、严格 Base32、字节/位数自省、`toJSON()` 脱敏
- `otpauth://` URI 解析与生成、`TOTP.fromURI` / `HOTP.fromURI`
- 统一 `OtpError` 与 18 个冻结错误码
- 纯 JS HMAC / SHA，零运行时依赖，TypeScript 类型声明
- Bun 测试 242 项、不变量守卫、构建产物冒烟、GitHub Actions CI

### Compatibility

- 公开 API、DTO 字段、错误码与算法行为对齐 `ohos-otp/library` v1.1.0
- 与 OHOS 的差异：HMAC 为纯 JS；微信无同步 CSPRNG，默认不注册随机源
