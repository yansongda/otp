/**
 * 零依赖基准计时器：warmup + R 轮重复取 min。
 *
 * 方法学（决定了数字能不能引用）：
 * - 主指标取 R 轮里的 **min**（对抗 GC / 调度抖动最稳），同时报 median / p95；
 * - p95/min > 3 视为本轮不可信，打 noisy 标记；
 * - 只允许「同机 + 同 bun 版本」做相对比较：JSC（bun）的数字不能外推到
 *   小程序 V8/JSCore 或 ohos ArkTS 运行时。
 */
import os from "node:os";

/** 防止 JIT 把被测调用当死代码删掉：结果只累加到 kept.digest，不进入报告。 */
const kept = { digest: 0 };

function keep(value) {
  if (typeof value === "number") {
    kept.digest ^= value;
  } else if (typeof value === "string") {
    kept.digest ^= value.length;
  } else if (value instanceof Uint8Array) {
    kept.digest ^= value.length;
  } else {
    kept.digest ^= 1;
  }
}

/** 环境指纹：跨机器/跨版本的快照不允许直接比较。 */
export function envFingerprint() {
  const cpus = os.cpus();
  return {
    bun: process.versions.bun ?? "unknown",
    platform: process.platform,
    arch: process.arch,
    cpu: cpus.length > 0 ? cpus[0].model.trim() : "unknown",
    cores: cpus.length,
  };
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index];
}

/**
 * 测一个场景。
 *
 * 迭代数不写死：先跑一段校准，估算单次耗时，再按 targetMs 反推迭代数。
 * 这样无论被测调用是 5ns 还是 100µs，每个场景耗时都稳定在 targetMs 量级，
 * 整轮总时长可预测（不会因为某台机器上 SHA512 慢 40 倍就跑成 2 分钟）。
 *
 * @param {(i: number) => unknown} fn 被测调用；i 是递变下标，用于换输入防 JIT 提升
 * @param {{ targetMs?: number, repeats?: number, minIters?: number, maxIters?: number }} options
 */
export function measure(
  fn,
  { targetMs = 50, repeats = 7, minIters = 500, maxIters = 5_000_000 } = {},
) {
  // 1) 校准：成倍放大批量，直到单批 >= 5ms 或达上限，得到单次耗时（ns）。
  let calibrateIters = 64;
  let nsPerOp = 1;
  for (;;) {
    const started = performance.now();
    for (let i = 0; i < calibrateIters; i++) {
      keep(fn(i));
    }
    const elapsed = performance.now() - started;
    if (elapsed >= 5 || calibrateIters >= maxIters) {
      nsPerOp = (elapsed * 1e6) / calibrateIters;
      break;
    }
    calibrateIters = Math.min(calibrateIters * 4, maxIters);
  }

  const targetIters = Math.round((targetMs * 1e6) / Math.max(nsPerOp, 1e-6));
  const iters = Math.min(maxIters, Math.max(minIters, targetIters));

  const warmIters = Math.max(500, Math.floor(iters / 5));
  for (let i = 0; i < warmIters; i++) {
    keep(fn(i));
  }

  const samples = [];
  for (let round = 0; round < repeats; round++) {
    const started = performance.now();
    for (let i = 0; i < iters; i++) {
      keep(fn(i));
    }
    samples.push((performance.now() - started) / iters);
  }
  samples.sort((a, b) => a - b);

  const minMs = samples[0];
  const p95Ms = percentile(samples, 0.95);
  return {
    iters,
    repeats,
    minMs,
    medianMs: percentile(samples, 0.5),
    p95Ms,
    usPerOp: minMs * 1000,
    opsPerSec: minMs > 0 ? 1000 / minMs : Infinity,
    noisy: minMs > 0 ? p95Ms / minMs > 3 : true,
  };
}

export function envLabel(env) {
  return `bun ${env.bun} / ${env.platform}-${env.arch} / ${env.cpu} (${env.cores} cores)`;
}

export function sameEnv(a, b) {
  return (
    a.bun === b.bun &&
    a.platform === b.platform &&
    a.arch === b.arch &&
    a.cpu === b.cpu
  );
}
