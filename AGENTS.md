# AGENTS.md —— otp monorepo

> 动手前先读本文件，以及对应包内的 AGENTS.md（`packages/miniprogram-otp/AGENTS.md`、`packages/ohos-otp/AGENTS.md`）。

## 1. 仓库定位

- monorepo：`packages/core` 是**唯一实现源码**；两个平台包只保留平台类型层、crypto 实现与 barrel。
- `packages/core` 不对外发布；`packages/miniprogram-otp` 发 npm；`packages/ohos-otp/library` 发 ohpm HAR。

## 2. 分层与不变量

| 层                | 位置                                                                                                                        | 约束                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 共享实现          | `packages/core/src/**`                                                                                                      | 现代 TS；**跨边界公开签名只用基础类型**（ArkTS 不支持字面量类型/as const） |
| 纯 JS 兜底 crypto | `packages/core/src/pure-js/**`                                                                                              | 仅 miniprogram 引用；ohos 不得 import                                      |
| 平台类型层        | `packages/miniprogram-otp/src/{types,errors}.ts`、`packages/ohos-otp/library/src/main/ets/{OtpOptions,OtpError}.ets`        | 各自最强类型：TS 字面量联合 / ArkTS enum                                   |
| 平台 crypto       | `packages/miniprogram-otp/src/index.ts`（注册 pure-js）、`packages/ohos-otp/library/src/main/ets/internal/CryptoSource.ets` | ohos 唯一 `@kit` 导入点                                                    |
| 生成副本          | `packages/ohos-otp/library/src/main/ets/core/**`                                                                            | **禁止手改**；由 `bun run sync:core` 生成                                  |

1. **core 是唯一实现**：算法/门面/URI/错误码只改 core，禁止在平台包内复制实现。
2. **错误跨层靠工厂**：core 只 `otpFail(code)`；平台 barrel 注册 `setErrorFactory`，公开 `OtpError` 由平台拥有。
3. **ohos 副本禁止手改**：CI 必须跑 `bun run sync:core:check`；改动只能来自 core。
4. **pure-js 不进 ohos 编译图**：ohos 只 import `core/src/index`，不得 import `core/src/pure-js*`。
5. 其余算法不变量（取模位置、恒定时间 verify、secret 不泄漏、错误码冻结）见两个包内 AGENTS.md，保持有效。

## 3. 命令

```bash
bun install
bun run sync:core
bun run sync:core:check
bun run lint
bun run typecheck
bun run test
bun run check
```

ohos 构建/测试见 `packages/ohos-otp/AGENTS.md`（DevEco SDK + hvigor 命令）。

## 4. 授权红线

- `git push`、`npm publish`、`ohpm publish`、创建/修改 git remote 一律需人工明确授权。
- 不允许自动合并 PR。

## 5. 文档

- 本仓库根 `README.md`：结构与命令。
- 设计结论：`packages/ohos-otp/docs/ohos-otp-lib-rfc.md`（历史）+ 后续 core 设计文档。
