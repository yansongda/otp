---
name: release
description: "@yansongda/miniprogram-otp 本仓库发版流程（首次发布 / bump version / 写 CHANGELOG / 打 tag / npm publish / GitHub Release / 发布核验 / 回滚）。用户说发版、发布新版本、release、publish、打 tag、建 Release 时使用。"
---

# Release：@yansongda/miniprogram-otp

## Overview

本仓库是独立 npm 包，发布流程以**人工闸门**为核心：

1. 用户确认版本号；
2. 用户明确授权 `npm publish`；
3. 用户明确授权 `git push`（分支 / tag）。

Agent 负责：分析真实 diff、写 CHANGELOG、跑 `release:check`、建 release PR、打 annotated tag、执行发布核验、生成 GitHub Release notes。**永不自动合并 PR，永不在未获当次授权时 push 或 publish。**

### 当前仓库的自动化事实

> 改 CI / package.json / 发布方式后，必须回来更新本表。

| 环节            | 事实                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 包              | npm 公开包 `@yansongda/miniprogram-otp`（scoped，`publishConfig.access: "public"`）                                               |
| 包入口          | `main: dist/index.js`、`types: dist/index.d.ts`、`miniprogram: dist`                                                              |
| 测试 CI         | `.github/workflows/ci.yml`：push `main`、PR、tag `v*`；Bun 版本由 `.bun-version` 固定（当前 `1.4.4`），另有非阻塞 `compat-latest` |
| 发布 CI         | `.github/workflows/release.yml`：push tag `v*` → tag/version 校验 → `release:check` → 版本已存在则跳过 → OIDC `npm publish`       |
| 发布鉴权        | GitHub OIDC Trusted Publishing（`id-token: write`）；仓库不保存 `NPM_TOKEN`；首次发布除外                                         |
| 发布前守卫      | release.yml 运行 `bun run release:check`；本地手动发布仍由 `prepublishOnly` → `release:check` 兜底                                |
| `release:check` | invariants + lint + typecheck + test + build + dist smoke + `npm pack --dry-run`                                                  |
| GitHub Release  | 手动 `gh release create`；notes 由真实 diff 清单生成，不用 `--generate-notes`                                                     |
| tag 命名        | `vX.Y.Z`，必须与 `package.json` 的 `version` 逐字符一致                                                                           |
| dist-tag        | 稳定版 `latest`；版本含 `-` 时用 `next`                                                                                           |
| README          | 不写版本号；发版不改 README 的安装命令                                                                                            |
| 首次发布        | 若 `npm view @yansongda/miniprogram-otp version` 返回 404，按「首次发布特例」处理                                                 |

## When to Use

- 用户说「发版 / 发布新版本 / release / publish / bump version / 打 tag」
- 首次把本包发布到 npm
- 需要生成 GitHub Release notes

## 前置检查

```bash
git status --short                  # 必须为空
git branch --show-current           # 必须 main
git pull --ff-only origin main
gh auth status                      # 需要 gh release 权限
git describe --tags --abbrev=0      # 无输出 = 首次发版
npm view @yansongda/miniprogram-otp version  # 404 = 尚未发布
npm whoami                          # 仅首次发布 / 手动兜底需要
date +%F                            # CHANGELOG 日期
gh run list --workflow=ci.yml --limit 1  # 最新 main CI 必须 success
```

### 三道闸门

| 闸门                     | 谁决定                               | Agent 行为                                                            |
| ------------------------ | ------------------------------------ | --------------------------------------------------------------------- |
| 版本号                   | 用户确认或指定                       | 给建议 + 理由，等待确认                                               |
| `git push`（分支 / tag） | 用户当次明确说「push / 推送 / 执行」 | 展示命令，等待授权；**必须说明 push tag 会触发 release.yml 发布 npm** |
| 手动 `npm publish`       | 用户当次明确授权                     | 仅用于首次发布 / OIDC 不可用时的兜底；展示命令后等待授权              |

「完成」「处理一下」「惯例上要 push/publish」都不构成授权；上一轮会话的授权不延续到本轮。

## Release Flow

```text
前置检查
  → 分析 BASE..HEAD 真实 diff
  → 建议版本号
  → 用户确认版本
  → 写 CHANGELOG + bump package.json
  → bun run release:check
  → release PR（默认）
  → 人工合并
  → pull main + 核对 version
  → annotated tag vX.Y.Z
  → 用户授权 push tag（会触发 release.yml 发布 npm）
  → release.yml: tag/version 校验 → release:check → OIDC npm publish
  → tag CI / release workflow success
  → 发布后核验
  → 生成 notes + GitHub Release
  → 清理 release 分支（如有）
```

### Step 1：分析真实 diff 并建议版本

**以 `git diff` 为准，不以 commit message / PR 描述为准。**

```bash
BASE=$(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)
git diff "$BASE"..HEAD --stat
git diff "$BASE"..HEAD -- src/ tests/ package.json README.md README-cn.md CHANGELOG.md .github/
```

语义化版本规则：

- **破坏性变更**：公开导出、DTO 字段、错误码字符串、默认值、包入口变化 → 1.0.0 之后记 major；之前记 minor，并在 CHANGELOG 写 `BREAKING`
- **新功能**：minor
- **修 bug / 文档 / 内部重构 / CI**：patch
- **预发布**：`X.Y.Z-beta.N`，发布时用 `--tag next`
- **仅文档变更**：仍发 patch
- **零 diff**：先问用户是否仍要发版

向用户呈现：

```text
自 vX.Y.Z（或首次发布）以来的改动：
- 代码：<src/ 要点>
- 测试/CI：<要点>
- 文档/包元数据：<要点>
- 是否 BREAKING：<有/无>

建议版本：vX.Y.Z（理由：…）
确认？或直接给版本号。
```

### Step 2：按 diff 写 CHANGELOG + 同步版本

#### 2.1 生成 diff 清单

```bash
NEW=1.1.0
mkdir -p "docs/evidence/$(date +%F)-release-v$NEW"
# 逐模块阅读 diff，把「文件 + 符号/hunk → 用户可见变化」写入：
# docs/evidence/$(date +%F)-release-v$NEW/diff-inventory.md
git check-ignore -v docs/evidence/   # 必须确认被忽略，不会混进发布 PR
```

清单必须满足：

- diff 中每处用户可见变化都有条目；
- 每条都能指出证据（文件 + 符号/hunk）；
- 区分「行为变化」与「纯重构/改名/格式化」；
- 纯重构放「工程」，不包装成「功能」。

#### 2.2 写 CHANGELOG

沿用当前格式：

```markdown
## [X.Y.Z] - YYYY-MM-DD

<一句话概括本版主题>

### Added

- …

### Changed

- BREAKING: …（如有，写迁移方式）

### Fixed

- …

### Engineering

- 仅内部可见的测试 / CI / 重构
```

约束：

- 保留标识符原文：文件名、字段名、错误码、API 名；
- 不写「详见 PR」、内部工单号、未公开链接；
- 不搬 commit message；
- diff 中没有的能力一个字都不写。

#### 2.3 同步版本引用

```bash
NEW=1.1.0
OLD=1.0.0
# 手工改 package.json 的 version（不要用会顺带打 tag 的命令）
grep -n '"version"' package.json
git grep -n "$OLD" -- .   # 兜底：README / 文档不应残留版本号
```

- `package.json` → `version`（决定 npm 发布版本）
- `CHANGELOG.md` → 新增 `## [NEW] - YYYY-MM-DD`
- `README.md` / `README-cn.md` → **不写版本号**，发版不改安装命令
- 不要改历史 `docs/evidence/`（已被 gitignore）

### Step 3：本地发布验收

```bash
bun install --frozen-lockfile
bun run release:check
```

`release:check` 等价于：

```bash
bun run check:invariants
bun run lint
bun run typecheck
bun test
bun run build
bun run smoke:dist
npm pack --dry-run
```

检查 `npm pack --dry-run` 输出：

- 必须包含：`dist/index.js`、`dist/index.d.ts`、README.md、README-cn.md、CHANGELOG.md、LICENSE
- 不应包含：`src/`、`tests/`、`node_modules/`、`.agents/`、`docs/`
- `package.json` 的 `miniprogram` 仍为 `dist`
- 当前包体积约 45 kB（81 files），异常增大时先查 `files`

可选：

```bash
bun run test:coverage   # 当前 lines 覆盖率约 98.7%
```

任何一道失败都不许继续，修好后从 Step 3 重跑。

### Step 4：创建 release PR（默认）

> 本仓库当前没有分支保护；发版仍建议走 release PR，便于人工审阅版本与 CHANGELOG。用户明确要求直接 main 时可跳过 PR，但仍需 push / publish 当次授权。

```bash
git checkout -b release/vX.Y.Z
git add package.json CHANGELOG.md
git commit -m "chore(release): vX.Y.Z"
git push origin release/vX.Y.Z      # 需当次 push 授权
gh pr create --base main --title "chore(release): vX.Y.Z" --body "## 发版 vX.Y.Z

- CHANGELOG 已按真实 diff 更新
- 本地 release:check 全绿
- 合并后由人工打 tag vX.Y.Z 并执行 npm publish"
```

**STOP A。** 对用户说：

```text
PR #N 已创建：<链接>
等待你人工审核合并；合并后告诉我，我再核对并打 tag。
```

**此时禁止**：`gh pr merge`、auto-merge、打 tag、push tag、npm publish。

### Step 5：合并后核对

```bash
gh pr view <N> --json state,mergedAt,mergedBy,mergeCommit
# 必须 state=MERGED，mergedBy 为人工账号（非 bot）

git checkout main
git pull --ff-only origin main
grep -n '"version"' package.json
git log --oneline -1
gh run list --workflow=ci.yml --limit 1 --json conclusion,headSha --jq '.[0]'
# 最新 main 提交的 CI 必须 success
```

### Step 6：打 annotated tag 并核对

```bash
TAG=vX.Y.Z
VER=${TAG#v}
test "$(node -p 'require("./package.json").version')" = "$VER" || {
  echo "tag/version 不一致"; exit 1;
}
git tag -a "$TAG" -m "Release $TAG"
git show "$TAG" --stat | head -20
git describe --tags --abbrev=0   # 应为 $TAG
```

**铁律**：tag 名 = `v` + `package.json` 的 `version`，逐字符一致。

### Step 7：展示 summary，等待 push 授权

```text
## Release Summary: vX.Y.Z

- 版本：package.json = X.Y.Z
- tag：vX.Y.Z（annotated，指向 <commit>）
- 本地验收：release:check 全绿
- 待执行：git push origin vX.Y.Z
- push 后：tag 触发 ci.yml（main + compat-latest）与 release.yml（OIDC npm publish）
- 首次发布：必须先本地手动 npm publish，再推 tag（见「首次发布特例」）
```

**STOP B。** 只有用户明确说「push / 推送 / 执行」才继续；授权前必须说明 push tag 会自动发布 npm。

### Step 8：push tag（获授权后，自动触发 npm publish）

**push tag 会触发 `.github/workflows/release.yml` 并发布 npm。** 因此 push tag 的授权必须明确告知用户这一点；用户当次说「push / 推送 / 执行」后，才执行：

```bash
git push origin main          # 仅当 main 有本地未推提交；PR 流程通常已同步
git push origin "$TAG"        # 不要用 --tags，避免带上陈旧 tag
```

等待发布 workflow：

```bash
gh run list --workflow=release.yml --limit 1
gh run watch <run-id> --exit-status
```

release.yml 行为：

1. 校验 tag ↔ `package.json` version；
2. 跑 `bun run release:check`；
3. `npm view` 检查包/版本状态；
4. 版本已存在 → 跳过 publish（用于首次手动发布后的 tag、以及失败重跑）；
5. 版本不存在 → OIDC `npm publish --ignore-scripts --provenance --access public --tag <latest|next>`；
6. 核验 `npm view` 与 dist-tag。

失败时：先看 `gh run view <run-id> --log-failed`；修复后优先 `gh run rerun <run-id>`（版本已存在时 workflow 会跳过 publish，不会 403）。若必须改 tag，删除远端 tag（需授权）后从 Step 4 重走。

### Step 9：查看 release workflow 核验结果

```bash
gh run view <run-id> --json status,conclusion,jobs
gh run view <run-id> --log
```

成功标准：`Publish to npm` 任务 success；`Verify published version` 步骤 output 中 `npm view` 能返回版本、tarball、integrity，dist-tags 指向预期 tag。

### Step 10：发布后核验（必做）

```bash
npm view @yansongda/miniprogram-otp version
npm view @yansongda/miniprogram-otp dist-tags --json
npm view @yansongda/miniprogram-otp@X.Y.Z dist.tarball dist.integrity
```

临时安装冒烟：

```bash
TMP=$(mktemp -d)
cd "$TMP"
npm init -y >/dev/null
npm install "@yansongda/miniprogram-otp@X.Y.Z"
node -e '
const { TOTP, HOTP, OtpError, OtpErrorCode } = require("@yansongda/miniprogram-otp");
const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
if (new TOTP({ secret: seed, digits: 8 }).generate(59000) !== "94287082") throw new Error("TOTP vector");
if (new HOTP({ secret: seed }).generate(0) !== "755224") throw new Error("HOTP vector");
try { new TOTP({ secret: seed, digits: 5 }); } catch (e) {
  if (!(e instanceof OtpError) || e.code !== OtpErrorCode.INVALID_DIGITS) throw e;
}
console.log("npm package smoke OK");
'
```

检查产物：

```bash
npm pack "@yansongda/miniprogram-otp@X.Y.Z"
tar -tzf yansongda-miniprogram-otp-X.Y.Z.tgz | sort | head -40
# 必须含 package/dist/index.js、package/dist/index.d.ts、README、CHANGELOG、LICENSE
# 不应含 package/src/、package/tests/、package/.agents/
```

### Step 11：生成 notes 并创建 GitHub Release

Notes 来源：Step 2.1 的 `diff-inventory.md`，不是 commit message / 既有 CHANGELOG 文本。

```bash
TAG=vX.Y.Z
VER=${TAG#v}
INV=$(ls -t "docs/evidence"/*-release-v$VER/diff-inventory.md 2>/dev/null | head -1)
test -n "$INV" || { echo "缺少 Step 2.1 清单，先补做"; exit 1; }
NOTES="$(dirname "$INV")/release-notes.md"
```

1. 按清单写 notes：`## [X.Y.Z] - YYYY-MM-DD` + 主题句 + Added/Changed/Fixed/Engineering。
2. 与 CHANGELOG 段落交叉校验；
3. 把 notes 内容展示给用户过目（公开内容）；
4. 创建：

```bash
# 稳定版
gh release create "$TAG" --title "$TAG" --notes-file "$NOTES" --verify-tag --latest

# 预发布
gh release create "$TAG" --title "$TAG" --notes-file "$NOTES" --verify-tag --prerelease

gh release view "$TAG"   # 核对 notes 与 tag
```

**禁止** `--generate-notes`；它汇总 commit/PR 文本，不是代码 diff。

### Step 12：清理 release 分支（如有）

```bash
git push origin --delete release/vX.Y.Z   # 需 push 授权
git branch -d release/vX.Y.Z
git remote prune origin
```

## 首次发布特例

触发条件：`npm view @yansongda/miniprogram-otp version` 返回 404。

release.yml 要求 npm 包已存在且 Trusted Publisher 已配置，因此**首次发布必须先本地手动完成，再推 tag**：

1. 按 Step 1–3 完成 diff / CHANGELOG / `release:check`；合并发布 PR。
2. 本地创建 annotated tag `v1.0.0`（先不 push）。
3. 用户执行本地首发：
   ```bash
   npm login          # 用户亲自输入凭据；agent 不接触 token / OTP
   npm whoami
   npm publish --access public
   ```
   `prepublishOnly` 会再跑一次 `release:check`。
4. 核验：
   ```bash
   npm view @yansongda/miniprogram-otp version   # 必须等于首发版本
   ```
5. 在 npm 包设置页配置 Trusted Publisher：
   - Organization/user: `yansongda`
   - Repository: `miniprogram-otp`
   - Workflow filename: `release.yml`
   - Allowed actions: 勾选 **`npm publish`**
6. push tag（需当次授权）：
   ```bash
   git push origin v1.0.0
   ```
   release.yml 会跑 `release:check`，发现该版本已在 npm 上 → 跳过 publish；tag CI 正常跑。
7. 按 Step 11 创建 GitHub Release。

> 若先 push tag 再手动发布，release.yml 会在 `Check npm package state` 步骤报「包不存在」并失败。这是预期的首次发布保护。

## OIDC 配置 checklist（npm 侧）

release.yml 已使用 OIDC，仓库不需要 `NPM_TOKEN`；但 npm 包需要完成一次配置：

1. npm 包设置 → Trusted Publisher：`yansongda` / `miniprogram-otp` / `release.yml`，允许 `npm publish`；
2. workflow 已有 `permissions: id-token: write`，发布命令为
   `npm publish --ignore-scripts --provenance --access public --tag <latest|next>`；
3. 要求 npm CLI ≥ 11.5.1、Node ≥ 22.14（release.yml 用 Node 24）；
4. 新配置的 Trusted Publisher 需在 **2 天内**完成一次成功发布，否则配置过期，只能删除重建；
5. 若 publish 报 `ENEEDAUTH` / `Unable to authenticate`，逐项核对 workflow 文件名大小写、仓库名、`package.json` 的 `repository.url`、Allowed actions 是否允许 `npm publish`；
6. 失败重跑优先用 `gh run rerun <run-id>`；版本已存在时 release.yml 会跳过 publish，不会 403。

## 异常与回滚

| 情况                               | 处理                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| tag 打错，尚未 push                | `git tag -d vX.Y.Z`，修正后重打                                                        |
| tag 已 push，尚未 publish          | 删除远端 tag（需授权）→ 修正 → 从 Step 4 重走                                          |
| tag/version 不一致                 | 删除本地/远端 tag，改 `package.json` 走 PR 后重打                                      |
| tag CI 失败                        | 修问题，删远端 tag（授权）后重走；不要带失败 tag 发布                                  |
| npm publish 401/403                | 检查 `npm whoami`、2FA、`publishConfig.access`、包名权限；版本已存在时改发下一个 patch |
| publish 成功但 GitHub Release 漏建 | 按 Step 11 补；不要 rerun 发布流程，避免重复 publish                                   |
| notes 与 CHANGELOG 不一致          | 以 diff 清单为准；已发布内容不篡改，下一版修正                                         |
| 发布后发现严重问题                 | `npm deprecate @yansongda/miniprogram-otp@X.Y.Z "原因"`（用户执行），尽快发 patch      |
| 误把版本号写进 README              | 删除版本号；README 固定安装命令，不带版本                                              |

## Anti-Patterns & Rationalizations

| 借口                                         | 事实                                                                |
| -------------------------------------------- | ------------------------------------------------------------------- |
| 「用户说发版 = 授权 push」                   | 发版 ≠ push；push 必须当次授权                                      |
| 「push tag 只是打标签，不等于发布」          | release.yml 会 OIDC publish；授权前必须明确告知                     |
| 「用户说发版 = 授权手动 npm publish」        | 首次发布 / 兜底 publish 不可逆；必须单独当次授权                    |
| 「PR CI 绿了，可以自动合并」                 | 永不自动合并；等人工合并后告知                                      |
| 「CHANGELOG 抄 commit message 更快」         | commit message 会漏/夸大；唯一依据是 diff                           |
| 「Release notes 用 `--generate-notes` 省事」 | 它汇总 commit/PR，不是代码 diff；禁止                               |
| 「tag 先推，版本号之后再看」                 | tag/version 不一致会污染永久历史                                    |
| 「本地 release:check 跑过，tag CI 可跳」     | tag CI 是发布前最后一道自动验证，必须等 success                     |
| 「publish 失败就重推同一个 tag」             | 先 `gh run rerun`；workflow 发现版本已存在会跳过 publish            |
| 「token 写进 .npmrc 方便」                   | release.yml 用 OIDC；仓库不保存 token；本地首发用 `npm login` + 2FA |

## Quick Reference

| 步骤             | 命令要点                                                                          | 授权                                      |
| ---------------- | --------------------------------------------------------------------------------- | ----------------------------------------- |
| 前置检查         | `git status --short`、`npm view ... version`、`git describe --tags`、`npm whoami` | 无需                                      |
| 版本建议         | `git diff BASE..HEAD`                                                             | 版本需用户确认                            |
| diff→清单        | `docs/evidence/.../diff-inventory.md`（gitignored）                               | 无需                                      |
| 版本同步         | 改 `package.json` + `CHANGELOG.md`；`git grep <旧版本>`                           | 无需                                      |
| 发布验收         | `bun run release:check`                                                           | 无需                                      |
| PR               | `chore(release): vX.Y.Z` → `gh pr create`                                         | push 分支需授权；合并人工                 |
| tag              | `git tag -a vX.Y.Z` + `git show`                                                  | 无需（本地）                              |
| push tag         | `git push origin vX.Y.Z` → 触发 release.yml OIDC publish                          | **需当次授权，并告知会自动发布 npm**      |
| 手动 npm publish | 仅首次发布 / OIDC 兜底：`npm publish --access public`                             | **需单独当次授权**                        |
| workflow 核验    | `gh run view <run-id> --log`、`npm view`、dist-tags                               | 无需                                      |
| 本地核验         | `npm view`、临时安装、`npm pack` 查产物                                           | 无需                                      |
| GitHub Release   | 复用清单写 notes → `gh release create --notes-file`                               | push 授权不自动覆盖；创建前给用户看 notes |

## 相关文件（真相来源）

- `.github/workflows/ci.yml`：main / PR / tag `v*` 的测试定义；Bun 版本见 `.bun-version`
- `.github/workflows/release.yml`：tag `v*` 触发 OIDC npm publish；版本已存在时跳过 publish
- `package.json`：`version`、`files`、`main`、`types`、`miniprogram`、`prepublishOnly`
- `scripts/ci/check-invariants.mjs`：仓库不变量（含版本 ↔ CHANGELOG、发布脚本、`.bun-version`）
- `scripts/ci/smoke-dist.mjs`：构建产物冒烟
- `CHANGELOG.md`：版本段落，发版时更新
- `README.md` / `README-cn.md`：不写版本号；安装命令固定
- `docs/evidence/`：gitignored，放 diff 清单与 notes 草稿

<!-- 本 skill 位于 .agents/skills/release/；编辑后 /reload 生效。 -->
