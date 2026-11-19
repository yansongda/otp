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
const CORE_ERRORS = "../core/src/errors.ts";
const SECRET = "../core/src/secret.ts";

const BASELINE = {
  // 算法测试已迁至 packages/core（334 条）；本包只保留平台层契约测试
  testDeclarations: 19,
  testFiles: 1,
  errorCodeMembers: 22,
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

/**
 * 去掉注释 + 压缩空白后再匹配：结构类断言不得依赖 biome 的换行/缩进。
 * （早先直接匹配多行原文，一次格式化就会误报。）
 */
function squash(text) {
  return stripComments(text).replace(/\s+/g, " ");
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

check("源码禁止平台能力（wx.* / @kit.*）", () => {
  const hits = [];
  for (const rel of sourceFiles()) {
    const text = stripComments(readText(rel));
    if (/\bwx\s*\./.test(text)) hits.push(`${rel}(wx)`);
    // core 必须零平台：@kit 只允许出现在 ohos 的 CryptoSource.ets
    if (/from\s+["']@kit\./.test(text)) hits.push(`${rel}(@kit)`);
  }
  if (hits.length > 0) throw new Error(`发现平台 API：${hits.join(", ")}`);
  return "core / 平台层均无 wx / @kit 调用";
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

check(`错误码唯一来源：core 恰为 ${BASELINE.errorCodeMembers} 个成员`, () => {
  // 平台不再抄码表：mp 的 OtpErrorCode 必须从 core 复用，值集合只能有一份真源
  const core = stripComments(readText(CORE_ERRORS));
  const coreCodes = [...core.matchAll(/^\s{2}([A-Z0-9_]+):\s*"\1",$/gm)].map(
    (m) => m[1],
  );
  if (coreCodes.length !== BASELINE.errorCodeMembers) {
    throw new Error(
      `core 实际 ${coreCodes.length} 个；错误码集合仅允许新增，且必须显式调整基线`,
    );
  }

  // 扫平台全部 src（不止 errors.ts）：任何文件再"NAME: "NAME","的形式抄一份码表都要拦住。
  // 只按 core 码名匹配，避免误伤 OtpAlgorithm 这类同形但不同义的常量表。
  const codeSet = new Set(coreCodes);
  const redeclared = [];
  for (const file of listFiles(join(REPO_ROOT, SRC_DIR))) {
    if (!file.endsWith(".ts")) continue;
    const rel = toPosix(relative(REPO_ROOT, file));
    const text = stripComments(readFileSync(file, "utf8"));
    const hits = [
      ...text.matchAll(/^\s{2}([A-Z0-9_]+):\s*"([A-Z0-9_]+)",$/gm),
    ].filter((m) => codeSet.has(m[1]));
    if (hits.length > 0) redeclared.push(`${rel}(${hits.length})`);
  }
  if (redeclared.length > 0) {
    throw new Error(
      `平台源码又声明了错误码：${redeclared.join(", ")}；必须从 @yansongda/otp-core 复用`,
    );
  }
  if (
    !/OtpErrorCode.*from\s+"@yansongda\/otp-core"/.test(
      stripComments(readText(ERRORS)),
    )
  ) {
    throw new Error("src/errors.ts 未从 @yansongda/otp-core 导入 OtpErrorCode");
  }
  return `${coreCodes.length} 个（core 单源，平台零重复）`;
});

check("verify DTO 唯一来源：core", () => {
  // 平台不再手写 verify 选项：三个 DTO 必须从 core 转发（否则 HOTP/TOTP 收窄会漂移）
  const text = stripComments(readText("src/types.ts"));
  const redeclared = (
    text.match(
      /interface\s+(VerifyOptions|HotpVerifyOptions|TotpVerifyOptions)\b/g,
    ) || []
  ).length;
  if (redeclared !== 0) {
    throw new Error(
      `src/types.ts 又声明了 ${redeclared} 个 verify DTO；必须从 @yansongda/otp-core 转发`,
    );
  }
  if (
    !/export type\s*\{[^}]*HotpVerifyOptions[^}]*\}\s*from\s+"@yansongda\/otp-core"/.test(
      text,
    )
  ) {
    throw new Error("src/types.ts 未从 @yansongda/otp-core 转发 verify DTO");
  }
  return "3 个 verify DTO 转发自 core";
});

check("MAX_VERIFY_WINDOW 以值形式随 barrel 导出", () => {
  // 只匹配 `export { MAX_VERIFY_WINDOW } from "@yansongda/otp-core"`：
  // 写成 export type 时调用方拿不到值，运行时 MAX_VERIFY_WINDOW 为 undefined。
  if (
    !/export\s*\{\s*MAX_VERIFY_WINDOW\s*\}\s*from\s+"@yansongda\/otp-core"/.test(
      stripComments(readText(BARREL)),
    )
  ) {
    throw new Error("src/index.ts 未以值形式导出 MAX_VERIFY_WINDOW");
  }
  return "barrel 导出窗口上限常量（值语义）";
});

check('OtpError 设置 name = "OtpError"', () => {
  // provider 错误契约靠 name 判定（engine 只兜未知错误）；不得删除
  if (!/this\.name\s*=\s*"OtpError"/.test(stripComments(readText(ERRORS)))) {
    throw new Error('OtpError 未设置 this.name = "OtpError"');
  }
  return "provider 错误契约的 name 已固定";
});

check('core OtpError 设置 name = "OtpError"', () => {
  // core 默认类同样靠 name 参与 engine 的错误判别；删掉会让未注册工厂场景漏出原始错误
  if (
    !/this\.name\s*=\s*"OtpError"/.test(stripComments(readText(CORE_ERRORS)))
  ) {
    throw new Error('core OtpError 未设置 this.name = "OtpError"');
  }
  return "core / 平台两侧 name 契约一致";
});

check("原型修复只在原型退化时执行（core / mp 条件一致）", () => {
  // 无条件 setPrototypeOf 会把原生子类实例的原型改回基类；两处实现必须保持同一条件。
  // 用 squash() 消除换行/缩进差异，参数名用反向引用自校验（改名不会误报）。
  const core = squash(readText(CORE_ERRORS));
  const platform = squash(readText(ERRORS));
  const coreGuard =
    /function repairPrototypeIfDegraded\(\s*([A-Za-z_$][\w$]*): object\s*\): void \{\s*if \(Object\.getPrototypeOf\(\1\) === Error\.prototype\)\s*\{/.test(
      core,
    );
  const platformGuard =
    /if \(Object\.getPrototypeOf\(([A-Za-z_$][\w$]*)\) === Error\.prototype\) \{\s*Object\.setPrototypeOf\(\1, OtpError\.prototype\)\s*;?/.test(
      platform,
    );
  if (!coreGuard || !platformGuard) {
    throw new Error(
      "原型修复不再只是「退化为 Error.prototype 时」执行（会破坏子类原型链）；" +
        `core=${coreGuard} mp=${platformGuard}（若只是重命名/重构，请同步本守卫）`,
    );
  }
  return "core / mp 两处条件一致（格式无关）";
});

check("barrel 不使用 as unknown as 整体断言", () => {
  // 整体断言会吞掉 core 的签名漂移：barrel 只允许窄化的 `as`（如 parse 返回值投影、
  // 错误码字符串 → 平台字面量联合），不允许「先擦成 unknown 再断言成别的形状」。
  // 不限定变量名/换行，避免换个写法就绕过。
  const text = stripComments(readText(BARREL));
  if (/as\s+unknown\s+as/.test(text)) {
    throw new Error(
      "src/index.ts 出现 as unknown as 整体断言；请改为显式 wrapper 或窄化断言",
    );
  }
  return "无 as unknown as（仅窄化断言）";
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
  const version = readText("../../.bun-version").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`.bun-version 格式非法：${JSON.stringify(version)}`);
  }
  const ci = readText("../../.github/workflows/ci.yml");
  if (!/bun-version-file:\s*\.bun-version/.test(ci)) {
    throw new Error("主 CI 未使用 bun-version-file: .bun-version");
  }
  if (!/bun-version:\s*latest/.test(ci)) {
    throw new Error("缺少 Bun latest 兼容任务");
  }
  return `Bun ${version} + latest compat`;
});

check("发布脚本、release skill 与 release-miniprogram.yml 存在", () => {
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
  const skill = readText("../../.agents/skills/release-miniprogram/SKILL.md");
  if (!/^name:\s*release-miniprogram\s*$/m.test(skill)) {
    throw new Error("release skill 缺少 name: release-miniprogram");
  }
  if (!/^description:/m.test(skill)) {
    throw new Error("release skill 缺少 description");
  }
  if (!/docs\/evidence\//.test(readText(".gitignore"))) {
    throw new Error(".gitignore 未忽略 docs/evidence/");
  }
  const release = readText("../../.github/workflows/release-miniprogram.yml");
  if (!/tags:\s*\["miniprogram-v\*"\]/.test(release)) {
    throw new Error("release-miniprogram.yml 必须由 tag miniprogram-v* 触发");
  }
  if (!/id-token:\s*write/.test(release)) {
    throw new Error("release-miniprogram.yml 缺少 id-token: write（OIDC）");
  }
  if (!/npm publish[^\n]*--provenance/.test(release)) {
    throw new Error("release-miniprogram.yml 缺少 npm publish --provenance");
  }
  if (!/npm publish[^\n]*--ignore-scripts/.test(release)) {
    throw new Error(
      "release-miniprogram.yml 的 npm publish 必须带 --ignore-scripts（避免重复 prepublishOnly）",
    );
  }
  if (!/release:check/.test(release)) {
    throw new Error("release-miniprogram.yml 必须在发布前运行 release:check");
  }
  if (/NPM_TOKEN|NODE_AUTH_TOKEN/.test(release)) {
    throw new Error(
      "release-miniprogram.yml 不得使用 NPM_TOKEN / NODE_AUTH_TOKEN",
    );
  }
  return "release:check + release skill + release-miniprogram.yml OIDC + evidence ignore";
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
