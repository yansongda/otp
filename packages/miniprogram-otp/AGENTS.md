# AGENTS.md —— miniprogram-otp 工程上下文

> 面向所有在该仓库工作的编码 agent / 协作者。**动手前先读本文件**。
> 设计基线：`ohos-otp/library` v1.1.0（ArkTS）与 `yansongda-application/wechat/miniprogram/totp/src/otp`（TS）。

## 1. 项目定位

- 本目录是 monorepo 的 `packages/miniprogram-otp`，发布 npm 包 **`@yansongda/miniprogram-otp`**：RFC 4226 HOTP + RFC 6238 TOTP（SHA1/SHA256/SHA512，6/7/8 位，otpauth URI，漂移窗口，时钟校准，可选严格 base32）。
- **实现全部来自 `packages/core`（唯一源码）**；本包只保留平台类型层、纯 JS crypto 注册、barrel + 类型桥。
- 目标运行时：微信小程序（CommonJS）；同时可用于 Node / Bun / 现代打包器。
- 零运行时依赖；`dependencies` 必须保持 `{}`（`@yansongda/otp-core` 只允许出现在 `devDependencies`）。
- 构建：`tsdown` 把 core 源码内联为单文件 `dist/index.js`（CJS）+ 单文件 `dist/index.d.ts`；微信只消费 `dist/index.js`。

## 2. 分层与不变量（**改动必须遵守**）

| 层 | 位置 | 允许依赖 |
| --- | --- | --- |
| 共享实现 | `../core/src/**`（唯一源码，本包只消费） | 零平台能力 |
| 平台类型层 | `src/types.ts`（const 对象 + 字面量联合 + 严格 DTO）、`src/errors.ts`（公开 OtpError / 18 码） | 无 |
| 平台 provider | `src/index.ts` 导入时注册 `installPureJsHmac()` + `setErrorFactory()` | `@yansongda/otp-core/pure-js` |
| 出口 | `src/index.ts`（公开符号 + 构造签名类型桥） | 以上 |

1. **`src/index.ts` 是唯一公开入口**：导入时幂等调用 `installPureJsHmac()` 与 `setErrorFactory()`；core 内部模块不得从 barrel 深导出。
2. **平台层零平台调用**（core 已是零平台）：本包不得出现 `wx.*`、`console.*`、`node:` 内置模块；平台随机数由使用方通过 `wx.getRandomValues` + `Secret.fromBytes` 提供。
3. **禁止 BigInt**：SHA-512 使用 hi/lo 半字，老设备兼容。
4. **secret 绝不外泄**：错误消息固定文案；`Secret` 刻意不实现 `toString()`；`toJSON()` 返回 `[REDACTED]`。
5. **`verify` 恒定时间**：窗口内扫完所有候选后才返回首个命中 delta，禁止早退优化。
6. **取模只在 `internal/digits.ts` 发生一次**；`truncate` 只做 `& 0x7f`（31 位非负）。
7. **错误码冻结**：`OtpErrorCode` 恰为 18 个；v1 起仅允许新增，不得改已有字符串值。
8. **DTO 冻结**：`HmacOptions` / `TotpOptions` / `HotpOptions` / `VerifyOptions` / `OtpAuthParams` 字段名与可选性仅允许新增可选字段。

其他有意差异（相对 OHOS）：

- `OtpAlgorithm` 用 `const` 对象 + 联合类型，不用 `enum`；`"SHA1"` 与 `OtpAlgorithm.SHA1` 都可赋值。
- `OtpError` 额外设置 `name` 与 `Object.setPrototypeOf`，保证微信 ES5 降级后 `instanceof` 可靠。
- HMAC 为纯 JS，不使用系统 crypto。
- 默认不注册随机源；`Secret.generate()` 在微信端抛 `CRYPTO_NOT_INITIALIZED`。

## 3. 命令（实测可跑）

```bash
bun install
bun run lint              # biome check（格式 + lint + import 组织）
bun run lint:fix          # biome check --fix
bun run typecheck         # tsc --noEmit
bun test                  # 全部 Bun 测试（tests/）
bun run test:coverage     # Bun 覆盖率
bun run build             # tsc -> dist（CJS + d.ts）
bun run check:invariants  # 仓库不变量守卫（零依赖 node 脚本）
bun run smoke:dist        # require dist 并验证 RFC 向量
bun run release:check     # 发版前全量检查（含 npm pack --dry-run）
npm pack --dry-run        # 仅检查发布内容
```

> Bun 1.4.4 尚未提供内置 linter；`bun lint` 当前等价于执行 package.json 的 `lint` 脚本（Biome）。`bun fmt` 是 Bun 内置格式化器，可用于 README/JSON，但 CI 的代码格式判定以 Biome 为准。

Bun 版本固定于 `.bun-version`（当前 `1.4.4`）。主 CI 通过 `bun-version-file` 读取该文件；另有非阻塞的 `compat-latest` 任务跟随 `latest`，用于提前发现新版本问题。升级 Bun 必须单独提交：改 `.bun-version` 并跑全量 CI，不要在主 CI 直接使用 `latest`。

## 4. 测试策略

- **算法测试在 `packages/core`（242 条）**：RFC 4226 / 6238 / 4648 向量、哈希/HMAC 向量、错误码、strict base32、URI、时钟校准与随机注入。向量唯一来源 `packages/core/tests/otp/vectors.ts`，**逐字复制自 OHOS `RfcVectors.ets` 与 FIPS/RFC 官方向量，禁止自行推导或补算**。
- 本包只保留 `tests/platform.test.ts`（9 条）：注册链路、错误工厂、类型桥、公开 API 契约。新增平台逻辑必须补测；测试数量不得下降（`scripts/ci/check-invariants.mjs` 基线 9/1）。
- 算法逻辑变更只改 `packages/core` + 其测试，**禁止在本包复制实现**。
- 微信真机 / 开发者工具“构建 npm”冒烟仍是人工门槛，CI 无法覆盖。

## 5. 代码约定

- 缩进 2 空格、双引号、无 Tab；注释用中文，只写「为什么 / 约束 / RFC 依据」。
- 不引入运行时依赖；不引入第三方 OTP / 密码学库。
- 错误一律 `throw new OtpError(code, FIXED_MESSAGE)`。
- 不使用 WeChat 不支持的 API：`padStart`、`URLSearchParams`、BigInt、Node 内置模块。
- 不新增 `console.*` / 埋点；需要观测时用 CI 指标（测试数量、覆盖率、pack 文件清单）。
- 发布物为 `dist/`，不提交构建产物；`dist/` 在 `.gitignore` 中。

## 6. 发布与仓库边界

- **禁止自动 `git push` / `npm publish`**：均需人工明确授权后执行。
- `prepublishOnly` → `release:check`（guard / lint / typecheck / test / build / smoke / pack）；发布前必须通过。
- 包名固定 `@yansongda/miniprogram-otp`；修改包名属于设计性变更，需确认。
- 父仓库 `yansongda-application/wechat/miniprogram/totp` 不在本仓库编辑范围；迁移父仓库属于独立任务。
- 与 `ohos-otp/library` 对齐时，以公开 API / 错误码 / 行为为准；实现细节允许按 TypeScript / 微信运行时调整。

## 7. 发版

- 完整流程见 `.agents/skills/release/SKILL.md`。
- 三道闸门：版本号用户确认；`git push` 当次授权（**push tag 会触发 release-miniprogram.yml OIDC 发布 npm**）；首次发布 / OIDC 兜底的手动 `npm publish` 需单独授权。
- 发版前统一跑 `bun run release:check`（invariants + lint + typecheck + test + build + dist smoke + pack dry-run）。
- tag 必须是 annotated `miniprogram-vX.Y.Z`，且与 `package.json` 的 `version` 逐字符一致（monorepo 与 ohos 的 `ohos-vX.Y.Z` 区分）。
- `.github/workflows/release-miniprogram.yml`：push tag `miniprogram-v*` 触发 OIDC `npm publish`；版本已存在时跳过 publish，避免重跑 403。
- 首次发布 npm 包尚不存在，必须先本地 `npm publish` 并在 npm 包设置配置 Trusted Publisher，再推 tag；见 release skill「首次发布特例」。
- `docs/evidence/` 已被 gitignore，用于放 diff 清单与 release notes 草稿。

## 8. 已知边界

- counter ≤ `2^53-1`。
- `otpauth://` 遵循 Google Authenticator 事实标准。
- `verify()` 默认 `window: 0`。
- 不提供 throttling、Steam Guard、SHA224/384/SM3、二维码渲染/扫码。
