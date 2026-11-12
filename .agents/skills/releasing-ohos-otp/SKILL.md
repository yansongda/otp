---

name: releasing-ohos-otp
description: 用于发布 @yansongda/otp 新版本到 OHPM 时——发布前 sync core、bump 版本号、落版 CHANGELOG、开 release PR、打 tag、执行 ohpm publish；或 ohpm publish 卡住/刷屏/OOM/反复报 "The content of private key in the key_path error" 时使用
---

# 发布 @yansongda/otp 到 OHPM

> **路径约定（monorepo）**：本 skill 位于仓库根 `.agents/skills/releasing-ohos-otp/`。
> hvigor / ohpm 命令默认在 `packages/ohos-otp` 目录执行（`library/...` 相对该目录）；
> `bun run sync:core`、`bun run lint` 是**仓库根**脚本，bun 会沿目录向上解析，在包目录内执行同样有效。

## Overview

**已发布版本不可覆盖、不可删除**——发错只能占用下一个版本号，所以产物自检是最后一道防线。

职责分工：`AGENTS.md` §7 定义流程与人工闸门、§3 定义命令；本 skill 只补**执行顺序、判定标准、实测坑**。

## 流程（0–5 步）

| #   | 步骤      | 判定 / 约束                                                                                                                                                                                                                           |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | 同步 core | `bun run sync:core` 后副本零差异（`packages/core` 是唯一源码，`library/src/main/ets/core/**` 是生成副本、禁止手改、随 HAR 编译）；有差异按下一节处置——**release blocker**                                                             |
| 1   | 落版      | 版本唯一来源是 `library/oh-package.json5`；`CHANGELOG.md` 写出 `## <ver> - <YYYY-MM-DD>`；**README（含预发布清单）不写版本字面量**（见 Red flags），只需保证与 `oh-package.json5` 一致                                                |
| 2   | 本地预检  | `ohpm install --all`（clean clone / 依赖变更时）→ 不变量守卫 10/10 → `sync:core:check` → CodeLinter 0 缺陷 → local test 全绿 → `assembleHar` → 产物自检 → `prepublish succeed` → `assembleHap`（entry smoke，需 `JAVA_HOME`）         |
| 3   | 分支 + PR | 本仓库是 **squash** 合并；PR 由人工合并，agent 不合并。**改了 `AGENTS.md` / README / skill 必须跑 `bun run lint`**（biome 覆盖 md，表格对齐不合规会让 PR CI 挂）；`entry/oh-package-lock.json5` 版本从旧版变新版属正常 diff，一起提交 |
| 4   | tag       | `git tag -a ohos-v<ver> -m "ohos-v<ver>" <merge-commit>`（与根 `AGENTS.md` §5 的 `ohos-vX.Y.Z` 一致，勿用裸 `v<ver>`）；推送需人工授权                                                                                                |
| 5   | publish   | **由人在真实终端执行**；agent 只交付命令与核验结论                                                                                                                                                                                    |

## 第 0 步：同步 core（发布前必做）

`packages/core` 是唯一实现源码；`library/src/main/ets/core/**` 是 `bun run sync:core` 生成的**已提交副本**，
**禁止手改**（包内 `AGENTS.md` §2 不变量 3）。副本会随 HAR 一起编译，所以副本落后 = 发布物与源码不一致。

```bash
bun run sync:core                                                   # 生成副本（幂等，当前 14 个文件）
git status --porcelain packages/ohos-otp/library/src/main/ets/core  # 期望：无输出
bun run sync:core:check                                             # 期望：ok (14 files)
```

差异处置（**release blocker，不可略过**）：

| sync 后出现差异         | 真因                    | 处置                                                                            |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| core 改了但没同步       | 开发时漏跑 sync         | 先 review diff，把副本改动 commit 进本 release PR；CHANGELOG 须覆盖这些行为变化 |
| 副本被手改（core 未变） | 违反「core 是唯一源码」 | **不能发布**：改动迁回 `packages/core` 并补 core 测试，再 sync                  |

`ci.yml`（每个 PR 都跑）有 `bun run sync:core:check` 兜底，但那是**事后**暴露：到 release 阶段才发现，
本 PR 就要追加源码改动 + 重跑全套预检，因此必须在落版前先跑。

## 本地预检：`AGENTS.md` §3 之外必须先做的三条

```bash
ohpm install --all                                  # 否则编译期 Failed to resolve OhmUrl "@ohos/hypium"
JAVA_HOME=/Applications/DevEco-Studio.app/Contents/jbr/Contents/Home   # 仅 assembleHap 需要（否则 00308018）
bash scripts/ci/lint-local.sh                       # CodeLinter；exit 0 = 通过（不带 -e 永远 0）
```

hvigor 的 `test` / `assembleHar` / `assembleHap` 命令见包内 `AGENTS.md` §3（`DEVECO_SDK_HOME` 必须指向
`Contents/sdk`）。`test` 与 `assembleHar` **不需要 Java**，只有 `assembleHap` 需要上面那行 `JAVA_HOME`。

## 产物自检

```bash
HAR=library/build/default/outputs/default/library.har
tar xOf "$HAR" package/oh-package.json5 | grep '"version"'    # 必须等于待发版本
tar tzf "$HAR" | grep -c 'src/test\|ohosTest'                 # 必须为 0
tar tzf "$HAR" | grep -q '^package/Index.d.ets$'              # 必需：类型入口
tar tzf "$HAR" | grep -q '^package/example/README.md$'        # 必需：缺失则 OHPM「文档 / example」20 分归零
tar tzf "$HAR" | wc -l                                        # 参考值 53；与 CI artifact 同源时用于交叉核验
# 陈旧性检查：HAR 内打包了 README / README-cn / CHANGELOG / LICENSE，必须与工作区逐字一致
tar xOf "$HAR" package/README.md    | diff - library/README.md
tar xOf "$HAR" package/README-cn.md | diff - library/README-cn.md
tar xOf "$HAR" package/CHANGELOG.md | diff - library/CHANGELOG.md
tar xOf "$HAR" package/LICENSE      | diff - library/LICENSE
```

任一条出现差异 = 产物已陈旧 → `assembleHar` → 重跑本节自检 → 重跑 `prepublish`，再交付发布。

`prepublish` 会提示 `the har file ... contains source code`：薄壳方案的**预期副作用**——包内只有
`core/**/*.d.ts` 类型声明（无 `.ts` / `.ets` 实现、无测试），收尾仍是 `succeed`，不要把它当源码泄漏去"修"。

## publish：必须在交互式终端

```bash
# 人在自己终端里执行；提示 what is your passphrase of the private key: 时手输口令
PATH="/Applications/DevEco-Studio.app/Contents/tools/node/bin:$PATH" \
  /Applications/DevEco-Studio.app/Contents/tools/ohpm/bin/ohpm publish \
  library/build/default/outputs/default/library.har
```

## 发布结果判定：先看命令收尾输出，再查 registry

**OHPM 新版本要过审核，审核期间 registry 查不到**（1.0.0 对照：CHANGELOG 记 `2026-10-01`，registry `time.created` 为 `2026-10-04T10:28:06Z`）。所以 **`NOTFOUND` ≠ 未发布**。

判定顺序：

1. **真实终端里 publish 的收尾输出**才是第一手证据：成功会给出 `succeed` / 等待审核类提示；崩溃刷屏（exit 134）只说明本地失败。
2. 再查 registry 交叉核验（审核通过后才可见）：

```bash
ohpm info @yansongda/otp@<ver>   # exit 0 = 已可见；exit 1 + NOTFOUND = 不可见（可能审核中，也可能没发）
```

3. 查不到但 publish 报成功 → **去 OHPM 控制台看发布记录/审核状态**：CLI 没有待审查询入口（子命令只有 config/info/install/publish/unpublish/dist-tags 等）。**此时禁止重发**——版本号已被占用，重发只会撞冲突或产生重复提交。

包文件下载地址是可靠的交叉核验（**版本页 URL `…/@yansongda/otp/<ver>` 恒 404，不要用它**）：

```bash
curl -sL -o /dev/null -w "%{http_code}\n" \
  "https://ohpm.openharmony.cn/ohpm/@yansongda/otp/-/otp-<ver>.har"   # 200 = 已可见；404 = 审核中或未发
```

## 实测坑（每一条都真踩过）

| 现象                                                                                                                             | 真因与对策                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| publish 刷出**十几万条** `content of private key in the key_path error` 后 `FATAL ERROR ... heap out of memory`（exit 134）      | **没有 TTY**：ohpm 靠交互提问取私钥口令，读到空 → 签名失败 → 源码里的 `for (;e === signError;)` 无限重问。**绝不重定向 publish 输出、绝不在 agent 沙箱里跑**；重跑只会再 OOM 一次 |
| 误判为「私钥配错 / 该换未加密密钥」                                                                                              | ohpm **只接受加密私钥**（内容不含 `ENCRYPTED` 直接 `NotSupportPrivateKey`）。口令只有两个来源：`.ohpmrc` 的 `key_passphrase`，或交互提问                                          |
| clean clone 直接跑 `hvigor test` 报 `Failed to resolve OhmUrl ... "@ohos/hypium"`（14 条 ArkTS ERROR）                           | 未装 ohpm 依赖：先 `ohpm install --all`（`oh-package-lock.json5` 已有，不需要改版本范围）                                                                                         |
| `assembleHap`（entry smoke）报 `00308018 Unknown Error` + `Unable to locate a Java Runtime`                                      | 缺 Java：`JAVA_HOME=/Applications/DevEco-Studio.app/Contents/jbr/Contents/Home`；`test` / `assembleHar` 不需要 Java                                                               |
| 改了 md（README / AGENTS / skill）后 `bun run lint` 报 `Formatter would have printed the following content`（markdown 表格列宽） | biome 覆盖这些 md 并强制对齐表格：`bunx biome check --write <file>` 后重跑 `bun run lint`                                                                                         |
| 用 nvm / 系统 node 跑 ohpm                                                                                                       | `ohpm` 包装脚本取 `PATH` 里的 `node`；固定用 DevEco 自带 node（实测 `Contents/tools/node` 为 v24.14.1，2026-11-12）                                                               |
| 拿整包 sha256 与人对账                                                                                                           | HAR **字节不可复现**（tar mtime 差异）：清单与包内文件内容一致即可，整包 sha 只当单次构建指纹                                                                                     |
| `git branch -d` 删 release 分支报 `not fully merged`                                                                             | squash 合并导致分支 tip 不是 main 祖先：先 `git diff <branch> main` 确认零差异，再 `-D`                                                                                           |
| 发布凭据是 `~/.ssh/id_rsa`（GitHub 身份密钥）                                                                                    | 能发但卫生差：建议改用专用发布密钥（须加密）；**绝不把身份密钥口令写进 `.ohpmrc`**                                                                                                |

## Red flags（出现即停）

- 正要在 agent / 无终端环境里跑 `ohpm publish`，或把它的输出重定向到文件
- 想用 `--log_level debug` **重跑一次**「看看卡在哪」（会再 OOM，且方向错）
- 因为「registry 查不到」就打算重发同一版本号（可能只是在审核中；先看 publish 收尾输出与 OHPM 控制台）
- 打算跳过发布前的 `bun run sync:core`（core 是唯一源码，期间任何改动都会漏进发布物）
- `sync:core` 写出差异后视而不见、或把差异回滚掉再发布（差异要么进本版 CHANGELOG，要么说明这次不该发）
- 想在设计文档或 README 正文里写具体版本号（版本值只属于 `oh-package.json5` 与 `CHANGELOG.md`）
- 打算替人 push、打 tag、合并 PR，或建议把私钥口令写进配置文件
