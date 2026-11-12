#!/usr/bin/env node
/**
 * 仓库不变量守卫（零依赖；本地与 CI 共用）。
 *
 * 目标：把「算法库安全/契约不变量」从口头约定变成可执行检查。
 * 任一违规以 exit 1 失败。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC_DIR = "src";
const TESTS_DIR = "tests";
const BARREL = "src/index.ts";
const ERRORS = "src/errors.ts";
const SECRET = "../core/src/secret.ts";

const BASELINE = {
  // 算法测试已迁至 packages/core（242 条）；本包只保留平台层契约测试
  testDeclarations: 9,
  testFiles: 1,
  errorCodeMembers: 18,
};

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);

function toPosix(p) {
  return p.split(sep).join("/");
}

function listFiles(absDir) {
  const out = [];
  if (!statSync(absDir, { throwIfNoEntry: false })) {
    return out;
  }
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(absDir);
  return out;
}

function readText(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), "utf8");
}

/** 去掉注释后再做静态检查，避免文档里提到的禁用词误报。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function sourceFiles() {
  // 不变量检查同时覆盖平台层与共享 core（算法实现已移入 packages/core）
  return [
    ...listFiles(join(REPO_ROOT, SRC_DIR)),
    ...listFiles(join(REPO_ROOT, "../core/src")),
  ]
    .filter((f) => f.endsWith(".ts"))
    .map((f) => toPosix(relative(REPO_ROOT, f)));
}

function testFiles() {
  return listFiles(join(REPO_ROOT, TESTS_DIR))
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => toPosix(relative(REPO_ROOT, f)));
}

function countTestDeclarations() {
  let total = 0;
  for (const rel of testFiles()) {
    total += (readText(rel).match(/^[ \t]*(?:test|it)\(/gm) || []).length;
  }
  return total;
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check("源码禁止 BigInt（SHA-512 使用 hi/lo 半字）", () => {
  const hits = [];
  for (const rel of sourceFiles()) {
    if (/BigInt/.test(stripComments(readText(rel)))) hits.push(rel);
  }
  if (hits.length > 0) throw new Error(`发现 BigInt：${hits.join(", ")}`);
  return `${sourceFiles().length} 个源码文件`;
});

check("源码禁止 console.*（库内零日志）", () => {
  const hits = [];
  for (const rel of sourceFiles()) {
    if (/\bconsole\s*\./.test(stripComments(readText(rel)))) hits.push(rel);
  }
  if (hits.length > 0) throw new Error(`发现日志调用：${hits.join(", ")}`);
  return "无输出语句";
});

check("源码禁止 wx.*（平台能力不得进入核心）", () => {
  const hits = [];
  for (const rel of sourceFiles()) {
    if (/\bwx\s*\./.test(stripComments(readText(rel)))) hits.push(rel);
  }
  if (hits.length > 0) throw new Error(`发现 wx 调用：${hits.join(", ")}`);
  return "核心平台无关";
});

check("源码禁止 node: 内置模块与 padStart", () => {
  const hits = [];
  for (const rel of sourceFiles()) {
    const text = stripComments(readText(rel));
    if (/from\s+["']node:/.test(text) || /\.padStart\s*\(/.test(text)) {
      hits.push(rel);
    }
  }
  if (hits.length > 0) throw new Error(`发现不可移植 API：${hits.join(", ")}`);
  return "仅使用可移植 API";
});

check("barrel 不导出 internal/*", () => {
  const text = readText(BARREL);
  if (/export\s*(type\s*)?\{?[^;]*from\s*["']\.\/internal\//.test(text)) {
    throw new Error("src/index.ts 导出了 internal/*");
  }
  return "src/index.ts 为唯一公开入口";
});

check("barrel 导入并注册 pure-js provider 与错误工厂", () => {
  const text = readText(BARREL);
  if (
    !/installPureJsHmac/.test(text) ||
    !/installPureJsHmac\s*\(\s*\)/.test(text)
  ) {
    throw new Error("src/index.ts 未在导入时注册纯 JS HMAC provider");
  }
  if (!/setErrorFactory\s*\(/.test(text)) {
    throw new Error("src/index.ts 未注册平台错误工厂");
  }
  return "provider + 错误工厂零配置注册";
});

check("Secret 不得实现 toString()", () => {
  const text = stripComments(readText(SECRET));
  if (/toString\s*\(/.test(text)) {
    throw new Error("Secret 实现了 toString()，可能泄漏密钥");
  }
  return "toJSON() 脱敏保留";
});

check(`OtpErrorCode 恰为 ${BASELINE.errorCodeMembers} 个成员`, () => {
  const text = stripComments(readText(ERRORS));
  const count = (text.match(/^\s{2}[A-Z0-9_]+\s*:\s*"[A-Z0-9_]+",$/gm) || [])
    .length;
  if (count !== BASELINE.errorCodeMembers) {
    throw new Error(
      `实际 ${count} 个；错误码集合自 v1 冻结，仅允许显式调整基线`,
    );
  }
  return `${count} 个错误码`;
});

check("零运行时依赖", () => {
  const pkg = JSON.parse(readText("package.json"));
  const deps = pkg.dependencies || {};
  if (Object.keys(deps).length > 0) {
    throw new Error(`dependencies 非空：${Object.keys(deps).join(", ")}`);
  }
  return "dependencies = {}";
});

check("package 入口字段指向 dist", () => {
  const pkg = JSON.parse(readText("package.json"));
  const expected = {
    main: "dist/index.js",
    types: "dist/index.d.ts",
    miniprogram: "dist",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (pkg[key] !== value)
      throw new Error(`${key} 应为 ${value}，实际 ${pkg[key]}`);
  }
  if (!Array.isArray(pkg.files) || !pkg.files.includes("dist")) {
    throw new Error("files 未包含 dist");
  }
  if (pkg.sideEffects !== true) {
    throw new Error("sideEffects 必须为 true（barrel 导入会注册 provider）");
  }
  return "CJS + d.ts + 微信目录";
});

check("版本号与 CHANGELOG 首条一致", () => {
  const pkg = JSON.parse(readText("package.json"));
  const heading = /^##\s+\[?([0-9]+\.[0-9]+\.[0-9]+)\]?/m.exec(
    readText("CHANGELOG.md"),
  )?.[1];
  if (!heading) throw new Error("CHANGELOG.md 缺少版本标题");
  if (pkg.version !== heading) {
    throw new Error(
      `package.json 为 ${pkg.version}，CHANGELOG 首条为 ${heading}`,
    );
  }
  return `v${pkg.version}`;
});

check("README / README-cn 声明 npm 安装命令", () => {
  for (const readme of ["README.md", "README-cn.md"]) {
    if (!readText(readme).includes("npm install @yansongda/miniprogram-otp")) {
      throw new Error(`${readme} 缺少 npm install @yansongda/miniprogram-otp`);
    }
  }
  return "安装命令一致";
});

check(
  `测试数量不减少（声明 ≥ ${BASELINE.testDeclarations}，文件 ≥ ${BASELINE.testFiles}）`,
  () => {
    const declarations = countTestDeclarations();
    const files = testFiles().length;
    if (declarations < BASELINE.testDeclarations) {
      throw new Error(
        `test 声明 ${declarations} < ${BASELINE.testDeclarations}`,
      );
    }
    if (files < BASELINE.testFiles) {
      throw new Error(`测试文件 ${files} < ${BASELINE.testFiles}`);
    }
    return `${declarations} 声明 / ${files} 文件`;
  },
);

check("禁止重新引入第三方 OTP / vendor 产物", () => {
  const pkgText = readText("package.json");
  if (/vendor\/otpauth|otpauth\.esm|"otpauth"\s*:/.test(pkgText)) {
    throw new Error("package.json 含第三方 OTP 依赖");
  }
  for (const rel of sourceFiles()) {
    if (
      /vendor\/otpauth|otpauth\.esm|\bfrom\s+["']otpauth["']/.test(
        readText(rel),
      )
    ) {
      throw new Error(`${rel} 引用了第三方 OTP`);
    }
  }
  return "自研实现";
});

check(".bun-version 固定且 CI 使用版本文件", () => {
  const version = readText(".bun-version").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`.bun-version 格式非法：${JSON.stringify(version)}`);
  }
  const ci = readText(".github/workflows/ci.yml");
  if (!/bun-version-file:\s*\.bun-version/.test(ci)) {
    throw new Error("主 CI 未使用 bun-version-file: .bun-version");
  }
  if (!/bun-version:\s*latest/.test(ci)) {
    throw new Error("缺少 Bun latest 兼容任务");
  }
  return `Bun ${version} + latest compat`;
});

check("发布脚本、release skill 与 release.yml 存在", () => {
  const pkg = JSON.parse(readText("package.json"));
  const scripts = pkg.scripts || {};
  for (const key of [
    "release:check",
    "prepublishOnly",
    "pack",
    "test:coverage",
  ]) {
    if (typeof scripts[key] !== "string" || scripts[key].length === 0) {
      throw new Error(`package.json 缺少 scripts.${key}`);
    }
  }
  if (!scripts.prepublishOnly.includes("release:check")) {
    throw new Error("prepublishOnly 必须调用 release:check");
  }
  const skill = readText(".agents/skills/release/SKILL.md");
  if (!/^name:\s*release\s*$/m.test(skill)) {
    throw new Error("release skill 缺少 name: release");
  }
  if (!/^description:/m.test(skill)) {
    throw new Error("release skill 缺少 description");
  }
  if (!/docs\/evidence\//.test(readText(".gitignore"))) {
    throw new Error(".gitignore 未忽略 docs/evidence/");
  }
  const release = readText(".github/workflows/release.yml");
  if (!/tags:\s*\["v\*"\]/.test(release)) {
    throw new Error("release.yml 必须由 tag v* 触发");
  }
  if (!/id-token:\s*write/.test(release)) {
    throw new Error("release.yml 缺少 id-token: write（OIDC）");
  }
  if (!/npm publish[^\n]*--provenance/.test(release)) {
    throw new Error("release.yml 缺少 npm publish --provenance");
  }
  if (!/npm publish[^\n]*--ignore-scripts/.test(release)) {
    throw new Error(
      "release.yml 的 npm publish 必须带 --ignore-scripts（避免重复 prepublishOnly）",
    );
  }
  if (!/release:check/.test(release)) {
    throw new Error("release.yml 必须在发布前运行 release:check");
  }
  if (/NPM_TOKEN|NODE_AUTH_TOKEN/.test(release)) {
    throw new Error("release.yml 不得使用 NPM_TOKEN / NODE_AUTH_TOKEN");
  }
  return "release:check + release skill + release.yml OIDC + evidence ignore";
});

console.log(`\n仓库不变量检查：${toPosix(REPO_ROOT)}\n`);
let failed = 0;
for (const c of checks) {
  try {
    const detail = c.fn();
    console.log(`  ✓ ${c.name}${detail ? `  —  ${detail}` : ""}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${c.name}  —  ${error.message}`);
  }
}
console.log(
  `\n${checks.length - failed}/${checks.length} 通过${failed ? `，${failed} 项失败` : ""}\n`,
);
process.exit(failed ? 1 : 0);
