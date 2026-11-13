# @yansongda/miniprogram-otp

A zero-dependency RFC 4226 / RFC 6238 HOTP and TOTP library for **WeChat Mini Program**, published as CommonJS.

The protocol implementation comes from this monorepo's shared, platform-agnostic core (`packages/core`). This package adds the WeChat runtime layer — a pure-JS HMAC/SHA provider (no synchronous CSPRNG assumption) and the TypeScript public types. Its public API and error model are aligned with the HarmonyOS package [`@yansongda/otp`](https://github.com/yansongda/otp/tree/main/packages/ohos-otp/library).

## Features

- HOTP (RFC 4226) and TOTP (RFC 6238)
- SHA1 / SHA256 / SHA512
- 6, 7 and 8 digit codes
- `verify()` drift window and `syncClockOffset()` clock resynchronization
- `TOTP.remaining()` / `TOTP.progress()` for countdown and ring progress
- `otpauth://` URI parsing and generation (`OTPAuthURI`, `TOTP.fromURI`, `HOTP.fromURI`)
- `Secret` normalization, validation, byte/bit introspection and `toJSON()` redaction
- Optional strict Base32 parsing (`{ strict: true }`)
- Unified `OtpError` model with 21 frozen string error codes (`OtpErrorCode` is re-exported from the shared core)
- Zero runtime dependencies
- TypeScript declarations included

## Install

```bash
npm install @yansongda/miniprogram-otp
```

In WeChat DevTools, run **Tools → Build npm** after installing the package. The package declares `"miniprogram": "dist"`, so the compiled `dist/` directory is copied into `miniprogram_npm/`.

```ts
import {
  TOTP,
  HOTP,
  Secret,
  OTPAuthURI,
  OtpError,
} from "@yansongda/miniprogram-otp";
```

CommonJS is also supported:

```js
const { TOTP } = require("@yansongda/miniprogram-otp");
```

## Quick start

```ts
import {
  TOTP,
  HOTP,
  Secret,
  OTPAuthURI,
  OtpError,
} from "@yansongda/miniprogram-otp";

// TOTP: SHA1 / 6 digits / 30 seconds by default
const totp = new TOTP({ secret: "JBSWY3DPEHPK3PXP" });

totp.generate(); // current code
totp.remaining(); // seconds left in the current step: 1..period
totp.progress(); // progress in the current step: 0..1

// Verify with a one-step drift window; returns delta or null
const delta = totp.verify(code, { window: 1 });
if (delta !== null) {
  totp.syncClockOffset(delta); // RFC 6238 §6 resynchronization
}

const uri = totp.toURI();
const restored = TOTP.fromURI(uri);

// HOTP: counter-based
const hotp = new HOTP({ secret: "JBSWY3DPEHPK3PXP", counter: 0 });
hotp.generate();
hotp.verify(hotp.generate(), { window: 5 });

// Secret utilities
const secret = Secret.fromBase32("JBSWY3DPEHPK3PXP");
const strict = Secret.fromBase32("JBSWY3DPEHPK3PXP", { strict: true });
const canonical = secret.toBase32();
const bits = secret.bitLength;

// Errors are always OtpError with a stable code
try {
  new TOTP({ secret: "JBSWY3DPEHPK3PXP", digits: 5 });
} catch (e) {
  if (e instanceof OtpError) {
    console.log(e.code); // INVALID_DIGITS
  }
}
```

## API

### Options

| Type                | Field                                                                                                         | Default                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `HmacOptions`       | `secret: string` (required, Base32, lenient parsing)                                                          | —                         |
|                     | `algorithm?: OtpAlgorithm`                                                                                    | `SHA1`                    |
|                     | `digits?: number` (6 / 7 / 8 only)                                                                            | `6`                       |
|                     | `minSecretBits?: number` (non-negative safe integer)                                                          | `0` (disabled)            |
| `TotpOptions`       | `period?: number` (seconds)                                                                                   | `30`                      |
|                     | `t0?: number` (seconds)                                                                                       | `0`                       |
|                     | `clockOffsetMs?: number` (safe-integer ms)                                                                    | `0`                       |
|                     | `issuer?` / `account?: string` (only used by `toURI()`)                                                       | empty                     |
| `HotpOptions`       | `counter?: number`                                                                                            | `0`                       |
|                     | `issuer?` / `account?: string` (only used by `toURI()`)                                                       | empty                     |
| `VerifyOptions`     | Compatibility superset of the per-class options below; pass `HotpVerifyOptions` / `TotpVerifyOptions` instead | —                         |
| `HotpVerifyOptions` | `counter?: number`, `window?: number` (steps `[0, 10]`)                                                       | `window: 0`               |
| `TotpVerifyOptions` | `timestamp?: number` (epoch ms safe integer), `window?: number` (steps `[0, 10]`)                             | `Date.now()`, `window: 0` |
| `MAX_VERIFY_WINDOW` | Maximum drift window (steps, both directions)                                                                 | `10`                      |

### Classes and methods

| API                                                                       | Description                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `new TOTP(options: TotpOptions)`                                          | Validate options synchronously; throws `OtpError` on invalid input                                            |
| `totp.generate(timestampMs?: number): string`                             | Generate code; defaults to now                                                                                |
| `totp.verify(token: string, options?: TotpVerifyOptions): number \| null` | Constant-time comparison; returns hit delta or `null`                                                         |
| `totp.remaining(timestampMs?: number): number`                            | Seconds left in the current step, `[1, period]`                                                               |
| `totp.progress(timestampMs?: number): number`                             | Step progress, `[0, 1)`                                                                                       |
| `totp.syncClockOffset(delta: number): void`                               | `clockOffsetMs += delta * period * 1000` (delta must be a safe integer, may be negative)                      |
| `totp.clockOffsetMs: number`                                              | Current clock offset in ms                                                                                    |
| `totp.toURI(): string` / `TOTP.fromURI(uri: string): TOTP`                | Serialize / restore TOTP                                                                                      |
| `new HOTP(options: HotpOptions)`                                          | Validate options synchronously                                                                                |
| `hotp.generate(counter?: number): string`                                 | Generate code; defaults to the constructor counter                                                            |
| `hotp.verify(token: string, options?: HotpVerifyOptions): number \| null` | Return counter delta or `null`                                                                                |
| `hotp.toURI(): string` / `HOTP.fromURI(uri: string): HOTP`                | Serialize / restore HOTP                                                                                      |
| `Secret.fromBase32(s: string, options?: ParseOptions): Secret`            | Parse Base32; lenient by default                                                                              |
| `Secret.fromBytes(bytes: Uint8Array): Secret`                             | Copy bytes; empty input throws `EMPTY_SECRET`                                                                 |
| `Secret.generate(bytes = 20): Secret`                                     | Generate via the internal `RandomSource` registry; on WeChat no default source is registered, see limitations |
| `secret.toBase32(): string`                                               | Canonical uppercase, unpadded Base32                                                                          |
| `secret.bytes` / `secret.byteLength` / `secret.bitLength`                 | Byte view (copy) / byte length / bit length                                                                   |
| `secret.toJSON(): string`                                                 | Always `[REDACTED]`; `JSON.stringify` is safe                                                                 |
| `OTPAuthURI.parse(uri: string, options?: ParseOptions): OtpAuthParams`    | Parse `otpauth://`; unknown query parameters ignored                                                          |
| `OTPAuthURI.build(params: OtpAuthParams): string`                         | Build canonical `otpauth://`                                                                                  |
| `interface ParseOptions { strict?: boolean }`                             | Shared by `Secret.fromBase32` and `OTPAuthURI.parse`                                                          |
| `OtpAlgorithm` / `OtpType`                                                | String-valued constants; literals such as `"SHA1"` also work                                                  |
| `class OtpError extends Error { readonly code: OtpErrorCode }`            | Stable code for branching                                                                                     |

## Strict Base32

`{ strict: true }` rejects text that canonical Base32 could not produce, after the library's own normalization (case, whitespace and trailing `=` are still tolerated):

| Normalized input                                         | `len % 8`     | Default                      | `{ strict: true }`                    |
| -------------------------------------------------------- | ------------- | ---------------------------- | ------------------------------------- |
| `JBSWY3DPEHPK3PXP`                                       | 0             | OK                           | OK                                    |
| `MY` / `MZXQ` / `MZXW6` / `MZXW6YQ`                      | 2 / 4 / 5 / 7 | OK                           | OK                                    |
| `MB` / `MZXR` / `MZXW7` / `MZXW6YT` (non-zero tail bits) | 2 / 4 / 5 / 7 | silently re-encoded          | `INVALID_BASE32_PADDING`              |
| `A` / `AAA` / `MZXW6Y` (impossible tail length)          | 1 / 3 / 6     | `SECRET_TOO_SHORT` / OK / OK | `INVALID_BASE32_PADDING`              |
| `AB1` (illegal character)                                | 3             | `INVALID_BASE32_CHAR`        | `INVALID_BASE32_CHAR` (checked first) |

## Error codes

All failures throw `OtpError` with a fixed `code`. Messages never contain secrets, tokens or derived keys.

| Code                       | Meaning                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `EMPTY_SECRET`             | Missing or empty secret                                                                                               |
| `INVALID_BASE32_CHAR`      | Character outside the Base32 alphabet                                                                                 |
| `INVALID_BASE32_PADDING`   | Strict mode: non-canonical tail length or non-zero tail bits                                                          |
| `SECRET_TOO_SHORT`         | Decoded secret is shorter than one byte                                                                               |
| `SECRET_TOO_WEAK`          | `minSecretBits` check failed (strength only)                                                                          |
| `INVALID_SECRET_LENGTH`    | `Secret.generate(bytes)` bytes is not an integer in `[1, 4096]`                                                       |
| `INVALID_MIN_SECRET_BITS`  | `minSecretBits` is not a non-negative safe integer (fail-closed)                                                      |
| `INVALID_ALGORITHM`        | Not SHA1 / SHA256 / SHA512                                                                                            |
| `INVALID_DIGITS`           | Not 6 / 7 / 8                                                                                                         |
| `INVALID_PERIOD`           | Period is not a positive safe integer                                                                                 |
| `INVALID_T0`               | `t0` is not a non-negative safe integer                                                                               |
| `INVALID_COUNTER`          | Counter is not an integer in `[0, 2^53-1]`                                                                            |
| `INVALID_TIMESTAMP`        | Timestamp is not a non-negative safe integer (epoch 0 is valid)                                                       |
| `INVALID_CLOCK_OFFSET`     | `clockOffsetMs` is not a safe integer, or `syncClockOffset` delta is not / overflows                                  |
| `INVALID_WINDOW`           | Window is not an integer in `[0, 10]` (`MAX_VERIFY_WINDOW`)                                                           |
| `INVALID_TOKEN`            | Token is not numeric or its length differs from `digits`                                                              |
| `CRYPTO_FAILED`            | Provider failure (native crypto error, short/non-`Uint8Array` digest, wrong random length); no key material is leaked |
| `CRYPTO_NOT_INITIALIZED`   | No provider registered; import the package barrel                                                                     |
| `INVALID_OTPAUTH_URI`      | URI does not start with `otpauth://` (case-insensitive)                                                               |
| `UNSUPPORTED_OTPAUTH_TYPE` | Type is not `totp` / `hotp` (parse and build)                                                                         |
| `NOT_IMPLEMENTED`          | Reserved fallback for an error code the platform cannot map (never thrown by the library)                             |

## WeChat-specific limitations

### Random secret generation

WeChat exposes only **asynchronous** `wx.getRandomValues` (base library 2.15.0+), while `Secret.generate()` is synchronous. The package therefore does **not** register a default random source on WeChat. `Secret.generate()` throws `CRYPTO_NOT_INITIALIZED`.

Use `Secret.fromBytes()` with bytes obtained from the platform:

```ts
import { Secret } from "@yansongda/miniprogram-otp";

wx.getRandomValues({
  length: 20,
  success: (res) => {
    const secret = Secret.fromBytes(new Uint8Array(res.randomValues));
    // persist secret.toBase32()
  },
});
```

This is the only intentional functional difference from the OHOS library, which registers a synchronous `CryptoFrameworkRandom` by default. The `RandomSource` registry is internal by design; use `Secret.fromBytes()` for platform-provided random bytes.

### Crypto implementation

The Mini Program has no WebCrypto / SubtleCrypto. HMAC-SHA1/256/512 are implemented in pure TypeScript with 32-bit-safe arithmetic. SHA-512 uses hi/lo half-words and **does not use BigInt**, for compatibility with older devices.

### Other limits

- Counter is limited to `2^53-1` because JavaScript numbers cannot represent larger integers exactly.
- `otpauth://` is a Google Authenticator de-facto standard (IANA Provisional #13829), not an RFC.
- Unknown URI query parameters are ignored for interoperability.
- `verify()` defaults to `window: 0`; pass `window: 1` to tolerate the one-step network delay described by RFC 6238 §5.2. The window is capped at `MAX_VERIFY_WINDOW = 10` steps (`INVALID_WINDOW` beyond it) — ±3 steps is already very lenient for a dynamic code, so 10 (±5 minutes at the default period) is the ceiling rather than a tuning knob.
- No Steam Guard, SHA224/SHA384/SM3, BigInt counters, throttling (RFC 4226 §7.3 is a server responsibility), QR rendering or scanning.
- Pure-JS HMAC is slower than native crypto; this library targets client-side code generation, not bulk server verification.

## Shared core and platform differences

- Public API, DTO field names, 21 error codes and RFC behavior are aligned with the HarmonyOS package (`@yansongda/otp` v1.1.1).
- Both packages consume `packages/core`; only the type layer and crypto provider differ.
- `OtpAlgorithm` is a `const` object plus string union instead of an ArkTS `enum`, so both `"SHA1"` and `OtpAlgorithm.SHA1` work.
- `OtpError` sets `name` and repairs the prototype chain **only when the prototype has degraded to `Error.prototype`** (WeChat ES5 downleveling); an unconditional `Object.setPrototypeOf` would rewrite subclass instances and break `instanceof` for subclasses. ES5 + custom subclasses must still fix their own prototype chain.
- HMAC is the shared pure-JS provider (`packages/core/src/pure-js`), not `@kit.CryptoArchitectureKit`.
- Random source is not registered by default; see above.

## Development

```bash
bun install
bun run lint              # biome check
bun run typecheck         # tsc --noEmit
bun test                  # platform contract tests
bun run build             # tsdown -> dist (single-file CommonJS + single-file d.ts)
bun run check:invariants  # repository invariants
bun run smoke:dist        # require dist and verify RFC vectors
bun run release:check     # full pre-release gate (includes npm pack --dry-run)
```

The Bun version is pinned in `.bun-version` (currently `1.4.4`); CI also runs a non-blocking latest-Bun compatibility job. `bun fmt` can format README/JSON files, but the CI source of truth is Biome.

Releases: `.github/workflows/release-miniprogram.yml` publishes to npm on tag `miniprogram-v*` via GitHub OIDC Trusted Publishing. First release is manual; see `.agents/skills/release-miniprogram/SKILL.md`.

## License

MIT
