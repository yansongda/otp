# otp 库设计文档（monorepo）

> **更新时间**：2026-11-19（按 `packages/core` 当前源码与三端 barrel 重写）
> **状态**：现行设计文档。**代码即契约**：本文件与源码冲突时以源码为准，请同步修正本文件。
> **范围**：`@yansongda/miniprogram-otp`（npm）、`@yansongda/otp`（ohpm HAR）、内部包 `@yansongda/otp-core`。
> **非 RFC 声明**：`otpauth://` scheme 没有任何 RFC；权威文本是 Google 的
> [Key URI Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format)（IANA 仅把该 scheme
> 注册为 provisional，CRI Scheme Number 13829，注册内容只是指向该 wiki），外加 IETF 个人稿
> `draft-andesco-otpauth-uri-01`（2026-10-30，非 RFC）。RFC 4226/6238 只定义 HOTP/TOTP 算法本身。

---

## 1. 背景与目标

**背景**：旧 MFA 元服务的端内算码实现内嵌在元服务 `entry` 模块——单文件、仅 TOTP + SHA1 + 6 位、只有「生成」没有「校验」、顶层 import 系统 kit 导致 PC 不可测、无 README/CHANGELOG/LICENSE 因而不是可分发的库形态；微信端另 vendor 了一份第三方实现，语义漂移无人守。本仓库把该能力抽成**一份实现 + 多端薄壳**。

**目标**

- **规范对齐**：RFC 4226 / RFC 6238 能力完整，两 RFC 附录官方向量 100% 通过
- **单一实现**：算法/门面/URI/错误码只在 `packages/core` 写一遍；平台包不含算法代码
- **零运行时依赖**：core 无 `dependencies`；ohos 只允许系统 `@kit.CryptoArchitectureKit`；mp 无任何依赖
- **可测**：核心算法在 PC 上全量单测（ohos 侧 `src/test` 不需要设备；mp 侧用纯 JS HMAC）
- **绝不外泄**：无日志、无上报、异常消息不含 secret、`JSON.stringify` 自动脱敏
- **fail-closed**：一切非法输入、跨边界非字符串、静默降级路径都收敛为明确的 `OtpError` 错误码

---

## 2. 仓库形态与分层

```
otp/                                  monorepo（bun workspaces）
├── packages/core/                    唯一实现源码（私有包，不发布）
│   ├── src/{errors,crypto,options,secret,hotp,totp,otpauth-uri}.ts
│   ├── src/internal/{base32,counter,digits,engine,resolve,time-step,truncate}.ts
│   ├── src/pure-js.ts + src/pure-js/{pure-js-hmac,hmac,sha1,sha256,sha512}.ts   仅 mp 引用
│   └── tests/                        协议/边界/URI 全套
├── packages/miniprogram-otp/         发 npm：@yansongda/miniprogram-otp
│   ├── src/index.ts                  barrel：注册纯 JS HMAC + 错误工厂 + 类型桥
│   ├── src/{types,errors}.ts         平台类型层 / 平台 OtpError（字面量联合码）
│   ├── dist/                         tsdown 产物（commonjs，`miniprogram: dist`）
│   └── scripts/ci/                   守卫 + dist smoke
├── packages/ohos-otp/library/        发 ohpm：@yansongda/otp（HAR）
│   ├── Index.ets                     唯一 barrel：注册 crypto + 错误工厂 + 导出
│   ├── src/main/ets/{HOTP,TOTP,Secret,OTPAuthURI}.ets
│   ├── src/main/ets/{OtpOptions,OtpError}.ets            平台类型层（ArkTS enum）
│   ├── src/main/ets/internal/*.ets   ArkTS 薄壳：Base32/Counter/Digits/Truncate/TimeStep/
│   │                                 OtpEngine/HmacProvider + CryptoSource（唯一 @kit 导入点）
│   └── src/main/ets/core/**          **生成副本**（`bun run sync:core`，禁止手改）
├── scripts/{sync-core.mjs,bench/}    同步校验 + 热路径基准
└── docs/                             本文件
```

### 2.1 不变量（CI 强制）

| 不变量 | 落地方式 |
| --- | --- |
| core 是唯一实现 | 算法/门面/URI/错误码只改 core；平台包内复制实现视为缺陷 |
| 错误跨层靠工厂 | core 只 `otpFail(code)`；平台 barrel 调 `setErrorFactory`，公开 `OtpError` 由平台拥有 |
| ohos 副本禁止手改 | `bun run sync:core` 生成 15 个文件；CI 跑 `sync:core:check`，drift 即失败 |
| pure-js 不进 ohos 编译图 | ohos 只 import `core/src/index`（barrel 刻意不导出 `./pure-js`） |
| ohos 唯一 `@kit` 导入点 | `internal/CryptoSource.ets`；`guard.yml` + 守卫脚本扫描 |
| 跨边界签名只用基础类型 | ArkTS 不支持字面量类型 / `as const`：core 的 `type`/`algorithm` 是 `string`，平台层才收窄成 enum |
| 平台层不抄码表 | `OtpErrorCode` 取值由 core barrel 提供；平台守卫逐项对拍 |
| 零运行时依赖 | mp `dependencies: {}`；ohos `dependencies: {}` |

### 2.2 平台层各自做什么

| 平台 | 注册 crypto | 注册错误工厂 | 类型层 | 未注册时的降级 |
| --- | --- | --- | --- | --- |
| core（测试） | 由用例注入 fixture / 纯 JS | 默认 core 内部类 | 宽类型 | `CRYPTO_NOT_INITIALIZED` |
| miniprogram | `installPureJsHmac()`（无同步 WebCrypto） | `OtpError(code as OtpErrorCode, code)` | `OtpType`/`OtpAlgorithm` 字面量联合 | `Secret.generate` 需宿主先 `registerRandom` |
| ohos | `installCryptoDefaults()`（cryptoFramework） | `OtpError(asOtpErrorCode(code), code, code)` | `enum OtpErrorCode` / `enum OtpAlgorithm` | 深路径导入 → `CRYPTO_NOT_INITIALIZED` |

---

## 3. 架构

### 3.1 生成一个码的数据流

```
secret(base32 字符串)
  → Secret 规范化（去空白/填充、转大写、字符合法性校验）→ bytes
  → Counter.toBytes(counter)   8 字节大端（high/low 拆分，规避 32 位位运算溢出）
  → HmacProvider.sign(SHAx, keyBytes, counterBytes) → digest
  → Truncate.apply(digest)     RFC 4226 §5.3 动态截断 → 31 位非负整数
  → Digits.format(v, digits)   v mod 10^digits + 左补零 → code
```

### 3.2 为什么 ohos 包需要 kit-free 解耦层

ArkTS/ESM 的 `import` 是静态且传递的：公开类若在顶层从「含 `@kit` 导入的文件」值导入任何符号，加载该文件就会连带加载系统 kit；而官方文档明确「本地测试不支持系统 API」，这会让 `src/test` 在**模块加载期**整体失败（不是个别用例失败）。因此：

- `internal/HmacProvider.ets`（接口 + 注册表）**绝不 import kit**，公开类与 `Secret` 只依赖它；
- `internal/CryptoSource.ets` 是**全库唯一** `@kit.CryptoArchitectureKit` 导入点，只被 `Index.ets` 值导入；
- `installCryptoDefaults()` 只 `new` 实现类并注册，**不发起任何 crypto 调用**，因此 barrel 导入期不会失败。

### 3.3 已确认的性能结论（别再重复试）

- **不缓存 `Mac` / `SymKey`**：缓存可把单次签名从 6.6µs 降到 2.9µs，但 `SymKey.release()` 在 API 24 公开类型里不存在（只能等 GC），且复用 `Mac` 每次必须 `initSync`——省掉会**静默算错 digest**。收益不抵代价。
- **不要用内联微基准决策**：本库模块间全部跨模块导入，跨模块解释器开销（~11–13µs/次）远大于函数体本身。曾经把 base32 解码改成单遍位缓冲：内联基准快 67%，真实调用路径反而慢 10%+，已回退。唯一有效的方法是 `bun run bench` / `bun run bench:ab`（同进程交错测量、min-of-7、17 个热路径场景 + 2 个 URI 冷路径场景）。
- **provider 契约校验留在热路径没问题**：engine 每次 `sign` 的 try/catch + `instanceof` + 摘要长度比对，用零成本 stub provider 隔离测得 ~7ns/次（`generate` 35→44ns、`verify w=2` 274→304ns）；相对 pure-js SHA1 HMAC 3.1µs / ohos 平台签名 2.9–6.6µs 是 +0.2% 量级，`bench:ab` 17 个场景全部 same。不要再为它加缓存或把校验挪到注册期（注册期自检挡不住后续违约）。

### 3.4 同步 API

全部走 `*Sync`（ohos：`convertKeySync`/`initSync`/`updateSync`/`doFinalSync`/`generateRandomSync`）。8 字节 HMAC 是微秒级计算，避免 Promise 传染与竞态。

### 3.5 provider 契约（`HmacProvider` / `RandomSource`）

平台实现（mp 的 pure-js、ohos 的 `CryptoSource`）与自定义 provider 必须同时满足：

| 项 | 契约 | 违约结果 |
| --- | --- | --- |
| 失败表达 | 抛 `name === "OtpError"` 的错误（core `otpFail` / 平台 `OtpError`） | 其余任何值（`TypeError`、字符串、`null`…）→ `CRYPTO_FAILED`；`OtpError` 原样上抛（保留精确码） |
| `sign` 返回值 | `Uint8Array`，长度 = 算法摘要长度（SHA1=20 / SHA256=32 / SHA512=64，见 `internal/digest.ts`） | 非法类型 / 长度不匹配 → `CRYPTO_FAILED`（engine 只认 `Uint8Array`，不复用 `Secret` 侧的宽容器判定） |
| `random` 返回值 | 同步返回，长度 = 请求的 `bytes`；容器按 `internal/bytes.ts`（`Uint8Array` / `Uint8ClampedArray` / `ArrayBuffer`） | 类型 / 长度不符 → `CRYPTO_FAILED` |
| 入参 | `key` / `message` **只读**：不得修改、`fill`、跨调用保留引用 | 无错误码可诊断（表现为「码不对」）：库每次公开调用传一份密钥临时副本，同一次调用的窗口扫描复用该副本 |
| 错误收敛 | 收敛时不保留原因（无 `cause`、不打日志） | 要保留精确码必须自己抛 `OtpError` |

已知限制：`sign` 的返回值判定用 `instanceof Uint8Array`，跨 realm（Worker / 独立 JS 上下文）返回的 typed array 会被判违约。

---

## 4. 公共 API 契约

### 4.1 选项类型（字段冻结，只允许新增可选字段）

| 类型 | 字段（`?` = 可选） | 默认值 |
| --- | --- | --- |
| `HmacOptions` | `secret: string`（必填，base32，宽松解析） | — |
| | `algorithm?` | `SHA1` |
| | `digits?`（6/7/8） | `6` |
| | `minSecretBits?` | `0`（不强制） |
| `TotpOptions extends HmacOptions` | `period?`（秒，正安全整数） | `30` |
| | `t0?`（秒，非负安全整数） | `0` |
| | `clockOffsetMs?`（安全整数，仅 TOTP） | `0` |
| | `issuer?` / `account?`（仅 `toURI()` 使用） | 空（`account` 序列化时必填） |
| `HotpOptions extends HmacOptions` | `counter?`（非负安全整数） | `0` |
| | `issuer?` / `account?` | 同上 |
| `TotpVerifyOptions` | `timestamp?`（epoch ms，非负安全整数） | `Date.now()` |
| | `window?`（步，`[0, MAX_VERIFY_WINDOW]`） | `0` |
| `HotpVerifyOptions` | `counter?`（非负安全整数） | 构造时的 counter |
| | `window?` | `0` |
| `VerifyOptions` | 兼容超集（`timestamp?` + `counter?` + `window?`），新代码请用上面两个 | — |
| `ParseOptions` | `strict?: boolean`（`Secret.fromBase32` / `OTPAuthURI.parse` 共用） | 宽松 |
| `OtpAuthParams` | `type`、`secret`、`algorithm`、`digits`、**`account: string`** 必填；`issuer?`、`period?`/`counter?`、`label?` | 见 §6 |

> `period`/`counter` 按 `type` 判别，但**不**建模为判别联合：ArkTS 不支持字面量类型，跨 `core ↔ .ets` 边界的公开签名只能用基础类型。

### 4.2 类与方法

| API | 语义 | 规范依据 |
| --- | --- | --- |
| `new TOTP(options, provider?)` | 构造；同步校验，非法即抛 `OtpError`；`provider` 仅供库内测试注入 | — |
| `totp.generate(timestampMs?)` | `digits` 位零填充验证码 | RFC 6238 §4.2 |
| `totp.verify(token, options?)` | 恒定时间比对；返回命中窗口相对偏移（0 = 当前步，-1 = 上一步），未命中 `null` | RFC 6238 §5.2/§6 |
| `totp.remaining(ts?)` / `totp.progress(ts?)` | 剩余整秒 `[1, period]` / 窗口进度 `[0, 1)` | — |
| `totp.syncClockOffset(delta)` | `clockOffsetMs += delta * period * 1000`（delta = 码源 counter − 本地 counter） | RFC 6238 §6 |
| `totp.clockOffsetMs` | 当前偏移 | — |
| `TOTP.fromURI(uri)` / `totp.toURI()` | URI 往返（`toURI()` 需要 `account`，否则 `INVALID_OTPAUTH_URI`） | §6 |
| `new HOTP(options, provider?)` / `hotp.generate(counter?)` / `hotp.verify(token, options?)` | 同上（`counter` 为 URI 必填参数） | RFC 4226 §5.3/§7.4 |
| `HOTP.fromURI(uri)` / `hotp.toURI()` | 同上 | §6 |
| `Secret.fromBase32(s, options?)` / `.fromBytes(u8 \| u8c \| ArrayBuffer)` / `.generate(bytes = 20)` | 规范化 / 构造（拷贝语义）/ 随机生成 | RFC 4226 §4 R6 |
| `secret.toBase32()` / `.bytes` / `.byteLength` / `.bitLength` / `.toJSON()` | 规范化输出 / 强度自省 / 序列化脱敏 | — |
| `OTPAuthURI.parse(uri, options?)` / `.build(params)` | 纯解析 / 生成（见 §6） | §6 |
| `OtpAlgorithm` / `OtpType` | core 导出字符串常量；mp 用字面量联合、ohos 用 enum | — |
| `OtpErrorCode` / `OtpError` / `MAX_VERIFY_WINDOW` | 22 码表 / 平台错误类 / 窗口上限 10 | §7 |

### 4.3 关键 API 决策

1. **`verify` 返回 delta 而非 boolean**：布尔无法支撑时钟偏移估算，delta 是 `boolean + 校准量` 的超集。
2. **`verify` 默认 `window = 0`（严格）**：默认严格 = 默认安全；服务端型用法显式传 `window: 1`（RFC 6238 §5.2 允许 1 步网络延迟）。**窗口上限 `MAX_VERIFY_WINDOW = 10`**：把外部传入的 window 从 HMAC 计算炸弹收敛为可预期的小常数（至多 21 次 HMAC）；更宽的跨度请自行遍历 counter 调 `verify(window: 0)`。
3. **`Secret.toJSON()` 返回 `'[REDACTED]'`**：`private` 只是编译期约束，`_bytes` 是可枚举自有属性，宿主 `JSON.stringify(secret)` 会泄漏密钥；同时刻意不实现 `toString()`。
4. **`minSecretBits` 默认 0**：真实后端 secret 常见 80bit（`JBSWY3DPEHPK3PXP`），强制 RFC 4226 §4 R6 的 128bit 会误伤存量账户；只暴露 `bitLength` 让调用方自决策。
5. **所有时间/计数参数要求安全整数**：小数 / `NaN` / 超大值不再「能跑但结果无意义」，构造期或入口即抛对应错误码（`period` → `INVALID_PERIOD`、`t0` → `INVALID_T0`、`timestamp` → `INVALID_TIMESTAMP`、`clockOffsetMs` → `INVALID_CLOCK_OFFSET`）。
6. **`strict` fail-closed**：只有未提供或明确 `false` 才是宽松模式；`{ strict: 1 }` / `{ strict: "true" }`（服务端 JSON 传参常见）按 strict 处理。

---

## 5. 算法设计与 RFC 对应

```
counter  = floor((floor(epochMs/1000) - t0) / period)   # RFC 6238 §4.2，t0 单位秒，缺省 0
bytes    = uint64_be(counter)                           # 8 字节大端
digest   = HMAC(alg, secretBytes, bytes)                # RFC 4226 §5.3 Step 1
offset   = digest[last] & 0x0f                          # 动态截断
v        = (digest[offset] & 0x7f) << 24 | ...          # 31 位非负，屏蔽最高位
code     = (v mod 10^digits) 左补零至 digits 位          # §5.3 Step 3
```

| RFC 要求 | 出处 | 实现点 |
| --- | --- | --- |
| HMAC 摘要长度 / 分块长度 | RFC 2104 §2、各 SHA 规范 | `internal/algorithm.ts` **单源**（digestLength 20/32/64、blockSize 64/64/128）；engine 按此校验 provider 返回值长度，pure-js 与 ohos 映射分别由单测与守卫对拍 |
| secret ≥ 128bit，推荐 160bit | RFC 4226 §4 R6 | `Secret.bitLength` + 可选 `minSecretBits`（默认不强制） |
| 最少 6 位，可能 7/8 位 | RFC 4226 §5.3 | `options.ts` 的 `ALLOWED_DIGITS` **单源**：`isValidDigits` 由它驱动、`digits.ts` 的 `10^n` 表必须覆盖它的每个成员（`digits.test.ts::allowedDigits_singleSource` 对拍） |
| 动态截断屏蔽最高位 | RFC 4226 §5.3 | `truncate.ts` 的 `& 0x7f` |
| 必须支持 T 超过 32 位 | RFC 6238 §4.2 | `counter.ts` high/low 拆分（不得用 `<<` 拼 32 位：ArkTS 位运算是 32 位有符号） |
| 默认步长 30s / 默认 SHA1 | RFC 6238 §5.2/§1.2 | `DEFAULT_PERIOD = 30`、`DEFAULT_ALGORITHM = "SHA1"` |
| 最多 1 步网络延迟 | RFC 6238 §5.2 | `window` 参数（默认 0，上限 10） |
| 校验侧限制漂移并记录 | RFC 6238 §6 | `verify` 返回 delta + `syncClockOffset` |
| Throttling（失败退避/锁定） | RFC 4226 §7.3 | **不实现**：需要跨会话服务端状态 |

**恒定时间比较**：`time-step.ts` 的 `constantTimeEquals` 逐字符异或累加、不早退；`verify` 在整个 window 内**扫完所有候选**（每个候选都算 HMAC、都比对）后再返回结果，避免用提前返回泄漏「命中了第几个窗口」。

**`remaining` / `progress`**（`t0` 偏移与负值归一化必须有 `t0≠0` 用例锁定）：

```
s = floor(epochMs / 1000)
remaining = period - (((s - t0) % period) + period) % period   # [1, period]
progress  = (((s - t0) % period) + period) % period / period   # [0, 1)
```

**窗口语义**：TOTP 单位是时间步、HOTP 单位是步（=1 counter）；候选 counter < 0 直接跳过（epoch 之前无定义，不报错）；返回值是相对偏移。

**多重命中时的 tie-break（必须显式且可测）**：扫描顺序按 `|delta|` 递增（`0, -1, +1, -2, +2 …`），返回**第一个**命中，即「最接近基准步」的偏移；同一 `|delta|` 的 `-k` / `+k` 同时命中时取负方向。仍然逐个候选计算与比对（不早退），所以恒定时间性质不变。

为什么不按「`-window` 起递增扫、首个命中为准」：多个候选同时命中的概率虽只有 ~`window/10^digits`，但按最负偏移返回会让调用方把 counter **往回推**（HOTP 常见写法 `counter = base + delta + 1`），等于重新放行更早的验证码；同距离优先负方向是保留旧行为（先看过期一侧）。

**counter 上限**：RFC 4226 的 counter 是 64 位，`number` 精确整数上限 2^53-1；2^53-1 步 × 30s ≈ 8.5×10⁹ 年，实践中不可达，故不做 BigInt，超限抛 `INVALID_COUNTER`。RFC 6238 §4.2 的「T 超 32 位」由 timestamp 路径满足（官方向量含 T=20000000000）。

---

## 6. otpauth URI 规则

`otpauth://TYPE/LABEL?PARAMETERS`，`TYPE ∈ {totp, hotp}`（大小写不敏感）。

### 6.1 label 语义（parse 与 build 同口径）

规范文本：Google Key URI Format，`label = accountname / issuer (":" / "%3A") *"%20" accountname`，
明文「Neither issuer nor account name may themselves contain a colon」。`draft-andesco-otpauth-uri-01`
把 consumer 规则写死为（§3.1）「先按**原始串**首个 `:` / `%3A` 切分，再逐段百分号解码」。

- **切分**：在原始串上定位首个 `:` 或 `%3A`（十六进制大小写不敏感）为分隔符；其后紧邻的空格与
  `%20` 都是 padding（`*"%20"`）。无分隔符时整段就是 account。判定与 query 里有没有 `issuer` 无关；
  `issuer` 参数仍作为取值优先（草案 §4：issuer 参数是账号匹配的权威来源，前缀只用于展示；
  consumer MUST NOT 仅因两个值不同就拒收）。
- **两侧 fail-closed**（保证不变量 `build(parse(uri))` 恒不抛错）：

  | 条件 | 错误码 |
  | --- | --- |
  | `account` 缺失 / 为空（`otpauth://totp/?…`、`ACME:?…`、`ACME:%20?…`） | `INVALID_OTPAUTH_URI` |
  | `account` 含冒号（分隔符切完之后残余的冒号必然落在 account 里） | `INVALID_OTPAUTH_URI` |
  | label 段不可百分号编码（孤立代理字符） | `INVALID_OTPAUTH_URI` |
  | 已知 query 参数重复（`secret`/`issuer`/`algorithm`/`digits`/`period`/`counter`，键名大小写不敏感） | `INVALID_OTPAUTH_URI` |
  | `issuer` / `account` 非字符串（JS / JSON 调用方） | `INVALID_OTPAUTH_URI` |

- **label 前缀可省略**：`issuer` 含冒号（issuer **参数**是 RFC 3986 `pchar`，允许冒号；label 前缀
  不允许），或 `account` 以空格开头（前缀形态下会被当 padding 剥掉）时，`build` 只写 `issuer=`
  参数、不写 label 前缀。省略的是**可选**装饰，语义无损（`parse` 仍从 `issuer=` 取值）。
- **已知偏离（宽容超集，README 同步标注）**：分隔符后的**原始空格**也按 padding 剥离。ABNF 只写
  `%20`，而原始空格本身不是合法 URI 字符；真实签发方确实会这么写，故容忍。
- `params.label` 是 `parse` 回填的**整体解码结果**，仅供展示：它不保证能反推出 issuer/account。

### 6.2 query 参数

| 字段 | 缺省 | 非法处理 |
| --- | --- | --- |
| `type` | — | 非 `totp`/`hotp` → `UNSUPPORTED_OTPAUTH_TYPE` |
| `secret` | — | 缺失/空 → `EMPTY_SECRET`；非法字符 → `INVALID_BASE32_CHAR`；不足 1 字节 → `SECRET_TOO_SHORT`；`{strict:true}` 非规范尾 → `INVALID_BASE32_PADDING` |
| `issuer` | 空 | 与 label 前缀不一致时**以 query 为准**（草案 §4：MUST NOT 仅因不一致拒收）；空值按「未提供」处理 |
| `algorithm` | `SHA1` | 大小写不敏感映射；非三值 → `INVALID_ALGORITHM` |
| `digits` | `6` | 只认纯十进制；非 6/7/8 → `INVALID_DIGITS`（6/7/8 取自草案 §3.1 的 `digits` 产生式；Google wiki 只列 6/8，取宽容超集） |
| `period` | `30`（仅 totp） | 只认纯十进制正整数 → `INVALID_PERIOD` |
| `counter` | `0`（仅 hotp，规范要求必填） | 只认纯十进制非负安全整数 → `INVALID_COUNTER` |
| 未知参数 | — | **忽略**（草案 §3.4.7：SHOULD ignore）；重复的未知参数同样忽略 |

`digits` / `period` / `counter` 刻意不用 `Number()`：`Number("0x7") === 7`、`Number("1e3") === 1000`，会把扫码导入边界变成宽松解析。

> 实现注意：`period` 会改变 counter 取值——`fromURI` 带 `period=60` 时 `generate(59000)` 的 counter 是 `floor(59/60)=0`，不是 1。

---

## 7. 错误模型

`OtpErrorCode` 共 **22** 个成员（取值只增不改，冻结）：

```
EMPTY_SECRET            INVALID_SECRET_CONTAINER  INVALID_BASE32_CHAR    INVALID_BASE32_PADDING
SECRET_TOO_SHORT        SECRET_TOO_WEAK           INVALID_SECRET_LENGTH  INVALID_MIN_SECRET_BITS
INVALID_ALGORITHM       INVALID_DIGITS            INVALID_PERIOD         INVALID_T0
INVALID_COUNTER         INVALID_TIMESTAMP         INVALID_CLOCK_OFFSET   INVALID_WINDOW
INVALID_TOKEN           CRYPTO_FAILED             CRYPTO_NOT_INITIALIZED INVALID_OTPAUTH_URI
UNSUPPORTED_OTPAUTH_TYPE NOT_IMPLEMENTED
```

**跨层结构**：core 只 `otpFail(code)`；平台 barrel 用 `setErrorFactory` 注入平台类，因此调用方拿到的
永远是**平台** `OtpError`（`instanceof` 成立）。平台类同时提供 `code`（强类型）与 `codeString`
（原始字符串，未来新增码在平台枚举未同步时仍可拿到真实值）。`NOT_IMPLEMENTED` 是从不抛出的兜底。

**优先级**（同一调用命中多个校验时，按各入口固定顺序返回第一个）：

| 入口 | 顺序 |
| --- | --- |
| 构造 TOTP | secret 解析 → `INVALID_ALGORITHM` → `INVALID_DIGITS` → `INVALID_MIN_SECRET_BITS` → `SECRET_TOO_WEAK` → `INVALID_PERIOD` → `INVALID_T0` → `INVALID_CLOCK_OFFSET` |
| 构造 HOTP | secret 解析 → `INVALID_ALGORITHM` → `INVALID_DIGITS` → `INVALID_MIN_SECRET_BITS` → `SECRET_TOO_WEAK` → `INVALID_COUNTER` |
| URI parse | 入参非字符串 / 前缀非法 → `UNSUPPORTED_OTPAUTH_TYPE` → 已知参数重复 → secret 解析 → `INVALID_ALGORITHM` → `INVALID_DIGITS` → `INVALID_PERIOD` \| `INVALID_COUNTER` → label 段（account 缺失 / 为空 / 含冒号 / 不可编码） |
| URI build | `UNSUPPORTED_OTPAUTH_TYPE` → `INVALID_SECRET_CONTAINER` → secret 解析 → `INVALID_ALGORITHM` → `INVALID_DIGITS` → `INVALID_OTPAUTH_URI`（account 缺失 / 为空 / 含冒号；issuer·account 非字符串 / 不可编码）→ `INVALID_PERIOD` \| `INVALID_COUNTER` |
| verify | `INVALID_TIMESTAMP`（仅 TOTP 显式 timestamp）→ `INVALID_CLOCK_OFFSET` → `INVALID_COUNTER` → `INVALID_WINDOW` → `INVALID_TOKEN` |

两个原则：**配置/构造期错误先于用户输入错误**；**每个已知失败原因独立码**，禁止合并。

**不泄漏**：异常消息固定文案，不含 secret / token / 派生密钥；`CRYPTO_FAILED` 不透传原生错误对象；库内零 hilog / 零日志 / 零上报 / 零持久化。

---

## 8. 测试与验证

| 项 | 命令 | 当前结果 |
| --- | --- | --- |
| core 全量 | `bun run --filter '@yansongda/otp-core' test` | 全绿（含 RFC 向量、URI 边界、往返不变量、`@ts-expect-error` 类型契约） |
| mp 平台契约 | `bun run --filter '@yansongda/miniprogram-otp' test` | 全绿（1 文件） |
| 一键检查 | `bun run check` | `sync:core:check` + lint + typecheck + 上面两项 |
| mp 守卫 | `node packages/miniprogram-otp/scripts/ci/check-invariants.mjs` | 22/22 |
| ohos 守卫 | `node packages/ohos-otp/scripts/ci/check-invariants.mjs` | 14/14 |
| ohos 本地单测 | `hvigorw test --mode module -p module=library@default -p testType=local` | 全绿（kit-free 全链路 + fixture） |
| ohos 设备用例 | `ohosTest`（真实 cryptoFramework + barrel 链路） | 全绿 |
| 基准 | `bun run bench` / `bun run bench:ab` | 17 热路径场景 + `OTPAuthURI.parse/build` 冷路径场景 |

> 用例条数刻意不写进文档（易腐坏）：以各命令的实测输出为准；ohos 守卫的 BASELINE 负责「数量不减少」。

**ohos 覆盖边界（实测结论）**：Local Test 运行在 PC 本地 Simulator，**可以 import 并可构造** cryptoFramework 对象，但 `doFinalSync()` 返回空 DataBlob（`len=0`）——本地 crypto 计算不可用。因此 `src/test` 只覆盖 kit-free 全链路（注入 `HmacFixture`/`RandomFixture`，模块图内**不存在** `CryptoSource.ets`），真实 crypto 由 `src/ohosTest` 设备用例兜底。

---

## 9. 风险与已知限制

| 风险 / 限制 | 严重度 | 现状与对策 |
| --- | --- | --- |
| 静态导入传递性使「公开类 PC 可测」失效 | 高 | kit-free 接口层 + 注册表 + kit-only 实现层分离；只有 `CryptoSource.ets` 可 `@kit`（守卫扫描） |
| Local Test 不支持系统 API | 中 | `src/test` 只覆盖 kit-free 全链路；真实适配器由 `ohosTest` 兜底；README 声明覆盖边界 |
| 存量 secret 仅 80bit | 中 | `minSecretBits` 默认 0，只暴露 `bitLength` |
| `Secret` 被 `JSON.stringify` 泄漏 | 高 | `toJSON()` 返回 `'[REDACTED]'` + 用例断言；README 明示 |
| `compatibleSdkVersion = 6.0.0(20)`，API 12–19 工程无法消费 | 中 | README 顶部声明；放宽需另开任务 |
| 与后端/微信端语义漂移 | 中 | 默认值对齐三方共识（SHA1/6/30）；RFC 向量跨端一致性用例固定 |
| `no-unsafe-mac` lint 告警（HMAC-SHA1） | 低 | 接受告警、不放宽规则、不加 disable；README 引用 RFC 6238 §1.2 |
| otpauth label 的原始空格宽容 | 低 | 已在 README「已知偏离」标注；`build` 侧不产生原始空格 |
| 发布后同版本不可覆盖 | 中 | 发布前 `ohpm prepublish` / `npm pack --dry-run` 预检；同版本一次性占用 |

---

## 10. 发布与版本

| 包 | tag | 触发 | 动作 |
| --- | --- | --- | --- |
| `@yansongda/miniprogram-otp` | `miniprogram-vX.Y.Z` | `.github/workflows/release-miniprogram.yml` | OIDC `npm publish`（版本已存在则跳过） |
| `@yansongda/otp`（ohos HAR） | `ohos-vX.Y.Z` | 人工 | `ohpm publish`（人工闸门，不经 CI） |

- CI：`ci.yml`（core + mp，ubuntu，含 `sync:core:check`）、`ohos.yml`（macos-15 + 华为 CLI，路径过滤）、`guard.yml`（ohos 不变量，秒级）。
- 版本号唯一来源：`packages/miniprogram-otp/package.json` / `packages/ohos-otp/library/oh-package.json5`；守卫会校验与 CHANGELOG 首条一致。
- `git push` / `npm publish` / `ohpm publish` 一律需人工明确授权；不允许自动合并 PR。

---

## 11. 不做清单（Must NOT）

- 不做 UI / ArkUI 组件、不做二维码渲染与扫码（只产出 `otpauth://` 字符串）
- 不实现 RFC 4226 §7.3 throttling（服务端职责）
- 不支持 Steam Guard（非 RFC）、SHA224/SHA384/SM3（RFC 6238 §1.2 未列）
- 不引入运行时依赖（含 `@ohos/crypto-js` 等第三方算法库，测试期也不引入）
- 不做 BigInt / 64 位 counter 全量支持
- 库内不打日志、不上报、不持久化、不缓存 secret 到磁盘
- 不在平台包内复制算法实现；不手改 `packages/ohos-otp/library/src/main/ets/core/**`
- 不执行 `ohpm publish` / `git push` / 创建 git remote（人工闸门）
- 不自动合并 PR

---

## 附录 A：RFC 官方向量

**RFC 6238 Appendix B**（`X=30`，`T0=0`，**digits=8**；⚠️ 三种算法 seed 长度不同）

| T(s) | counter | SHA1（seed 20B `12345678901234567890`） | SHA256（32B `…9012`） | SHA512（64B `…01234`） |
| --- | --- | --- | --- | --- |
| 59 | 1 | 94287082 | 46119246 | 90693936 |
| 1111111109 | 37037036 | 07081804 | 68084774 | 25091201 |
| 1111111111 | 37037037 | 14050471 | 67062674 | 99943326 |
| 1234567890 | 41152263 | 89005924 | 91819424 | 93441116 |
| 2000000000 | 66666666 | 69279037 | 90698825 | 38618901 |
| 20000000000 | 666666666 | 65353130 | 77737706 | 47863826 |

**RFC 4226 Appendix D**（seed = ASCII `12345678901234567890` = base32 `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`，**digits=6**）

| counter | HMAC-SHA1 digest（黄金 fixture） | code |
| --- | --- | --- |
| 0 | `cc93cf18508d94934c64b65d8ba7667fb7cde4b0` | 755224 |
| 1 | `75a48a19d4cbe100644e8ac1397eea747a2d33ab` | 287082 |
| 2 | `0bacb7fa082fef30782211938bc1c5e70416ff44` | 359152 |
| 3 | `66c28227d03a2d5529262ff016a1e6ef76557ece` | 969429 |
| 4 | `a904c900a64b35909874b33e61c5938a8e15ed1c` | 338314 |
| 5 | `a37e783d7b7233c083d4f62926c7a25f238d0316` | 254676 |
| 6 | `bc9cd28561042c83f219324d3c607256c03272ae` | 287922 |
| 7 | `a4fb960c0bc06e1eabb804e5b397cdc4b45596fa` | 162583 |
| 8 | `1b3c89f65e6c9e883012052823443f048b4332db` | 399871 |
| 9 | `1637409809a679dc698207310c8c7fc07290d9e5` | 520489 |

> core 的 `tests/otp/*` 是向量的唯一来源；ohos 设备用例复用同一批期望值。

## 附录 B：协议外参考

- RFC 4226（HOTP）、RFC 6238（TOTP）、RFC 4648（Base32/Base64）、RFC 3986（URI）、RFC 5234（ABNF）、RFC 2119/8174（需求用词）
- Google Authenticator [Key URI Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format)（`otpauth://` 的事实标准）
- IANA URI Schemes：`otpauth`（Provisional，CRI #13829，2020-05-14 注册，Reference 指向上面的 wiki）
- `draft-andesco-otpauth-uri-01`（2026-10-30，IETF 个人稿，非 RFC）：补全 label/issuer ABNF，明确 consumer 必须先按原始串切分再解码（§3.1）、解码后段内含冒号必须拒收（§3.1）、已知参数至多一次（§3.4）、issuer 参数是匹配权威且不得仅因与前缀不同而拒收（§4）
