#!/usr/bin/env node
/**
 * 发布物体积守卫：`dist/` 是真正被打进小程序包的东西，体积回归没有别的信号。
 * 运行前需先执行 `bun run build`（与 `smoke:dist` 同一前置）。
 *
 * 为什么同时门「未压缩」与「gzip」：
 * - 未压缩 = 开发者工具「上传时压缩」关闭时的实际字节；
 * - gzip = 上传压缩后的近似值（gzip -9，比多数线上压缩略保守）。
 * 两个口径都会随代码增长，只门一个会漏掉另一侧的膨胀。
 *
 * 门槛只允许下调时直接改 LIMITS；上调必须在 PR 里说明理由
 * （与 ohos 覆盖率门槛 `COVERAGE_MAX_UNCOVERED` 同一约定）。
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * 体积上限（字节）。基线（2026-11-20，bun 1.4.5 / darwin-x64）：
 * dist/index.js 65,360 B / gzip 23.0 KB；dist/index.d.ts 18,270 B / gzip 6.8 KB。
 */
const LIMITS = [
  { file: "index.js", maxGzip: 25_000, maxRaw: 70_000 },
  { file: "index.d.ts", maxGzip: 8_000, maxRaw: 20_000 },
];

const kb = (bytes) => `${(bytes / 1000).toFixed(1)} KB`;
const failures = [];
const rows = [];

for (const { file, maxRaw, maxGzip } of LIMITS) {
  const path = join(root, "dist", file);
  if (!existsSync(path)) {
    failures.push(`缺少 ${path}，请先执行 bun run build`);
    continue;
  }
  const raw = readFileSync(path);
  const rawSize = raw.length;
  const gzipSize = gzipSync(raw, { level: 9 }).length;
  rows.push(
    `${file}  未压缩 ${kb(rawSize)} / ${kb(maxRaw)}  gzip ${kb(gzipSize)} / ${kb(maxGzip)}`,
  );
  if (rawSize > maxRaw) {
    failures.push(`${file} 未压缩 ${rawSize} B 超过上限 ${maxRaw} B`);
  }
  if (gzipSize > maxGzip) {
    failures.push(`${file} gzip ${gzipSize} B 超过上限 ${maxGzip} B`);
  }
}

for (const row of rows) {
  console.log(`体积  ${row}`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const body = rows.map((row) => `- \`${row}\``).join("\n");
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### 发布物体积\n\n${body}\n`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`体积守卫失败：${failure}`);
  }
  process.exit(1);
}
