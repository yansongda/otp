# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.0.0] - 2026-11-21

破坏性收敛版本：参数口径、secret 容器与 `otpauth://` 三条边界统一改为 fail-closed，错误码从 18 个扩到 22 个，`verify` 多重命中改取最接近基准步的偏移；发布物在构建期剥离源码注释，`dist/index.js` 体积下降约 10%。

### Breaking changes

**参数口径**

- `verify({ window })` 新增上限 `MAX_VERIFY_WINDOW = 10`（超出抛 `INVALID_WINDOW`；此前无上限）
- 时间参数统一要求**安全整数**：`timestamp`（非负）、`period`（正）、`t0`（非负）、`clockOffsetMs`；
  小数 / `NaN` / 超大值不再被接受（`remaining()` / `progress()` 同样收紧）
- `minSecretBits` 不是「非负安全整数」→ `INVALID_MIN_SECRET_BITS`：此前 `NaN` 之类会被
  `NaN > 0 === false` 静默跳过强度校验，现在是 fail-closed
- `TOTP` 的 `timestamp` 合法但叠加 `clockOffsetMs` 后为负 / 超出安全整数 →
  `INVALID_CLOCK_OFFSET`（偏移越界属配置问题，不再归咎成 timestamp 非法）

**错误码归因**

- `Secret.generate(bytes)` 长度越界 → `INVALID_SECRET_LENGTH`（此前误用 `SECRET_TOO_WEAK`；
  密钥强度问题仍由 `minSecretBits` 的 `SECRET_TOO_WEAK` 承担）
- `clockOffsetMs` 非安全整数 → `INVALID_CLOCK_OFFSET`（此前 `INVALID_TIMESTAMP`）；
  `syncClockOffset(delta)` 的 delta 非安全整数或累加后越界 → `INVALID_CLOCK_OFFSET`
  （此前 `INVALID_WINDOW`）
- 严格 base32 解析单字符 secret（如 `"A"`）→ `SECRET_TOO_SHORT`（此前 `INVALID_BASE32_PADDING`）：
  同一致命输入在宽松 / 严格模式下现在给同一个码
- `OTPAuthURI.build` 的 `type` 不是 `totp` / `hotp` → `UNSUPPORTED_OTPAUTH_TYPE`
  （此前静默按 hotp 输出）；`digits` / `period` / `counter` 非法 → 对应错误码（此前原样写进 URI）

**secret 容器**

- `Secret.fromBytes` 运行时只接受 8 位无符号视图（`Uint8Array` / `Uint8ClampedArray`）与
  `ArrayBuffer`；`Int8Array` / `Uint16Array` / `DataView` / 字符串 / array-like / `null`
  一律 `INVALID_SECRET_CONTAINER`。原因：`new Uint8Array(x)` 对 TypedArray 是逐元素而非逐字节
  转换（`Uint16Array` 静默丢高位字节），字符串 / array-like 会得到 0 字节或全零密钥
- `ArrayBuffer` 入参改为**拷贝**语义（此前是内存别名：调用方清零或改写原 buffer 会直接改到实例密钥）
- `Secret.fromBase32` 的 `input`、`OTPAuthURI.build` 的 `secret` 不是字符串 →
  `INVALID_SECRET_CONTAINER`（此前漏原生 `TypeError`）
- `{ strict }` 改为 fail-closed：只有「未提供」或明确 `false` 才是宽松解析，非 boolean
  （服务端 JSON 的 `1` / `"true"`）按 strict 处理

**verify**

- `HOTP.verify` 不再接受 `timestamp`、`TOTP.verify` 不再接受 `counter`：新增按类收窄的
  `HotpVerifyOptions` / `TotpVerifyOptions`，对象字面量传错字段会编译失败
- 校验顺序改为「配置类先于输入类」：坏 token 与坏 `counter` / `window` 同时出现时返回
  `INVALID_COUNTER` / `INVALID_WINDOW`（此前 `INVALID_TOKEN`）
- 构造期校验顺序改为 algorithm 先于 digits：`{ algorithm: "MD5", digits: 5 }` 两项同时非法时返回
  `INVALID_ALGORITHM`（此前 `INVALID_DIGITS`）

**otpauth:// URI**

- label 分隔符按 Key URI Format 的 ABNF 判定：**原始串**中首个 `:` 或 `%3A`（十六进制大小写
  不敏感），与 query 是否存在 `issuer`、前缀是否等于 `issuer` 无关；分隔符后的 `%20` 与
  **原始空格**一律按 padding 剥离（`ACME: alice` 的 `account` 从 `" alice"` 变为 `"alice"`）
- `account` 变为**必填**（`OtpAuthParams.account` 类型级 + `parse` / `build` 运行期）：
  缺失 / 为空 / 含冒号 → `INVALID_OTPAUTH_URI`；label 段不可百分号编码（孤立代理字符）同样拒绝。
  因此 `build(parse(uri))` 恒可序列化
- **存量数据迁移（一次性）**：1.x 在无 `account` 时产出的 `otpauth://totp/?secret=…`（含已印出的
  二维码）现在会被 `parse` / `TOTP.fromURI` / `HOTP.fromURI` 以 `INVALID_OTPAUTH_URI` 拒收。
  用存下来的 `secret` 重建并补 `account`（`issuer` 可选）：
  `new TOTP({ secret, issuer, account }).toURI()` 或 `OTPAuthURI.build(params)`
- 已知 query 参数（`secret` / `issuer` / `algorithm` / `digits` / `period` / `counter`）重复出现
  → 整条 URI `INVALID_OTPAUTH_URI`（此前「后者覆盖前者」，后段可静默改写 algorithm / digits）
- `digits` / `period` / `counter` 只认纯十进制整数：`0x7` / `1e3` / 正负号 / 小数 / 空白一律拒绝；
  `counter` 超 `2^53-1` → `INVALID_COUNTER`（此前接受并丢精度）
- `issuer=` 的空 query 值按「未提供」处理，不再抹掉 label 前缀里合法的 issuer

### Added

- `OtpError.codeString`：保留 core 传入的原始错误码字符串（平台码表是强类型投影，未来新增码在
  枚举 / 联合尚未同步时仍能拿到真实值）
- 4 个新错误码：`INVALID_SECRET_CONTAINER`、`INVALID_SECRET_LENGTH`、`INVALID_MIN_SECRET_BITS`、
  `INVALID_CLOCK_OFFSET`（共 22 个；v1 起仅允许新增，已有字符串值不改）
- `OtpErrorCode` 的取值由共享 core 唯一提供并经 barrel 导出（平台层不再手抄码表）
- 导出 `MAX_VERIFY_WINDOW`、`HotpVerifyOptions`、`TotpVerifyOptions`
- `Secret.fromBytes` 接受 `Uint8ClampedArray`（`ImageData.data`、`getRandomValues(new Uint8ClampedArray)` 等 API 直接产出的类型）

### Changed

- BREAKING: provider 错误契约收紧。provider 失败必须抛 `name === "OtpError"` 的错误
  （core `otpFail` / 平台 `OtpError`），engine 只把**未知**错误（非 `Error`、缺 `OtpError.name`、
  返回值非 `Uint8Array`、摘要长度与算法不匹配）收敛为 `CRYPTO_FAILED`；已知错误码原样上抛。
  此前任意 provider 异常原样透传（调用方拿不到 `OtpError`），摘要长度与算法不匹配时（如 SHA256
  provider 只返回 20 字节）会静默算出错误的码而不是报错。
  迁移：自定义 `HmacProvider` / `RandomSource` 若曾抛原生 `Error` 并依赖其被透传，改为抛
  `OtpError`（或用 `otpFail` 的语义），否则会收到 `CRYPTO_FAILED`。`key` / `message` 现在明确为
  只读入参（库每次公开调用传一份密钥副本，同一次调用的窗口扫描复用该副本）
- `TOTP.generate/verify(timestamp: 0)`（epoch 0）现在合法（此前抛 `INVALID_TIMESTAMP`）
- `options` 传 `null` 与未传等价（`JSON.parse("null")` 的常见形态）：
  `Secret.fromBase32`、`OTPAuthURI.parse`、`HOTP/TOTP.verify` 都不再漏 `TypeError`
- `OTPAuthURI.build` 在 `issuer` 含冒号、或 `account` 以空格开头时**省略 label 前缀**、只写
  `issuer=` 参数（issuer 参数是 pchar，label 前缀不是）。此前会产出无法往返的 URI：
  `issuer: "ACME:Corp"` 编码成 `ACME%3ACorp:alice`，`parse` 回来是 `issuer="ACME"` +
  `account="Corp:alice"`；`account` 的前导空格则会被 parse 当 padding 剥掉
- 纯 JS 热路径提速（行为不变，`bun run bench:ab` 同机 A/B）：SHA-512 去掉 `[hi, lo]` 元组分配改
  标量 hi/lo（`hmac sha512` 约 5x）；base32 解码改「128 项查表 + 单遍位缓冲」（`Secret.fromBase32`
  约 3x）；HMAC 每次少分配一个密钥块缓冲
- 发布物（`dist/index.js`）在构建期剥离源码注释：41.9 KB → 37.7 KB（`gzip -9` 13.7 KB → 9.9 KB），
  运行时行为不变；`dist/index.d.ts` 保留 JSDoc 供 IDE 提示（10.3 KB → 18.6 KB）

### Fixed

- `verify` 多重命中（概率约 `window/10^digits`）：改为返回 **|delta| 最小**的命中偏移，
  |delta| 相同时取正方向。此前按扫描顺序返回最负偏移，HOTP 用 `counter = base + delta + 1`
  重置时会把计数器往回退，等于重新放行更早的验证码（RFC 4226 §7.4 防重放要避免的方向）。
  单命中 / 未命中行为不变
- `Secret.generate` 的随机源返回值不再「静默 fail-open」：长度必须等于请求的 `bytes`，容器规则与
  `Secret.fromBytes` 同源（`Uint8Array` / `Uint8ClampedArray` / `ArrayBuffer` 放行，字符串 /
  array-like / `null` / 其它 TypedArray 一律 `CRYPTO_FAILED`）。此前字符串可静默产出 0 字节空密钥、
  `null` 漏原生 `TypeError`
- 非字符串入参不再漏原生异常：`token` → `INVALID_TOKEN`、`uri` / `issuer`·`account` /
  无法百分号编码的孤立代理字符 → `INVALID_OTPAUTH_URI`
- 原型链修复只在「原型已退化为 `Error.prototype`」时执行。此前无条件
  `Object.setPrototypeOf` 会把 `OtpError` 子类实例的原型改回基类（`instanceof` 子类失效、
  原型方法丢失）；ES5 + 自定义子类仍需调用方自行修正原型链（见 README）
- `otpFail` 校验工厂返回值：平台工厂返回非 `Error` 或缺少字符串 `code` 时兜底 core 默认类，
  调用方始终能拿到 `instanceof Error` + 可分支的 `code`
- 防御层错误码误报：pure-js provider 的算法查表改用 switch，`"constructor"` / `"toString"` 这类
  `Object.prototype` 继承键不再被当成算法命中（此前把「算法不被接受」错报成 `CRYPTO_FAILED`）；
  engine 把未知算法归为 `INVALID_ALGORITHM` 以与各 provider 同语义。公开 API 已在构造期与 URI
  parse 拦截非法算法，此处是纵深防御

### Engineering

- 发布物体积守卫 `bun run check:size`（`dist/index.js` ≤ 40 KB / gzip ≤ 12 KB，`dist/index.d.ts`
  ≤ 20 KB / gzip ≤ 8 KB，并校验 `dist/` 无预期外文件），已纳入 `release:check` 与 CI；
  CI 用 Node 24 钉住 gzip 口径，避免 runner 换版本后同一份产物压出不同字节而误报
- `release-miniprogram.yml` 去掉 publish 后立即 `npm view` 的核验步骤（registry 传播需数十秒到
  几分钟，立即查询必然 404，曾误报发布失败），改为写 Job Summary；发布物核验统一放到本地
- `ci.yml` 删除重复的 miniprogram lint 步骤（根 `biome check` 已覆盖该包），新增体积守卫步骤
- 单源收敛：`internal/algorithm.ts`（算法名 → 摘要长度 / HMAC 分块长度）、
  `internal/bytes.ts`（secret 与随机源共用的字节容器判定）、`internal/resolve.ts`
  （HOTP / TOTP 共享的构造解析与校验顺序）、`options.ts` 的默认值常量
- 不变量守卫新增：源码禁止平台能力（`wx.*` / `@kit.*`）、错误码唯一来源 core、
  `verify` DTO 唯一来源 core、`MAX_VERIFY_WINDOW` 以值形式导出、`OtpError.name` 契约、
  原型修复条件一致性、barrel 禁止 `as unknown as` 整体断言
- `smoke:dist` 覆盖 22 个错误码、`MAX_VERIFY_WINDOW`、非字符串入参 fail-closed 与 URI label 契约
- 新增 `scripts/bench/`：core 热路径基准 + 与 `main` 的同进程交错 A/B（`bun run bench` /
  `bun run bench:ab`）；新增与 `node:crypto` 的差分对拍测试
- `.bun-version` 收敛到仓库根，删除包内 `bun.lock`；`scripts/sync-core.mjs` 补齐 OHOS 副本溯源信息

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
