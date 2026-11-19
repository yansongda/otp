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
  "MAX_VERIFY_WINDOW",
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

const totp = new m.TOTP({
  secret: seed,
  digits: 8,
  issuer: "ACME",
  account: "alice",
});
assert.equal(totp.generate(59000), "94287082");
assert.equal(totp.remaining(59000), 1);
assert.equal(totp.progress(15000), 0.5);

const uri = totp.toURI();
assert.equal(m.TOTP.fromURI(uri).generate(59000), "94287082");
assert.equal(m.OTPAuthURI.parse(uri).type, m.OtpType.TOTP);
// account 是 label 的唯一来源：缺失时构建期 fail-closed（不产出空 label 的 URI）
assert.throws(
  () => new m.TOTP({ secret: seed, digits: 8 }).toURI(),
  (e) =>
    e instanceof m.OtpError && e.code === m.OtpErrorCode.INVALID_OTPAUTH_URI,
);

const secret = m.Secret.fromBase32("JBSWY3DPEHPK3PXP");
assert.equal(secret.byteLength, 10);
assert.equal(secret.toBase32(), "JBSWY3DPEHPK3PXP");
assert.equal(JSON.stringify({ secret }), '{"secret":"[REDACTED]"}');

assert.throws(
  () => new m.TOTP({ secret: "JBSWY3DPEHPK3PXP", digits: 5 }),
  (e) => e instanceof m.OtpError && e.code === m.OtpErrorCode.INVALID_DIGITS,
);

assert.equal(m.OtpErrorCode.INVALID_BASE32_PADDING, "INVALID_BASE32_PADDING");
assert.equal(
  m.OtpErrorCode.INVALID_SECRET_CONTAINER,
  "INVALID_SECRET_CONTAINER",
);
assert.equal(m.OtpErrorCode.INVALID_SECRET_LENGTH, "INVALID_SECRET_LENGTH");
assert.equal(m.OtpErrorCode.INVALID_CLOCK_OFFSET, "INVALID_CLOCK_OFFSET");
assert.equal(m.OtpErrorCode.INVALID_MIN_SECRET_BITS, "INVALID_MIN_SECRET_BITS");
assert.equal(Object.keys(m.OtpErrorCode).length, 22);
assert.equal(m.MAX_VERIFY_WINDOW, 10);

// 非字符串入参 fail-closed：小程序是 JS 调用方，不得漏原生 TypeError
assert.throws(
  () => m.Secret.fromBase32(123),
  (e) =>
    e instanceof m.OtpError &&
    e.code === m.OtpErrorCode.INVALID_SECRET_CONTAINER,
);
assert.throws(
  () => new m.TOTP({ secret: "JBSWY3DPEHPK3PXP" }).verify(undefined),
  (e) => e instanceof m.OtpError && e.code === m.OtpErrorCode.INVALID_TOKEN,
);
// 孤立代理字符（如被 slice 截断的 emoji）不得漏 URIError
assert.throws(
  () =>
    m.OTPAuthURI.build({
      type: "totp",
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA1",
      digits: 6,
      account: "👨‍👩‍👧".slice(0, 1),
    }),
  (e) =>
    e instanceof m.OtpError && e.code === m.OtpErrorCode.INVALID_OTPAUTH_URI,
);

// fromBytes(ArrayBuffer) 必须是拷贝：调用方清零原 buffer 不影响实例
const rawSecret = new ArrayBuffer(20);
new Uint8Array(rawSecret).fill(0x01);
const copied = m.Secret.fromBytes(rawSecret);
new Uint8Array(rawSecret).fill(0);
assert.equal(copied.bytes[0], 0x01);
assert.throws(
  () => m.Secret.fromBytes("abc"),
  (e) =>
    e instanceof m.OtpError &&
    e.code === m.OtpErrorCode.INVALID_SECRET_CONTAINER,
);
// 8 位无符号视图都放行：Uint8ClampedArray 读取语义与 Uint8Array 一致（ImageData.data）
assert.deepEqual(
  Array.from(m.Secret.fromBytes(new Uint8ClampedArray([1, 127, 255])).bytes),
  [1, 127, 255],
);
// Int8Array / Uint16Array 等逐元素转换会丢数据（丢高位字节）→ 仍拒绝
assert.throws(
  () => m.Secret.fromBytes(new Uint16Array([0x1234])),
  (e) =>
    e instanceof m.OtpError &&
    e.code === m.OtpErrorCode.INVALID_SECRET_CONTAINER,
);

// 错误码唯一来源是 core：新增码必须自动出现在产物里，平台无需再抄一份
assert.throws(
  () => new m.TOTP({ secret: "JBSWY3DPEHPK3PXP", clockOffsetMs: Number.NaN }),
  (e) =>
    e instanceof m.OtpError && e.code === m.OtpErrorCode.INVALID_CLOCK_OFFSET,
);
assert.throws(
  () => m.Secret.generate(0),
  (e) =>
    e instanceof m.OtpError && e.code === m.OtpErrorCode.INVALID_SECRET_LENGTH,
);
assert.throws(
  () => new m.TOTP({ secret: "JBSWY3DPEHPK3PXP", clockOffsetMs: 0.5 }),
  (e) =>
    e instanceof m.OtpError && e.code === m.OtpErrorCode.INVALID_CLOCK_OFFSET,
);
assert.throws(
  () => new m.TOTP({ secret: "JBSWY3DPEHPK3PXP", minSecretBits: Number.NaN }),
  (e) =>
    e instanceof m.OtpError &&
    e.code === m.OtpErrorCode.INVALID_MIN_SECRET_BITS,
);
assert.throws(
  () =>
    new m.TOTP({ secret: "JBSWY3DPEHPK3PXP" }).verify("287082", {
      timestamp: 59000,
      window: 11,
    }),
  (e) => e instanceof m.OtpError && e.code === m.OtpErrorCode.INVALID_WINDOW,
);

// 可选 options 传 null 等价于未传；strict 非 boolean 按 strict（fail-closed）
assert.equal(
  m.OTPAuthURI.parse("otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP", null)
    .issuer,
  "ACME",
);
assert.throws(
  () => m.Secret.fromBase32("MZXW6YT", { strict: 1 }),
  (e) =>
    e instanceof m.OtpError && e.code === m.OtpErrorCode.INVALID_BASE32_PADDING,
);

console.log(
  "dist smoke OK: 9 exports, RFC 4226/6238 vectors, URI, errors, redaction",
);
