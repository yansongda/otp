# otp monorepo

`@yansongda/miniprogram-otp`（微信小程序）与 `@yansongda/otp`（HarmonyOS/ArkTS）的统一仓库。

## 结构

```
packages/
  core/                 # 唯一实现源码（现代 TS，跨边界签名 ArkTS 兼容），不对外发布
  miniprogram-otp/      # npm 包：平台类型层 + 纯 JS crypto + tsdown 打包（core 内联）
  ohos-otp/             # DevEco 工程：平台类型层 + native crypto；core 源码经脚本同步进 library
scripts/sync-core.mjs   # core -> ohos library 的生成副本（--check 用于 CI）
```

## 常用命令

```bash
bun install
bun run sync:core            # 同步 core 到 ohos library
bun run sync:core:check      # 校验副本未漂移（CI 用）
bun run lint
bun run typecheck
bun run test
bun run check                # 全量本地检查
```

## 发布 tag

- miniprogram：`miniprogram-vX.Y.Z`（与 `packages/miniprogram-otp/package.json` 一致）→ 触发 OIDC npm 发布。
- ohos：`ohos-vX.Y.Z`（与 `packages/ohos-otp/library/oh-package.json5` 一致）→ 人工 `ohpm publish`。

## 发布边界

- `git push` / `npm publish` / `ohpm publish` 均需人工明确授权。
- core 不发布；两个平台包版本独立。
