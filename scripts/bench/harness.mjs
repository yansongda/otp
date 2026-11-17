/**
 * 零依赖基准计时器：warmup + R 轮重复取 min。
 *
 * 方法学（决定了数字能不能引用）：
 * - 主指标取 R 轮里的 **min**（对抗 GC / 调度抖动最稳），同时报 median / p95；
 * - p95/min > 3 视为本轮不可信，打 noisy 标记；
 * - 只允许「同机 + 同 bun 版本」做相对比较：JSC（bun）的数字不能外推到
 *   小程序 V8/JSCore 或 ohos ArkTS 运行时。
 * - A/B 必须用 `measurePair` **交错**测：先跑完 A 再跑完 B 时，两边的测量落在
 *   不同时间窗，机器的热降频 / 后台负载会被误读成 improve 或 regress
 *   （实测出现过 base 侧单场景从 3.6µs 漂到 6.3µs 的假 improve）。
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
 * 校准：成倍放大批量直到单批 >= 5ms 或达上限，返回单次耗时（ns）。
 * 这样无论被测调用是 5ns 还是 100µs，每轮耗时都稳定在 targetMs 量级。
 */
function calibrateNs(fn, maxIters) {
  let batch = 64;
  for (;;) {
    const started = performance.now();
    for (let i = 0; i < batch; i++) {
      keep(fn(i));
    }
    const elapsed = performance.now() - started;
    if (elapsed >= 5 || batch >= maxIters) {
      return (elapsed * 1e6) / batch;
    }
    batch = Math.min(batch * 4, maxIters);
  }
}

function itersFor(targetMs, nsPerOp, minIters, maxIters) {
  const target = Math.round((targetMs * 1e6) / Math.max(nsPerOp, 1e-6));
  return Math.min(maxIters, Math.max(minIters, target));
}

/** 跑一轮并返回 ms/op。 */
function timeRound(fn, iters) {
  const started = performance.now();
  for (let i = 0; i < iters; i++) {
    keep(fn(i));
  }
  return (performance.now() - started) / iters;
}

function summarize(samples, iters, repeats) {
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

/**
 * 测单个场景（顺序测量，用于非 A/B 的基线表）。
 *
 * @param {(i: number) => unknown} fn 被测调用；i 是递变下标，用于换输入防 JIT 提升
 * @param {{ targetMs?: number, repeats?: number, minIters?: number, maxIters?: number }} options
 */
export function measure(
  fn,
  { targetMs = 50, repeats = 7, minIters = 500, maxIters = 5_000_000 } = {},
) {
  const iters = itersFor(
    targetMs,
    calibrateNs(fn, maxIters),
    minIters,
    maxIters,
  );
  const warmIters = Math.max(500, Math.floor(iters / 5));
  for (let i = 0; i < warmIters; i++) {
    keep(fn(i));
  }

  const samples = [];
  for (let round = 0; round < repeats; round++) {
    samples.push(timeRound(fn, iters));
  }
  return summarize(samples, iters, repeats);
}

/**
 * 交错测 A/B：每轮交替执行 A、B，并交替两者的先后顺序，各自取 min。
 *
 * 两侧必须用同一迭代数才公平，故按**较慢**一侧反推 iters
 * （否则快的一侧轮次太短，更容易被计时噪声污染）。
 *
 * @param {(i: number) => unknown} fnBase 旧实现
 * @param {(i: number) => unknown} fnHead 新实现
 */
export function measurePair(
  fnBase,
  fnHead,
  { targetMs = 50, repeats = 7, minIters = 500, maxIters = 5_000_000 } = {},
) {
  const nsBase = calibrateNs(fnBase, maxIters);
  const nsHead = calibrateNs(fnHead, maxIters);
  const iters = itersFor(
    targetMs,
    Math.max(nsBase, nsHead),
    minIters,
    maxIters,
  );

  const warmIters = Math.max(500, Math.floor(iters / 5));
  for (let i = 0; i < warmIters; i++) {
    keep(fnBase(i));
    keep(fnHead(i));
  }

  const samplesBase = [];
  const samplesHead = [];
  for (let round = 0; round < repeats; round++) {
    // 奇偶轮互换顺序，抵消「先跑的一侧占优（缓存/降频爬坡）」的系统偏差
    const baseFirst = round % 2 === 0;
    if (baseFirst) {
      samplesBase.push(timeRound(fnBase, iters));
      samplesHead.push(timeRound(fnHead, iters));
    } else {
      samplesHead.push(timeRound(fnHead, iters));
      samplesBase.push(timeRound(fnBase, iters));
    }
  }

  return {
    iters,
    base: summarize(samplesBase, iters, repeats),
    head: summarize(samplesHead, iters, repeats),
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
