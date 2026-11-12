# OTP for WeChat Mini Program and HarmonyOS

**English** · [简体中文](README-cn.md)

A small, RFC-compliant HOTP/TOTP library with **one shared implementation** for two runtimes:

- **WeChat Mini Program** → npm package [`@yansongda/miniprogram-otp`](https://www.npmjs.com/package/@yansongda/miniprogram-otp)
- **HarmonyOS / ArkTS** → OHPM package [`@yansongda/otp`](https://ohpm.openharmony.cn/)

All protocol logic — RFC 4226 HOTP, RFC 6238 TOTP, base32, `otpauth://` URIs, dynamic truncation and drift windows — lives in a single platform-agnostic TypeScript core. Each package adds only its runtime-specific crypto provider and public type layer, so behavior is identical on both platforms.

## Features

- RFC 4226 HOTP and RFC 6238 TOTP
- SHA-1 / SHA-256 / SHA-512, 6 / 7 / 8 digit codes
- `otpauth://` URI parsing and generation (`OTPAuthURI`, `TOTP.fromURI`, `HOTP.fromURI`)
- Drift-window verification and clock-offset calibration (`verify`, `syncClockOffset`)
- `TOTP.remaining()` / `TOTP.progress()` for countdown and progress rings
- Optional strict base32 parsing for import boundaries
- Constant-time token comparison; secrets never appear in messages or logs
- 18 frozen error codes with a single `OtpError` type
- Zero runtime dependencies

## Packages

| Package                                                                                  | Runtime                        | Install                                  | Detailed docs                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`@yansongda/miniprogram-otp`](https://www.npmjs.com/package/@yansongda/miniprogram-otp) | WeChat Mini Program (CommonJS) | `npm install @yansongda/miniprogram-otp` | [English](packages/miniprogram-otp/README.md) · [中文](packages/miniprogram-otp/README-cn.md)   |
| [`@yansongda/otp`](https://ohpm.openharmony.cn/)                                         | HarmonyOS / ArkTS (HAR)        | `ohpm install @yansongda/otp`            | [English](packages/ohos-otp/library/README.md) · [中文](packages/ohos-otp/library/README-cn.md) |

## Quick start

### WeChat Mini Program

```bash
npm install @yansongda/miniprogram-otp
```

Then in WeChat DevTools: **Tools → Build npm** (the package declares `"miniprogram": "dist"`).

```ts
import { TOTP, HOTP, Secret, OTPAuthURI } from "@yansongda/miniprogram-otp";

// TOTP: SHA-1 / 6 digits / 30 seconds by default
const totp = new TOTP({ secret: "JBSWY3DPEHPK3PXP" });
totp.generate(); // current code
totp.remaining(); // seconds left in the current step
totp.progress(); // 0..1 progress for a ring UI

// Counter-based HOTP
const hotp = new HOTP({ secret: "JBSWY3DPEHPK3PXP", counter: 0 });
hotp.generate(); // code for counter 0

// Verify with a ±1 step drift window
const token = totp.generate();
totp.verify(token, { window: 1 }); // 0 | -1 | 1 | null

// Parse an otpauth:// URI (e.g. from a QR code)
const params = OTPAuthURI.parse(
  "otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP&issuer=ACME",
);
```

### HarmonyOS / ArkTS

```bash
ohpm install @yansongda/otp
```

```ts
import { TOTP, OtpAlgorithm } from "@yansongda/otp";

const totp = new TOTP({
  secret: "JBSWY3DPEHPK3PXP",
  algorithm: OtpAlgorithm.SHA256,
});
totp.generate();
totp.verify(token, { window: 1 });
```

## Behavior that matters

| Topic           | Behavior                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| Verification    | Constant-time comparison; the full window is scanned before the first match is returned                  |
| Clock drift     | `verify()` returns the matched offset in steps; `syncClockOffset(delta)` records it permanently          |
| Error model     | `OtpError.code` is one of 18 frozen string codes; messages are fixed and never contain secrets or tokens |
| Secret handling | `Secret` has no `toString()`; `JSON.stringify(secret)` yields `"[REDACTED]"`                             |
| Counter range   | 0 … 2^53-1 (no BigInt, for older WebView compatibility)                                                  |
| Base32          | Lenient by default (case/whitespace/padding); `{ strict: true }` rejects truncated or rewritten secrets  |

## Runtime differences

|               | WeChat Mini Program                                                                                                      | HarmonyOS / ArkTS                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| HMAC / SHA    | Pure JS implementation bundled into `dist`                                                                               | `@kit.CryptoArchitectureKit` synchronous HMAC              |
| Random source | No synchronous CSPRNG in WeChat; `Secret.generate()` throws `CRYPTO_NOT_INITIALIZED` unless a `RandomSource` is injected | `cryptoFramework.generateRandomSync` registered by default |
| Type surface  | TypeScript literal unions (`"SHA1"` or `OtpAlgorithm.SHA1`)                                                              | ArkTS enums (`OtpAlgorithm.SHA1`)                          |

## Repository layout

```
packages/core/                # single implementation (not published)
packages/miniprogram-otp/     # WeChat npm package (tsdown single-file bundle)
packages/ohos-otp/            # DevEco project + HAR package
scripts/sync-core.mjs         # core -> ohos library generated copy (CI-checked)
```

## Development

```bash
bun install
bun run check            # sync check + lint + typecheck + tests
bun run test             # core (242) + miniprogram (9)
bun run sync:core        # regenerate ohos core copy
bun run sync:core:check  # fail if the generated copy drifted
```

HarmonyOS build and device tests require DevEco Studio; see [`packages/ohos-otp/AGENTS.md`](packages/ohos-otp/AGENTS.md) for the exact commands.

Release tags: `miniprogram-vX.Y.Z` (npm, OIDC publish) and `ohos-vX.Y.Z` (OHPM, manual publish).

## License

MIT
