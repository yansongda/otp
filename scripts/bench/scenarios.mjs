/**
 * 场景表：core 四条链路（pure-js crypto / internal / 公开门面 / otpauth URI）的固定输入压测。
 *
 * 方法学要点：
 * - 每个场景签名是 `run(i)`，用 i 轮流换输入（不同 message / secret / counter / timestamp）。
 *   这不是为了"更真实"，而是**必需**：常量入参的纯函数会被 JIT 提出循环
 *   （实测 `format(123456789, 8)` 常量调用会掉到 2ns/op 的假数字）。
 * - 输入池全部在模块加载时预分配，测到的只有被测调用的成本；
 * - 迭代数不写死，由 harness 按 targetMs 校准（见 harness.mjs），慢场景自动少跑；
 * - 场景以 `createScenarios(coreDir)` 工厂形式导出：`--ab` 需要在**同一个进程**里
 *   同时加载新旧两套 core（绝对路径不同 → 两个独立模块实例），交错测量才成立；
 * - 只 import `<coreDir>/**` 的公开或 internal 稳定入口，不碰平台包；
 * - 旧版本缺少某个模块时整组跳过，不中断整轮。
 *
 * 注意：本目录刻意不放在 `packages/core/src/`（会被 sync-core 复制进 ohos HAR）
 * 也不放在 `packages/core/tests/`（会被 `bun test tests` 当测试跑，干扰用例计数）。
 */
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BENCH_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(BENCH_DIR, "../..");

/** 默认 core 源码根目录；`--ab` 会把另一个版本传进 `createScenarios`。 */
export const CORE_DIR = resolve(
  process.env.OTP_BENCH_CORE ?? join(REPO_ROOT, "packages/core/src"),
);

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SECRET = "JBSWY3DPEHPK3PXP"; // 16 字符 = 10 字节
const FIXED_TS = 1_700_000_000_000;
/** 掩码池：i & mask 取模，避免被测调用内部出现可变长循环。 */
const MASK = 255;

/** 32 个互不相同的 16 字符 base32（错开字母表下标，保证解码路径分散）。 */
const SECRETS = Array.from({ length: 32 }, (_, n) =>
  Array.from(
    { length: 16 },
    (_, k) => ALPHABET[(n * 7 + k * 11) % ALPHABET.length],
  ).join(""),
);
const LONG_SECRETS = SECRETS.map((secret) => secret.repeat(8)); // 128 字符

const MESSAGES = Array.from({ length: 32 }, (_, n) =>
  new Uint8Array(8).fill(n + 1),
);
const KEYS_SHORT = Array.from({ length: 8 }, (_, n) =>
  new Uint8Array(20).fill(n + 1),
);
const KEYS_LONG = Array.from({ length: 8 }, (_, n) =>
  new Uint8Array(128).fill(n + 1),
);
const BYTES = Array.from({ length: 32 }, (_, n) =>
  new Uint8Array(20).fill(n + 1),
);
const DIGIT_VALUES = Array.from(
  { length: 256 },
  (_, n) => (n * 3_600_007) % 100_000_000,
);

/**
 * otpauth URI 池：parse 是冷路径（一次扫码一次），池子只为让 i 换输入、避免常量折叠。
 * 四种形态对应 ABNF 的四条分支：原始 `:` 分隔（HOTP）、`%3A` 分隔且无 `issuer=`、
 * 分隔符后带空格 padding（`*"%20"`）、无分隔符（整段即 account）。
 */
const URI_POOL = [
  `otpauth://hotp/ACME:alice@example.com?secret=${SECRET}&issuer=ACME&counter=42`,
  `otpauth://totp/ACME%3Aalice@example.com?secret=${SECRET}`,
  `otpauth://totp/ACME%3A%20alice%40example.com?secret=${SECRET}&algorithm=SHA256&digits=8&period=60`,
  `otpauth://totp/alice%40example.com?secret=${SECRET}&issuer=ACME`,
];

/**
 * build 入参池：account 必填（label 只能由 account 派生），四种形态覆盖
 * 「有/无 issuer」「TOTP/HOTP」「account 内含 `@`（href 编码）」；
 * 冒号属 ABNF 禁止字符，build 会 fail-closed，不能进基准池。
 */
const BUILD_POOL = [
  {
    type: "totp",
    secret: SECRET,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    issuer: "ACME",
    account: "alice@example.com",
  },
  {
    type: "totp",
    secret: SECRET,
    algorithm: "SHA256",
    digits: 8,
    period: 60,
    account: "alice@example.com",
  },
  {
    type: "hotp",
    secret: SECRET,
    algorithm: "SHA1",
    digits: 6,
    counter: 42,
    issuer: "ACME",
    account: "alice@example.com",
  },
  {
    type: "hotp",
    secret: SECRET,
    algorithm: "SHA512",
    digits: 7,
    counter: 7,
    account: "alice@example.com",
  },
];

/** 单组加载失败（旧版本缺文件）只跳过该组，并记录原因。 */
async function group(load, name, modules, build, skipped) {
  try {
    const loaded = {};
    for (const [key, rel] of Object.entries(modules)) {
      loaded[key] = await load(rel);
    }
    return build(loaded).map((scenario) => ({ ...scenario, group: name }));
  } catch (error) {
    skipped.push(`${name}: ${error?.message ?? error}`);
    return [];
  }
}

/**
 * 绑定到某个 core 源码目录的场景集合。
 * @param {string} [coreDir] core 源码根目录（默认取 CORE_DIR）
 * @returns {Promise<{
 *   scenarios: Array<{ name: string, group: string, targetMs?: number, run: (i: number) => unknown }>,
 *   skipped: string[],
 * }>}
 */
export async function createScenarios(coreDir = CORE_DIR) {
  const load = (rel) => import(pathToFileURL(join(coreDir, rel)).href);
  const skipped = [];
  const scenarios = [];

  scenarios.push(
    ...(await group(
      load,
      "pure-js",
      {
        hmac: "pure-js/hmac.ts",
        sha1: "pure-js/sha1.ts",
        sha256: "pure-js/sha256.ts",
        sha512: "pure-js/sha512.ts",
      },
      ({ hmac, sha1, sha256, sha512 }) => [
        {
          name: "hmac sha1",
          run: (i) =>
            hmac.hmac(sha1.sha1, 64, KEYS_SHORT[i & 7], MESSAGES[i & 31]),
        },
        {
          name: "hmac sha256",
          run: (i) =>
            hmac.hmac(sha256.sha256, 64, KEYS_SHORT[i & 7], MESSAGES[i & 31]),
        },
        {
          // 纯 JS hi/lo 实现的 SHA512 明显更贵：给更短的 targetMs 控制总时长
          name: "hmac sha512",
          targetMs: 20,
          run: (i) =>
            hmac.hmac(sha512.sha512, 128, KEYS_SHORT[i & 7], MESSAGES[i & 31]),
        },
        {
          // key 128B > blockSize 64B：走 RFC 2104「先哈希密钥」分支
          name: "hmac sha1 long-key",
          run: (i) =>
            hmac.hmac(sha1.sha1, 64, KEYS_LONG[i & 7], MESSAGES[i & 31]),
        },
      ],
      skipped,
    )),
  );

  scenarios.push(
    ...(await group(
      load,
      "internal",
      {
        base32: "internal/base32.ts",
        digits: "internal/digits.ts",
        engine: "internal/engine.ts",
        secret: "secret.ts",
        pureJsHmac: "pure-js/pure-js-hmac.ts",
      },
      ({ base32, digits, engine, secret, pureJsHmac }) => {
        const provider = new pureJsHmac.PureJsHmac();
        const params = {
          algorithm: "SHA1",
          digits: 6,
          key: secret.Secret.fromBase32(SECRET).bytes,
        };
        return [
          {
            name: "digits.format 8",
            run: (i) => digits.format(DIGIT_VALUES[i & MASK], 8),
          },
          {
            name: "base32.decode 16B",
            run: (i) => base32.decode(SECRETS[i & 31]),
          },
          {
            name: "base32.decodeStrict 128ch",
            run: (i) => base32.decodeStrict(LONG_SECRETS[i & 31]),
          },
          {
            name: "base32.encode 20B",
            run: (i) => base32.encode(BYTES[i & 31]),
          },
          {
            name: "Secret.fromBase32",
            run: (i) => secret.Secret.fromBase32(SECRETS[i & 31]),
          },
          {
            // counter 递增是真实形态：verify 窗口扫描就是在扫 counter
            name: "engine.generate",
            run: (i) => engine.generate(provider, params, 12_345 + i),
          },
        ];
      },
      skipped,
    )),
  );

  scenarios.push(
    ...(await group(
      load,
      "facade",
      {
        hotp: "hotp.ts",
        totp: "totp.ts",
        pureJsHmac: "pure-js/pure-js-hmac.ts",
      },
      ({ hotp, totp, pureJsHmac }) => {
        const provider = new pureJsHmac.PureJsHmac();
        const options = [
          { secret: SECRET, algorithm: "SHA1", digits: 6 },
          { secret: SECRET, algorithm: "SHA256", digits: 6 },
        ];
        const hotpInstance = new hotp.HOTP(options[0], provider);
        const totpInstance = new totp.TOTP(options[0], provider);
        // verify 需要合法 token：按 counter 0..7 预生成，逐轮换 counter + token
        const tokens = Array.from({ length: 8 }, (_, n) =>
          hotpInstance.generate(n),
        );
        return [
          {
            name: "HOTP.generate",
            run: (i) => hotpInstance.generate(i),
          },
          {
            name: "HOTP.verify w=0",
            run: (i) => hotpInstance.verify(tokens[i & 7], { counter: i & 7 }),
          },
          {
            name: "HOTP.verify w=2",
            targetMs: 30,
            run: (i) =>
              hotpInstance.verify(tokens[i & 7], { counter: i & 7, window: 2 }),
          },
          {
            name: "TOTP.generate",
            run: (i) => totpInstance.generate(FIXED_TS + (i & MASK) * 30_000),
          },
          {
            name: "new HOTP()",
            run: (i) => new hotp.HOTP(options[i & 1], provider),
          },
        ];
      },
      skipped,
    )),
  );

  scenarios.push(
    ...(await group(
      load,
      "uri",
      { uri: "otpauth-uri.ts" },
      ({ uri }) => [
        {
          // 冷路径（导入一次 QR）：只保证「没有量级退化」，不占热路径预算
          name: "OTPAuthURI.parse",
          run: (i) => uri.OTPAuthURI.parse(URI_POOL[i & 3]),
        },
        {
          name: "OTPAuthURI.build",
          run: (i) => uri.OTPAuthURI.build(BUILD_POOL[i & 3]),
        },
      ],
      skipped,
    )),
  );

  return { scenarios, skipped };
}
