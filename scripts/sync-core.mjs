#!/usr/bin/env bun
/**
 * core -> ohos library 的源码副本同步。
 *
 * 为什么需要副本：ohos 的 HAR 必须是模块内源码（`src/main/ets/**`），且 hvigor 不支持跨模块
 * 打包；用 HAR 依赖会带来「源码 HAR 重复编入 / 字节码 HAR 破坏 local test」两种债。
 *
 * 用法：
 *   bun scripts/sync-core.mjs          # 写入副本（带 GENERATED 头）
 *   bun scripts/sync-core.mjs --check  # 只校验，不一致则退出码 1（CI 用）
 */
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CORE_SRC = join(ROOT, "packages/core/src");
/**
 * 不进副本的条目（相对 `packages/core/src`）：
 * - `pure-js` / `pure-js.ts`：ohos 不需要纯 JS 兜底 crypto，而 hvigor 会编译模块内全部 .ts，
 *   留一份就是双份实现进 HAR；
 * - `index.ts`：core 的 barrel。副本里没人 import 它，
 *   但深导入会得到一个未注册 provider / 错误工厂的 core（静默降级），故不随副本发布。
 * 同一份清单也用于 git 溯源：只有这些被排除之外的改动才算「副本内容变了」。
 */
const EXCLUDED = ["pure-js", "pure-js.ts", "index.ts"];
/** git pathspec：`packages/core/src` + 逐项 exclude（只改 pure-js 不该把副本头打上 -dirty）。 */
const COPY_PATHSPEC = [
  "packages/core/src",
  ...EXCLUDED.map((entry) => `:(exclude)packages/core/src/${entry}`),
];
const TARGET = join(ROOT, "packages/ohos-otp/library/src/main/ets/core");
/**
 * 副本头：`core@<commit>` 是「最后一次改动 packages/core/src 的 commit」，用于溯源。
 * 为什么不用 HEAD：只改平台层的 commit 不应让全部副本看起来失同步（--check 会误报）。
 */
const HEADER =
  "// AUTO-GENERATED from packages/core/src/{rel} (core@{commit}). DO NOT EDIT. Run: bun run sync:core\n";

/** 取最后一次改动「会进副本的 core 源码」的 commit；工作区有未提交的这类改动时加 `-dirty` 标记。 */
function resolveCoreCommit() {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  let commit = "unknown";
  try {
    commit =
      git("log", "-1", "--format=%h", "--", ...COPY_PATHSPEC) ||
      git("rev-parse", "--short", "HEAD");
  } catch {
    // 无 git / shallow 时不阻断同步
  }
  try {
    if (git("status", "--porcelain", "--", ...COPY_PATHSPEC)) {
      commit = `${commit}-dirty`;
    }
  } catch {
    // 无法判定工作区状态时保持原值
  }
  return commit;
}
const CORE_COMMIT = resolveCoreCommit();

/** --check 比较时忽略来源 commit：它只是溯源信息，不影响「正文是否同步」的判定。 */
function withoutCommit(text) {
  return text.replace(/\(core@[^)]*\)/g, "(core@<commit>)");
}

const checkOnly = process.argv.includes("--check");

function isExcluded(rel) {
  // 统一分隔符：Windows 上 relative() 产出 `pure-js\\hmac.ts`，直接用 `/` 前缀比较会漏排除，
  // 导致 pure-js 被生成进 ohos 副本（hvigor 会把模块内 .ts 全部编进 HAR）。
  const posix = rel.replace(/\\/g, "/");
  return EXCLUDED.some((dir) => posix === dir || posix.startsWith(`${dir}/`));
}

/** 递归列出目录下全部文件；目录不存在时返回空（--check 用）。 */
async function listAllFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listAllFiles(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function listTsFiles(dir) {
  return (await listAllFiles(dir)).filter((file) => file.endsWith(".ts"));
}

function withHeader(source, rel) {
  return HEADER.replace("{rel}", rel).replace("{commit}", CORE_COMMIT) + source;
}

async function main() {
  const files = (await listTsFiles(CORE_SRC)).filter(
    (file) => !isExcluded(relative(CORE_SRC, file)),
  );
  let drift = 0;

  if (!checkOnly) {
    await rm(TARGET, { recursive: true, force: true });
  }

  for (const file of files) {
    const rel = relative(CORE_SRC, file);
    const dest = join(TARGET, rel);
    const expected = withHeader(await readFile(file, "utf8"), rel);

    if (checkOnly) {
      let actual = "";
      try {
        actual = await readFile(dest, "utf8");
      } catch {
        actual = "";
      }
      if (withoutCommit(actual) !== withoutCommit(expected)) {
        console.error("[sync-core] drift:", relative(ROOT, dest));
        drift++;
      }
      continue;
    }

    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, expected, "utf8");
  }

  if (checkOnly) {
    // 反向校验：生成目录里不得残留已从 core 删除（或手加）的文件，
    // 否则它们会被 hvigor 编进 HAR，而 --check 逐文件比对永远发现不了。
    const expectedRel = new Set(files.map((file) => relative(CORE_SRC, file)));
    const actualRel = (await listAllFiles(TARGET)).map((file) =>
      relative(TARGET, file),
    );
    const extra = actualRel.filter((rel) => !expectedRel.has(rel));
    for (const rel of extra) {
      console.error("[sync-core] stale:", relative(ROOT, join(TARGET, rel)));
      drift++;
    }

    if (drift > 0) {
      console.error(
        `[sync-core] ${drift} file(s) out of sync. Run: bun run sync:core`,
      );
      process.exit(1);
    }
    console.log(`[sync-core] ok (${files.length} files)`);
    return;
  }
  console.log(
    `[sync-core] synced ${files.length} files -> ${relative(ROOT, TARGET)} (core@${CORE_COMMIT})`,
  );
}

main().catch((error) => {
  console.error("[sync-core]", error);
  process.exit(1);
});
