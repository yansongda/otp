#!/usr/bin/env bun
/**
 * core 热路径基准 CLI。
 *
 * 用法：
 *   bun run bench                                # 打印表格
 *   bun run bench -- --json                      # 机器可读（只输出 JSON 到 stdout）
 *   bun run bench -- --filter hmac               # 只跑名字含 hmac 的场景
 *   bun run bench -- --save /tmp/base.json       # 存快照（含环境指纹）
 *   bun run bench -- --compare /tmp/base.json    # 与本机快照比，标出 regress/improve
 *   bun run bench -- --ab main                   # 临时 worktree 检出 main，A/B 对比
 *
 * 可引用性边界（务必读）：
 * - 只能「同机 + 同 bun 版本」比较；跨机器 / 跨版本的绝对数字没有意义，
 *   `--compare` 与 `--ab` 遇到指纹不一致会告警。
 * - bun 跑在 JSC 上，结论不外推到小程序 V8/JSCore，更不外推到 ohos ArkTS 运行时；
 *   合理用法是同引擎下比较两版实现的**相对**快慢。
 * - 单行偶发抖动用 min-of-R + p95/min 的 noisy 标记过滤，不要用单轮数字下结论。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { envFingerprint, envLabel, measure, sameEnv } from "./harness.mjs";
import { CORE_DIR, loadScenarios } from "./scenarios.mjs";

const SELF = fileURLToPath(import.meta.url);
const HELP = `otp bench — core 热路径基准

用法
  bun run bench [选项]
  bun run bench -- --ab [<ref>]        与某个 git 版本 A/B（默认 main，临时 worktree）

选项
  --json                 只向 stdout 输出 JSON（表头/告警走 stderr）
  --filter <substr>      只跑名字包含该子串的场景
  --save <file>          把本轮结果（含环境指纹）写入 JSON
  --compare <file>       与已有 JSON 快照比较
  --ab [<ref>]           git worktree 检出 <ref> 跑一轮，再跑当前工作区，输出对比表
  --threshold <pct>      判定 regress/improve 的阈值，默认 15（%）
  --fail-on-regress      --compare / --ab 出现 regress 时退出码 1（CI 可选）
  -h, --help             本帮助
`;

function parseArgs(argv) {
  const options = {
    json: false,
    filter: undefined,
    save: undefined,
    compare: undefined,
    ab: undefined,
    abRequested: false,
    threshold: 15,
    failOnRegress: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--fail-on-regress") {
      options.failOnRegress = true;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--ab") {
      options.abRequested = true;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        options.ab = next;
        i++;
      } else {
        options.ab = "main";
      }
    } else if (arg === "--filter") {
      options.filter = argv[++i];
    } else if (arg === "--save") {
      options.save = argv[++i];
    } else if (arg === "--compare") {
      options.compare = argv[++i];
    } else if (arg === "--threshold") {
      options.threshold = Number(argv[++i]);
    } else {
      throw new Error(`未知参数：${arg}（用 --help 查看用法）`);
    }
  }
  return options;
}

function formatOps(value) {
  if (value >= 1e6) {
    return `${(value / 1e6).toFixed(2)}M`;
  }
  if (value >= 1e3) {
    return `${(value / 1e3).toFixed(1)}k`;
  }
  return value.toFixed(0);
}

function pad(text, width) {
  return text.padEnd(width);
}

function padStart(text, width) {
  return text.padStart(width);
}

async function runBench({ filter }) {
  const { scenarios, skipped } = await loadScenarios();
  const selected =
    filter === undefined
      ? scenarios
      : scenarios.filter((scenario) => scenario.name.includes(filter));

  if (selected.length === 0) {
    const reason =
      skipped.length > 0 ? `（加载失败：${skipped.join("；")}）` : "";
    throw new Error(
      `没有匹配的场景${filter === undefined ? "" : `（filter=${filter}）`}${reason}`,
    );
  }

  const results = [];
  for (const scenario of selected) {
    const stats = measure(scenario.run, { targetMs: scenario.targetMs });
    results.push({
      group: scenario.group,
      name: scenario.name,
      ...stats,
    });
  }

  return {
    tool: "otp-bench",
    createdAt: new Date().toISOString(),
    coreDir: CORE_DIR,
    env: envFingerprint(),
    results,
    skipped,
  };
}

function printTable(payload, startedAt) {
  const nameWidth = Math.max(...payload.results.map((r) => r.name.length), 8);
  const groupWidth = Math.max(...payload.results.map((r) => r.group.length), 5);
  console.log(`\notp bench — ${envLabel(payload.env)}`);
  console.log(`core: ${payload.coreDir}\n`);
  console.log(
    `${pad("group", groupWidth)}  ${pad("scenario", nameWidth)}  ${padStart("iters", 8)}  ${padStart("µs/op", 8)}  ${padStart("ops/s", 7)}  ${padStart("p95/min", 7)}`,
  );
  for (const row of payload.results) {
    const noisy = row.noisy ? " !noisy" : "";
    console.log(
      `${pad(row.group, groupWidth)}  ${pad(row.name, nameWidth)}  ${padStart(String(row.iters), 8)}  ${padStart(row.usPerOp.toFixed(3), 8)}  ${padStart(formatOps(row.opsPerSec), 7)}  ${padStart((row.p95Ms / row.minMs).toFixed(2), 7)}${noisy}`,
    );
  }
  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\n${payload.results.length} scenarios in ${elapsed}s` +
      (payload.skipped.length > 0
        ? `（跳过 ${payload.skipped.length} 组：${payload.skipped.join("；")}）`
        : ""),
  );
  if (payload.results.some((row) => row.noisy)) {
    console.log("!noisy = p95/min > 3，该行本轮不可引用，重跑或换空闲机器");
  }
}

function indexByName(payload) {
  const map = new Map();
  for (const row of payload.results) {
    map.set(row.name, row);
  }
  return map;
}

function comparePayloads(base, head, threshold) {
  const baseIndex = indexByName(base);
  const rows = [];
  for (const row of head.results) {
    const previous = baseIndex.get(row.name);
    if (previous === undefined) {
      rows.push({ name: row.name, base: null, head: row, ratio: null });
      continue;
    }
    rows.push({
      name: row.name,
      base: previous,
      head: row,
      ratio: row.usPerOp / previous.usPerOp,
    });
  }
  const regressed = rows.filter(
    (row) => row.ratio !== null && row.ratio > 1 + threshold / 100,
  );
  const improved = rows.filter(
    (row) => row.ratio !== null && row.ratio < 1 - threshold / 100,
  );
  return { rows, regressed, improved };
}

function printComparison({ rows, regressed, improved }, threshold, baseLabel) {
  const nameWidth = Math.max(...rows.map((row) => row.name.length), 8);
  console.log(`\notp bench compare — base: ${baseLabel}\n`);
  console.log(
    `${pad("scenario", nameWidth)}  ${padStart("base µs", 9)}  ${padStart("head µs", 9)}  ${padStart("ratio", 7)}  verdict`,
  );
  for (const row of rows) {
    if (row.ratio === null) {
      console.log(
        `${pad(row.name, nameWidth)}  ${padStart("—", 9)}  ${padStart(row.head.usPerOp.toFixed(3), 9)}  ${padStart("—", 7)}  base 无此项`,
      );
      continue;
    }
    const ratio = row.ratio;
    let verdict = "same";
    if (ratio > 1 + threshold / 100) {
      verdict = `REGRESS +${((ratio - 1) * 100).toFixed(1)}%`;
    } else if (ratio < 1 - threshold / 100) {
      verdict = `improve ${((ratio - 1) * 100).toFixed(1)}%`;
    }
    const noisy = row.head.noisy || row.base?.noisy === true ? " !noisy" : "";
    console.log(
      `${pad(row.name, nameWidth)}  ${padStart(row.base.usPerOp.toFixed(3), 9)}  ${padStart(row.head.usPerOp.toFixed(3), 9)}  ${padStart(`${ratio.toFixed(2)}x`, 7)}  ${verdict}${noisy}`,
    );
  }

  const comparable = rows.filter((row) => row.ratio !== null);
  if (comparable.length > 0) {
    const geo = Math.exp(
      comparable.reduce((sum, row) => sum + Math.log(row.ratio), 0) /
        comparable.length,
    );
    console.log(
      `\n几何均值 ratio = ${geo.toFixed(3)}x（<1 表示 head 更快）｜${regressed.length} regress / ${improved.length} improve（阈值 ±${threshold}%）`,
    );
  }
}

function sanitize(ref) {
  return ref.replace(/[^A-Za-z0-9._-]/g, "_");
}

function git(args, { allowFail = false } = {}) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (!allowFail && result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} 失败：${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result;
}

/** 子进程跑一轮 bench，通过 OTP_BENCH_CORE 指向某个 core 源码目录。 */
function runChild(coreDir, filter) {
  const args = [SELF, "--json"];
  if (filter !== undefined) {
    args.push("--filter", filter);
  }
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, OTP_BENCH_CORE: coreDir, NO_COLOR: "1" },
  });
  if (result.status !== 0) {
    throw new Error(
      `bench 子进程失败（core=${coreDir}）：${(result.stderr || result.stdout).trim()}`,
    );
  }
  return JSON.parse(result.stdout);
}

async function runAB({ ab, filter, threshold, failOnRegress }) {
  const ref = ab ?? "main";
  const worktree = join(tmpdir(), `otp-bench-${sanitize(ref)}-${process.pid}`);
  git(["worktree", "add", "--detach", "--force", worktree, ref]);
  try {
    const baseCore = join(worktree, "packages/core/src");
    const base = runChild(baseCore, filter);
    const head = await runBench({ filter });
    if (!sameEnv(base.env, head.env)) {
      console.error(
        "警告：base 与 head 环境指纹不一致（跨机器或跨 bun 版本），比值不可引用",
      );
    }
    const comparison = comparePayloads(base, head, threshold);
    printComparison(comparison, threshold, `${ref} @ ${envLabel(base.env)}`);
    if (comparison.rows.some((row) => row.head.noisy)) {
      console.log("!noisy = p95/min > 3，该行本轮不可引用");
    }
    return failOnRegress && comparison.regressed.length > 0 ? 1 : 0;
  } finally {
    git(["worktree", "remove", "--force", worktree], { allowFail: true });
    git(["worktree", "prune"], { allowFail: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  if (options.abRequested) {
    return runAB(options);
  }

  const startedAt = performance.now();
  const payload = await runBench({ filter: options.filter });

  if (options.save !== undefined) {
    writeFileSync(options.save, `${JSON.stringify(payload, null, 2)}\n`);
    console.error(`已写入快照：${options.save}`);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printTable(payload, startedAt);
  }

  if (options.compare === undefined) {
    return 0;
  }

  const base = JSON.parse(readFileSync(options.compare, "utf8"));
  if (!sameEnv(base.env, payload.env)) {
    console.error(
      "警告：快照与当前环境指纹不一致（跨机器或跨 bun 版本），比值不可引用",
    );
  }
  const comparison = comparePayloads(base, payload, options.threshold);
  printComparison(comparison, options.threshold, options.compare);
  if (options.failOnRegress && comparison.regressed.length > 0) {
    return 1;
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`bench 失败：${error?.message ?? error}`);
    process.exitCode = 1;
  });
