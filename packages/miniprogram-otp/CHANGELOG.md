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
- `Secret.fromBytes` 只接受 8 位无符号视图（`Uint8Array` / `Uint8ClampedArray`）与
  `ArrayBuffer`，其余（`Int8Array` / `Uint16Array` / `DataView` / 字符串 / array-like）一律
  `INVALID_SECRET_CONTAINER`；`ArrayBuffer` 入参改为真正的拷贝语义（原先是内存别名）
- `OTPAuthURI.parse` 的 `digits` / `period` / `counter` 只认纯十进制整数；
  `OTPAuthURI.build` 对非法参数改为抛错
- `OTPAuthURI` label 语义按 Key URI Format 的 ABNF 收敛：分隔符是「原始串中首个 `:` 或
  `%3A`（大小写不敏感）」，与 query 里有没有 `issuer` 无关；`issuer` 参数仍优先于 label 前缀，
  但不再影响切分；分隔符后的 `%20`（以及原始空格）按 padding 剥离
- `OTPAuthURI.parse` 与 `build` 的 label 契约统一为 fail-closed（此前 parse 放宽，导致「解析
  出来的参数要等到 `toURI()` 才抛错」）：`account` 缺失 / 为空 / 含冒号（明文 "Neither issuer
  nor account name may themselves contain a colon"）、label 段不可百分号编码（孤立代理字符）、
  已知 query 参数（secret / issuer / algorithm / digits / period / counter）重复出现 →
  `INVALID_OTPAUTH_URI`。因此 `build(parse(uri))` 恒可序列化
- `OTPAuthURI.build` / `toURI()` 的 `account` 改为**必填**（缺失或空串抛 `INVALID_OTPAUTH_URI`）：
  Key URI Format 要求 label 必填，而 label 只能由 `account` 派生；`issuer` 仍可省略
- `OTPAuthURI.build` / `toURI()`：`issuer` 含冒号或 `account` 以空格开头**不再报错**，改为省略
  label 前缀、只写 `issuer=` 参数（`issuer` 参数是 pchar，允许冒号；label 前缀不允许）
- `OtpAuthParams.account` 由可选改为**必填**（类型级；JS / JSON 调用方仍由运行期校验兜底）
- 分隔符后的**原始空格**也按 padding 剥离：`ACME: alice` 的 `account` 从 `" alice"` 变为
  `"alice"`（规范只写 `%20`，此处为宽容超集，已在 README 标注）
- **存量数据迁移（一次性）**：1.x 在无 `account` 时产出的 `otpauth://totp/?secret=…`（以及已经
  印出去的二维码）现在会被 `parse` / `TOTP.fromURI` / `HOTP.fromURI` 以 `INVALID_OTPAUTH_URI`
  拒收。用存下来的 `secret` 重建并补 `account` / `issuer`：
  `new TOTP({ secret, issuer, account }).toURI()`（或 `OTPAuthURI.build(params)`）
- `HOTP.verify` 不再接受 `timestamp`、`TOTP.verify` 不再接受 `counter`（对象字面量会编译失败）
- `verify` 校验顺序改为「配置类先于输入类」：坏 token 与坏 `counter` / `window` 同时出现时
  返回 `INVALID_COUNTER` / `INVALID_WINDOW`（此前 `INVALID_TOKEN`）
- 构造期校验顺序调整为 algorithm 先于 digits：`{ algorithm: "MD5", digits: 5 }` 两项同时
  非法时现在返回 `INVALID_ALGORITHM`（此前 `INVALID_DIGITS`）
- `OTPAuthURI.parse` 的 `issuer=` 空 query 值按「未提供」处理，不再抹掉 label 里的合法 issuer
- `strict` 模式解单字符 secret（如 `"A"`）：`INVALID_BASE32_PADDING` → `SECRET_TOO_SHORT`
  （与宽松模式同码）

### Added

- `OtpError.codeString`：保留 core 传入的原始错误码字符串（平台码表是强类型投影，
  未来新增码在枚举尚未同步时仍可拿到真实值）
- `OtpErrorCode` 取值由 core 唯一提供（barrel 导出），平台层不再手抄码表
- 新错误码 `INVALID_SECRET_CONTAINER`（secret 容器类型不对）、`INVALID_SECRET_LENGTH`
  （`Secret.generate` 长度越界）、`INVALID_MIN_SECRET_BITS`（`minSecretBits` 参数非法）、
  `INVALID_CLOCK_OFFSET`（时钟偏移参数非法）
- 导出 `MAX_VERIFY_WINDOW`、`HotpVerifyOptions`、`TotpVerifyOptions`

### Changed

- 三端 `OtpError.name` 契约统一为 `OtpError`（provider 错误契约：core 的 engine 靠它区分
  「已知错误原样上抛」与「provider 实现缺陷」）；**本包此前已是该值，行为不变**，本次新增的是守卫
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
- `OTPAuthURI.parse` 的 label 分隔符按 ABNF 识别：`%3A` 与 `%3a` 无条件当分隔符
  （此前只在 query `issuer` 与前缀相等时才切，导致规范的 `issuer%3Aaccount` 形态丢 issuer），
  并剥离分隔符后的空格 padding（`*"%20"`，如规范示例 `Big%20Corporation%3A%20alice%40bigco.com`）
- 错误模型改造本身对 npm 用户无破坏性变更（仅新增 `OtpError.codeString`）；本版本的其它破坏性变更见上方 Breaking changes

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
