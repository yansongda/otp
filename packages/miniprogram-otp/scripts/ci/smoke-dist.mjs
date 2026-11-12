#!/usr/bin/env node
/**
 * 构建产物冒烟：验证 dist/index.js 是可用 CJS 包，而不是只验证源码。
 * 运行前需先执行 `bun run build`。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const entry = join(root, "dist/index.js");

assert.ok(existsSync(entry), `缺少 ${entry}，请先执行 bun run build`);
assert.ok(existsSync(join(root, "dist/index.d.ts")), "缺少 dist/index.d.ts");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.equal(pkg.dependencies && Object.keys(pkg.dependencies).length, 0);

const m = require(entry);
const expected = [
  "HOTP",
  "OTPAuthURI",
  "OtpAlgorithm",
  "OtpError",
  "OtpErrorCode",
  "OtpType",
  "Secret",
  "TOTP",
];
assert.deepEqual(Object.keys(m).sort(), expected);

const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const hotp = new m.HOTP({ secret: seed });
assert.equal(hotp.generate(0), "755224");
assert.equal(hotp.generate(1), "287082");
assert.equal(hotp.verify("287082", { counter: 1 }), 0);

const totp = new m.TOTP({ secret: seed, digits: 8 });
assert.equal(totp.generate(59000), "94287082");
assert.equal(totp.remaining(59000), 1);
assert.equal(totp.progress(15000), 0.5);

const uri = totp.toURI();
assert.equal(m.TOTP.fromURI(uri).generate(59000), "94287082");
assert.equal(m.OTPAuthURI.parse(uri).type, m.OtpType.TOTP);

const secret = m.Secret.fromBase32("JBSWY3DPEHPK3PXP");
assert.equal(secret.byteLength, 10);
assert.equal(secret.toBase32(), "JBSWY3DPEHPK3PXP");
assert.equal(JSON.stringify({ secret }), '{"secret":"[REDACTED]"}');

assert.throws(
  () => new m.TOTP({ secret: "JBSWY3DPEHPK3PXP", digits: 5 }),
  (e) => e instanceof m.OtpError && e.code === m.OtpErrorCode.INVALID_DIGITS,
);

assert.equal(m.OtpErrorCode.INVALID_BASE32_PADDING, "INVALID_BASE32_PADDING");
assert.equal(Object.keys(m.OtpErrorCode).length, 18);

console.log(
  "dist smoke OK: 8 exports, RFC 4226/6238 vectors, URI, errors, redaction",
);
