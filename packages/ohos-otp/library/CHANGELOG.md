# Changelog

## 2.0.0 - 2026-11-23

破坏性收敛版本：参数口径、secret 容器与 `otpauth://` 三条边界统一改为 fail-closed（含 4 个新错误码），`verify` 多重命中的 tie-break 改为取最接近基准步的偏移。与 `@yansongda/miniprogram-otp` 2.0.0 同源（共享 `packages/core` 唯一实现），行为口径逐条一致。

#### Breaking changes

- `verify({ window })`：**新增上限 10**（`MAX_VERIFY_WINDOW`；此前无上限，超出抛 `INVALID_WINDOW`）
- 时间参数统一要求安全整数：`timestamp`（非负）、`period`（正）、`t0`（非负）、`clockOffsetMs`；
  小数 / `NaN` / 超大值不再静默接受
- 错误码归因调整：`Secret.generate` 长度越界 → `INVALID_SECRET_LENGTH`；`clockOffsetMs` 非法、
  同步偏移越界 → `INVALID_CLOCK_OFFSET`；`minSecretBits` 非法 → `INVALID_MIN_SECRET_BITS`（fail-closed）
- `Secret.fromBytes` 只接受 8 位无符号视图（`Uint8Array` / `Uint8ClampedArray`）与 `ArrayBuffer`，
  其余（`Int8Array` / `Uint16Array` / `DataView` / 字符串 / array-like）一律 `INVALID_SECRET_CONTAINER`；
  `ArrayBuffer` 入参改为真正的拷贝语义
- `OTPAuthURI.parse` 的 `digits` / `period` / `counter` 只认纯十进制整数；`OTPAuthURI.build`
  对非法参数改为抛错
- `OTPAuthURI.build` 的 `type` 不是 `totp` / `hotp` → `UNSUPPORTED_OTPAUTH_TYPE`（此前静默按 hotp 输出）
- `OTPAuthURI` label 语义按 Key URI Format 的 ABNF 收敛：分隔符是「首个 `:` 或 `%3A`」，
  与 query 里有没有 `issuer` 无关；分隔符后的 `%20`（以及原始空格）按 padding 剥离
- `parse` 与 `build` 的 label 契约统一为 fail-closed：`account` 缺失 / 为空 / 含冒号（明文
  "Neither issuer nor account name may themselves contain a colon"）、label 段不可百分号编码、
  已知 query 参数重复出现 → `INVALID_OTPAUTH_URI`（`build(parse(uri))` 恒可序列化）
- `OTPAuthURI.build` / `toURI()` 的 `account` 改为**必填**（缺失或空串抛 `INVALID_OTPAUTH_URI`）：
  label 必填且只能由 `account` 派生，`issuer` 仍可省略
- `OTPAuthURI.build` / `toURI()`：`issuer` 含冒号或 `account` 以空格开头**不再报错**，改为省略
  label 前缀、只写 `issuer=` 参数
- `OtpAuthParams.account` 由可选改为**必填**（类型级；运行期仍校验空串）
- 分隔符后的**原始空格**也按 padding 剥离（规范只写 `%20`，此处为宽容超集）
- **存量数据迁移（一次性）**：1.x 在无 `account` 时产出的 `otpauth://totp/?secret=…`（以及已经
  印出去的二维码）现在会被 `parse` / `TOTP.fromURI` / `HOTP.fromURI` 以 `INVALID_OTPAUTH_URI`
  拒收。用存下来的 `secret` 重建并补 `account` / `issuer`：
  `new TOTP({ secret, issuer, account }).toURI()`（或 `OTPAuthURI.build(params)`）
- `HOTP.verify` 不再接受 `timestamp`、`TOTP.verify` 不再接受 `counter`（对象字面量会编译失败）
- `OtpError.name` 由 `'Error'` 改为 `'OtpError'`（provider 错误契约，三端一致）
- 非字符串入参不再漏原生 `TypeError`：`secret` → `INVALID_SECRET_CONTAINER`、`token` →
  `INVALID_TOKEN`、`uri` / `build` 的 `issuer`·`account` → `INVALID_OTPAUTH_URI`
- `verify` 校验顺序改为「配置类先于输入类」：坏 token 与坏 `counter` / `window` 同时出现时
  返回 `INVALID_COUNTER` / `INVALID_WINDOW`（此前 `INVALID_TOKEN`）
- 构造期校验顺序调整为 algorithm 先于 digits：`{ algorithm: "MD5", digits: 5 }` 两项同时
  非法时现在返回 `INVALID_ALGORITHM`（此前 `INVALID_DIGITS`）
- `OTPAuthURI.parse` 的 `counter > 2^53-1` 现在抛 `INVALID_COUNTER`（此前接受且丢精度）
- `TOTP.generate/verify(timestamp: 0)`（epoch 0）现在合法
- `strict` 模式解单字符 secret：`INVALID_BASE32_PADDING` → `SECRET_TOO_SHORT`
- provider 错误契约收紧：provider 失败必须抛 `name === 'OtpError'` 的错误，engine 只把**未知**
  错误（非 `Error`、缺 `OtpError.name`、返回值非 `Uint8Array`）收敛为 `CRYPTO_FAILED`；已知错误码
  原样上抛，保留 `INVALID_ALGORITHM` 等精确码（此前任意 provider 异常原样透传，调用方拿不到
  `OtpError`）

#### Added

- 新错误码 `INVALID_SECRET_CONTAINER`（secret 容器类型不对）、`INVALID_SECRET_LENGTH`
  （`Secret.generate` 长度越界）、`INVALID_MIN_SECRET_BITS`（`minSecretBits` 参数非法）、
  `INVALID_CLOCK_OFFSET`（时钟偏移参数非法）
- `OtpError.codeString`：保留 core 传入的原始错误码字符串（枚举尚未同步时仍能拿到真实值）
- 导出 `MAX_VERIFY_WINDOW`、`HotpVerifyOptions`、`TotpVerifyOptions`

#### Changed

- `OtpErrorCode` 取值与 core 单一来源对齐：枚举必须与 `packages/core/src/errors.ts`
  逐项一致（守卫脚本对拍名称 + 取值），`asOtpErrorCode` 必须覆盖全部码
- 平台 `CryptoSource` 的错误一律经 core 的 `otpFail` 走平台工厂，不再绕开工厂直接
  `new OtpError(...)`
- 原型链修复只在原型退化为 `Error.prototype` 时执行（无条件 `setPrototypeOf` 会破坏
  `OtpError` 子类的 `instanceof` 与原型方法）
- `{ strict }` 改为 fail-closed：非 boolean（`1` / `"true"`）按 strict 处理
- 可选 `options` 传 `null` 等价于未传；`OTPAuthURI.build` 的 `params` 传非对象 → `INVALID_OTPAUTH_URI`
- `syncClockOffset` 的 delta 非安全整数 / 累加溢出 → `INVALID_CLOCK_OFFSET`
- `verify` 多重命中时的 tie-break 显式化（行为变更，仅影响多个候选同时命中：概率 ~`window/10^digits`）：
  窗口按 `|delta|` 递增扫描，返回**最接近基准步**的偏移（同距离取正方向，永不把 counter 往回退）；
  此前按扫描顺序返回最负偏移，HOTP 用 `counter = base + delta + 1` 重置时会把计数器往回退、
  等于重新放行更早的验证码。单命中 / 未命中行为不变，HMAC 次数仍为 `1 + 2w`（不早退）
- 发布物收口：HAR 内不再包含 `src/main/ets/core/index.ts`（core 的 barrel）。副本内部没有任何引用，
  对外入口始终是 `Index.ets`；仅曾深导入该未文档化路径的用法会受影响
- core 热路径提速（**行为不变**，随 HAR 一起编译下发）：SHA-512 去掉 `[hi, lo]` 元组分配改标量 hi/lo、
  base32 解码改「查表 + 单遍位缓冲」、HMAC 每次少分配一个密钥块缓冲

#### Fixed

- `Secret.fromBytes(ArrayBuffer)` 改为拷贝，调用方清零 / 改写原 buffer 不再影响实例密钥
- `Secret.fromBytes` / `fromBase32` 的容器类型在转换之前判定：字符串 / array-like 不再被
  静默变成 0 字节或全零密钥
- `TOTP` 显式 `timestamp` 合法但叠加 `clockOffsetMs` 后为负 → `INVALID_CLOCK_OFFSET`
- `minSecretBits` 非法值 fail-closed（此前 `NaN > 0` 为 false 会静默关闭强度校验）
- `Secret.generate(bytes)` 长度越界改报 `INVALID_SECRET_LENGTH`（此前误用 `SECRET_TOO_WEAK`）
- `syncClockOffset(1.5)` 改报 `INVALID_CLOCK_OFFSET`（此前误用 `INVALID_WINDOW`）
- strict 单字符 secret 与宽松模式同码（`SECRET_TOO_SHORT`）
- epoch 0（1970-01-01）为合法时间戳
- `OTPAuthURI.parse` 的 `issuer=` 空 query 值按「未提供」处理，不再抹掉 label 里的合法 issuer
- `OTPAuthURI.build` / `toURI()` 不再漏原生 `URIError`：孤立代理字符收敛为 `INVALID_OTPAUTH_URI`
- label 分隔符按 ABNF（`:` / `%3A`）无条件识别，并剥离分隔符后的空格 padding（`*"%20"`）；
  此前依赖 query `issuer` 与前缀相等，规范的 `issuer%3Aaccount` 形态会丢 issuer
- provider 摘要长度必须与算法匹配（SHA1=20 / SHA256=32 / SHA512=64），不匹配统一 `CRYPTO_FAILED`；
  未知算法属「算法不被接受」，统一 `INVALID_ALGORITHM`（此前与摘要故障混用同一码）
- 随机源返回值校验：长度必须等于请求的 `bytes`；容器规则与 `Secret.fromBytes` **同源**
  （`core/internal/bytes.ts`）——`Uint8Array` / `Uint8ClampedArray` / `ArrayBuffer` 放行，
  其余容器或抛出非 `OtpError` 一律收敛为 `CRYPTO_FAILED`
- ohos `CryptoSource`：未知算法不再静默降级 SHA1，改抛 `INVALID_ALGORITHM`（与 pure-js provider
  对齐）；`toMacAlgName` 移到 `try` 外，避免被自身 catch 二次包裹
- 算法事实（名称集合 / 摘要长度 / HMAC 分块长度）收敛到 core 的 `internal/algorithm.ts` 单源，
  `toMacAlgName` 的算法集合由守卫脚本与 core 逐项对拍（**无行为变化**，纯内部收敛）

#### Compatibility

- 破坏性变更全部面向 1.x 消费方，逐条见上；最容易踩到的是 **存量 `otpauth://` URI 迁移**——1.x 在
  无 `account` 时产出的 URI 会被拒收，用存下来的 `secret` 重建并补 `account`（`issuer` 可选）即可
- 未变：全同步 API（`*Sync` 链路）、零运行时依赖、`OtpOptions` 字段名与可选性（仍只允许新增可选字段）、
  `compatibleSdkVersion 6.0.0(20)`、已发布错误码的字符串值（只新增不改旧）、`Secret` 脱敏与 `verify`
  恒定时间比对
- 发布物（HAR）除不再打包 `core/index.ts` 外，结构与对外入口（`Index.ets` / `Index.d.ets` /
  `example/README.md` / 四件套文档）保持不变
- 本地 Local Test 全绿；设备端 `ohosTest` 用例集合未减少（条数以 `scripts/ci/check-invariants.mjs` 的
  BASELINE 与 CI 输出为准），真实 crypto 路径需模拟器/真机执行

---

## 1.1.1 - 2026-11-12

> 仅内部架构与包元数据变更，**无 API / 行为变化**；消费方无需改动任何代码。

#### Changed

- 实现层迁移到 monorepo 共享 core（`packages/core` 为唯一源码，经 `bun run sync:core` 生成为 `library/src/main/ets/core/**`）；`Secret` / `HOTP` / `TOTP` / `OTPAuthURI` 与 `internal/*` 收敛为薄壳
- `OtpError` 改由 core 经错误工厂注入（`setErrorFactory` + `asOtpErrorCode`）：消费者仍收到同一个 `OtpError`，`code` 的 18 个枚举值与 `message`（固定为错误码字符串）逐字不变
- `oh-package.json5` 的 `repository` / `homepage` 指向 monorepo `github.com/yansongda/otp`（此前指向独立仓 `github.com/yansongda/ohos-otp`）

#### Compatibility

- 无破坏性变更：公开符号、DTO 字段名与可选性、错误码集合（18 个）、全同步 API、零运行时依赖全部保持
- 本地单测 266 条全绿；设备端 `ohosTest` 仍为 37/37

---

## 1.1.0 - 2026-10-26

> 新增**可选**严格 base32 解析（`{ strict: true }`）与错误码 `INVALID_BASE32_PADDING`；不传 `options` 时行为与 v1.0.x 逐字一致，单参调用无需改动。

#### Added

- `Secret.fromBase32(s, options?: ParseOptions)`：新增可选参数，`{ strict: true }` 时要求归一化后为规范 base32
- `OTPAuthURI.parse(uri, options?: ParseOptions)`：透传同一开关（只影响 `secret`，其余字段不变）
- 新错误码 `INVALID_BASE32_PADDING`：`OtpErrorCode` 17 → 18 个成员；仅 strict 模式抛出，其余 17 个取值逐字不变
- `ParseOptions` 接口（经 barrel 导出；缺省 / `{ strict: false }` = 原有宽松行为）
- 测试：RFC 4648 §10 base32 向量入库（`src/test/vectors/RfcVectors.ets`），新增 13 条用例（本地 252 → 265）

#### Changed

- `internal/Base32` 抽出 `normalize()`，`decode` / 新增的 `decodeStrict` 共用（归一化表达式一字未改，避免「规范形式」判据漂移）
- `scripts/ci/check-invariants.mjs` 错误码基线 17 → 18
- 文档：RFC 设计文档、README/README-cn（API 表、lenient vs strict 对照表、错误码表 18 行）、AGENTS.md、`example/README.md` 同步

#### Fixed / 安全说明

- strict 判据为「归一化后 `encode(decode(s)) === s`」，同时覆盖两类静默失真：尾长 ∉ `{0,2,4,5,7}`（结构性非法）与末字符填充位非 0（被截断/改写）。大小写、空白、尾部 `=` 仍被容忍
- 唯一的同输入不同码：`'A'` 宽松抛 `SECRET_TOO_SHORT`，strict 抛 `INVALID_BASE32_PADDING`（已在 README 与用例中锁定）

#### Compatibility

- 无破坏性变更：新增可选参数、可选接口与新错误码；消费方按 `e.code` 分支时落入 `default` 即可

---

## 1.0.2 - 2026-10-05

> 仅打包与元数据变更，**无源码 / API 行为变化**；本版用于补齐 OHPM 包质量分的两个失分项。

#### Added

- `example/README.md`：随 HAR 一起分发的用法示例（TOTP 校验闭环、HOTP 计数器持久化、`otpauth://` URI、错误码分支）。hvigor 对 bytecode HAR 的 release 白名单目录恰好名为 `example`，因此该目录会原样进入包内 `package/example/`
- `oh-package.json5` 新增 `homepage` 字段（与 `repository` 同址）

#### Changed

- HAR 文件数 26 → 27（新增 `package/example/README.md`），压缩后体积 31 805 → 34 133 字节（+2.3 KB）
- 无公开签名、选项字段、错误码变化；`Secret` 脱敏与恒定时间比对等既有不变量不变

---

## 1.0.1 - 2026-10-05

> 升级提示：本版把**非法入参**从「静默返回 `null` / 穿透到 crypto 层」收紧为显式抛错（未新增错误码、未改公开签名与选项字段），合法入参行为不变。

#### Fixed

- `TOTP.syncClockOffset` 校准方向修正：公式由 `clockOffsetMs -= delta * period * 1000` 改为 `+=`，使「verify → syncClockOffset(返回的 delta) → verify(window=0) 命中 delta=0」闭环成立（与 RFC 6238 §6 resync 方向一致；配套闭环不变量用例）

#### Changed

- 构造期校验 `algorithm`（非法值抛 `INVALID_ALGORITHM`，此前穿透到 crypto 层抛 `CRYPTO_FAILED`）
- `verify` 入口（HOTP/TOTP 共享引擎）的 counter 非法（负数 / 超 2^53-1）抛 `INVALID_COUNTER`（此前静默返回 null）；因引擎为两者共用，`TOTP.verify` 在 `t0` 取大值 / 极小 timestamp / 负 offset 使计算 counter 为负时同样抛出
- `OTPAuthURI.build` 对 `secret` 先做 base32 规范化（大写无填充；非法字符抛 `INVALID_BASE32_CHAR`），与 `parse` 对称

---

## 1.0.0 - 2026-10-01

### Added

- RFC 4226 HOTP / RFC 6238 TOTP 完整实现（SHA1/SHA256/SHA512，6/7/8 位验证码）
- `verify` 漂移窗口校验（`VerifyOptions.window`）与 `syncClockOffset` 时钟偏移校准（`clockOffsetMs` getter）
- `Secret` 规范化（fromBase32 / fromBytes）、随机生成（generate，默认 20 字节）、强度自省（bytes / byteLength / bitLength）与序列化脱敏（`toJSON()` 返回 `'[REDACTED]'`）
- `otpauth://` URI 解析与生成（`OTPAuthURI.parse` / `OTPAuthURI.build`），`TOTP.fromURI` / `HOTP.fromURI`
- 统一错误模型 `OtpError`（`extends Error`，`readonly code: OtpErrorCode`，17 个字符串错误码）
- `OtpAlgorithm` / `OtpType` 枚举与全部选项类型（`HmacOptions` / `TotpOptions` / `HotpOptions` / `VerifyOptions` / `OtpAuthParams`）
- 全同步 API、恒定时间 token 比对、kit-free 分层（本地单测可覆盖全链路）
- 通过 RFC 4226 Appendix D（10 条）与 RFC 6238 Appendix B（18 条）全量官方向量

### Changed

- 明确「RFC 4226 §7.3 throttling 由校验服务端实现，本库不提供」的边界
- 明确兼容性要求：`compatibleSdkVersion >= 6.0.0(20)`
