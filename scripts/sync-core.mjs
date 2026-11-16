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
/** ohos 不需要纯 JS 兜底 crypto；且 hvigor 会编译模块内全部 .ts，必须排除以免进 HAR。 */
const EXCLUDED = ["pure-js", "pure-js.ts"];
const TARGET = join(ROOT, "packages/ohos-otp/library/src/main/ets/core");
/**
 * 副本头：`core@<commit>` 是「最后一次改动 packages/core/src 的 commit」，用于溯源。
 * 为什么不用 HEAD：只改平台层的 commit 不应让全部副本看起来失同步（--check 会误报）。
 */
const HEADER =
  "// AUTO-GENERATED from packages/core/src/{rel} (core@{commit}). DO NOT EDIT. Run: bun run sync:core\n";

/** 取最后一次改动 core 源码的 commit；工作区有未提交的 core 改动时加 `-dirty` 标记。 */
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
      git("log", "-1", "--format=%h", "--", "packages/core/src") ||
      git("rev-parse", "--short", "HEAD");
  } catch {
    // 无 git / shallow 时不阻断同步
  }
  try {
    if (git("status", "--porcelain", "--", "packages/core/src")) {
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
  return EXCLUDED.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
}

async function listTsFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listTsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      const rel = relative(CORE_SRC, full);
      if (!isExcluded(rel)) {
        out.push(full);
      }
    }
  }
  return out;
}

function withHeader(source, rel) {
  return HEADER.replace("{rel}", rel).replace("{commit}", CORE_COMMIT) + source;
}

async function main() {
  const files = await listTsFiles(CORE_SRC);
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
