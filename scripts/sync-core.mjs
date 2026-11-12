#!/usr/bin/env node
/**
 * core -> ohos library 的源码副本同步。
 *
 * 为什么需要副本：ohos 的 HAR 必须是模块内源码（`src/main/ets/**`），且 hvigor 不支持跨模块
 * 打包；用 HAR 依赖会带来「源码 HAR 重复编入 / 字节码 HAR 破坏 local test」两种债。
 *
 * 用法：
 *   node scripts/sync-core.mjs          # 写入副本（带 GENERATED 头）
 *   node scripts/sync-core.mjs --check  # 只校验，不一致则退出码 1（CI 用）
 */
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CORE_SRC = join(ROOT, "packages/core/src");
const TARGET = join(ROOT, "packages/ohos-otp/library/src/main/ets/core");
const HEADER =
  "// AUTO-GENERATED from packages/core/src/{rel}. DO NOT EDIT. Run: bun run sync:core\n";

const checkOnly = process.argv.includes("--check");

async function listTsFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listTsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function withHeader(source, rel) {
  const header = HEADER.replace("{rel}", rel);
  return header + source;
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
      if (actual !== expected) {
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
  console.log(`[sync-core] synced ${files.length} files -> ${relative(ROOT, TARGET)}`);
}

main().catch((error) => {
  console.error("[sync-core]", error);
  process.exit(1);
});
