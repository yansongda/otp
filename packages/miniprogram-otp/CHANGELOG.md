# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Breaking changes

- `verify({ window })`：**新增上限 10**（`MAX_VERIFY_WINDOW`；此前无上限，超出抛
  `INVALID_WINDOW`）
- 时间参数统一要求安全整数：`timestamp`（非负）、`period`（正）、`t0`（非负）、
  `clockOffsetMs`；小数 / `NaN` / 超大值不再静默接受
- 错误码归因调整：`Secret.generate` 长度越界 → `INVALID_SECRET_LENGTH`；`clockOffsetMs`
  非法、同步偏移越界 → `INVALID_CLOCK_OFFSET`；`minSecretBits` 非法 →
  `INVALID_MIN_SECRET_BITS`（fail-closed，不再静默关闭强度校验）
- `Secret.fromBytes` 非字节容器 → `INVALID_SECRET_CONTAINER`；`ArrayBuffer` 入参改为真正的
  拷贝语义（原先是内存别名）
- `OTPAuthURI.parse` 的 `digits` / `period` / `counter` 只认纯十进制整数；
  `OTPAuthURI.build` 对非法参数改为抛错
- `OTPAuthURI` label 语义：无原始冒号的 label 一律视为 account；仅当 query `issuer` 与
  label 前缀一致时才把首个 `%3A` 当历史分隔符。仅有 label 前缀、不带 query `issuer` 的
  旧式 `issuer%3Aaccount` URI 将只保留完整 account（issuer 丢失）
- `build` / `toURI()` 在 `account` 为空时不再把 issuer 写进 label（`otpauth://totp/?...`）
- `HOTP.verify` 不再接受 `timestamp`、`TOTP.verify` 不再接受 `counter`（对象字面量会编译失败）
- 移除类型别名 `OtpFailureCode`；`OtpErrorCode` 取值由 core 唯一提供
- `verify` 校验顺序改为「配置类先于输入类」：坏 token 与坏 `counter` / `window` 同时出现时
  返回 `INVALID_COUNTER` / `INVALID_WINDOW`（此前 `INVALID_TOKEN`）
- `OTPAuthURI.parse` 的 `issuer=` 空 query 值按「未提供」处理，不再抹掉 label 里的合法 issuer
- `strict` 模式解单字符 secret（如 `"A"`）：`INVALID_BASE32_PADDING` → `SECRET_TOO_SHORT`
  （与宽松模式同码）

### Added

- `OtpError.codeString`：保留 core 传入的原始错误码字符串（平台码表是强类型投影，
  未来新增码在枚举尚未同步时仍可拿到真实值）
- `OtpErrorCode` 取值由 core 唯一提供（barrel 导出），平台层不再手抄码表
- provider 契约写进 `HmacProvider` / `RandomSource` 的接口注释：`key` / `message` 只读，
  不得修改或跨调用保留引用（库每次公开调用传一份密钥副本）
- 新错误码 `INVALID_SECRET_CONTAINER`（secret 容器类型不对）、`INVALID_SECRET_LENGTH`
  （`Secret.generate` 长度越界）、`INVALID_MIN_SECRET_BITS`（`minSecretBits` 参数非法）、
  `INVALID_CLOCK_OFFSET`（时钟偏移参数非法）
- 导出 `MAX_VERIFY_WINDOW`、`HotpVerifyOptions`、`TotpVerifyOptions`

### Changed

- `OtpError` 的 `name` 固定为 `OtpError`（provider 错误契约：core 的 engine 靠它区分
  「已知错误原样上抛」与「provider 实现缺陷」）
- 错误抛出统一走 core 的 `otpFail` → 平台工厂：core 与平台不再有两条错误构造路径
- 原型链修复改为**只在原型退化为 `Error.prototype` 时**执行（此前无条件
  `Object.setPrototypeOf` 会把 `OtpError` 子类实例的原型改回基类：`instanceof` 子类失效、
  原型方法丢失；ES5 + 自定义子类仍需调用方自行修正原型链）
- `otpFail` 校验工厂返回值：返回非 `Error` 或缺少字符串 `code` 时兜底 core 默认类，
  调用方始终能拿到 `instanceof Error` + 可分支的 `code`
- `{ strict }` 改为 fail-closed：只有「未提供」或明确 `false` 才是宽松，非 boolean
  （服务端 JSON 的 `1` / `"true"`）按 strict 处理
- `OTPAuthURI.parse` 的 `counter > 2^53-1` 现在抛 `INVALID_COUNTER`（此前接受且丢精度）
- `OTPAuthURI.build` 补齐与 parse 对称的校验（此前 `type: "TOTP"` 静默变 hotp、
  `digits: 5` / `period: 0` 原样输出）：非法参数改为抛码
- 非字符串入参不再漏原生 `TypeError`：`secret` → `INVALID_SECRET_CONTAINER`、
  `token` → `INVALID_TOKEN`、`uri` / `build` 的 `issuer`·`account` → `INVALID_OTPAUTH_URI`
  （含无法百分号编码的孤立代理字符）
- 可选 `options` 传 `null` 等价于未传（`JSON.parse("null")` 的常见形态），不再漏
  `TypeError`；`OTPAuthURI.build` 的 `params` 传非对象 → `INVALID_OTPAUTH_URI`

### Fixed

- provider 错误契约：失败必须抛 `name === "OtpError"` 的错误，engine 只把**未知**错误收敛为
  `CRYPTO_FAILED`（此前任意 provider 异常原样透传，调用方拿不到 `OtpError`）；provider 的
  非 `Uint8Array` 返回值同样收敛
- provider 摘要长度必须与算法匹配（SHA1=20 / SHA256=32 / SHA512=64）：不匹配统一
  `CRYPTO_FAILED`（此前 SHA256/512 返回 20 字节摘要会被静默截断）
- 随机源返回值类型与长度校验：非 `Uint8Array`（字符串 / array-like / `null`）或长度不符
  一律 `CRYPTO_FAILED`（此前字符串可静默产出 0 字节空密钥，`null` 漏 `TypeError`）
- 纯 JS provider 的算法查表改用 switch：`HASH_SPECS["constructor"]` 会命中
  `Object.prototype` 继承键，把「算法不被接受」错报成 `CRYPTO_FAILED`
- `Secret.fromBytes(ArrayBuffer)` 改为拷贝语义（原先是内存别名）：调用方清零 / 改写原
  buffer 不再影响实例密钥
- `Secret.fromBytes` / `fromBase32` 的容器类型在转换**之前**判定：字符串 / array-like
  不再被 `new Uint8Array(...)` 静默变成 0 字节空密钥或全零密钥
- `TOTP.generate/verify(timestamp: 0)`（epoch 0）现在合法（此前抛 `INVALID_TIMESTAMP`）
- `TOTP` 显式 `timestamp` 合法但叠加 `clockOffsetMs` 后为负 → `INVALID_CLOCK_OFFSET`
  （不再把偏移配置问题归咎成入参非法）
- `minSecretBits` 非法值改为 fail-closed（此前 `NaN > 0` 为 false 会**静默关闭**强度校验）
- `Secret.generate(bytes)` 长度越界改报 `INVALID_SECRET_LENGTH`（此前误用 `SECRET_TOO_WEAK`）
- `syncClockOffset(1.5)` 改报 `INVALID_CLOCK_OFFSET`（此前误用 `INVALID_WINDOW`）

### Removed

- 类型别名 `OtpFailureCode`（与 `OtpErrorCode` 完全等价，重复声明）

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
