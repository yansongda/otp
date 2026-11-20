import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const coreIndex = fileURLToPath(
  new URL("../core/src/index.ts", import.meta.url),
);
const corePureJs = fileURLToPath(
  new URL("../core/src/pure-js.ts", import.meta.url),
);

/**
 * 单文件 CJS + 单文件 d.ts：core 源码在构建期被内联，
 * 发布物自包含（微信构建 npm 后 miniprogram_npm 内无额外依赖）。
 *
 * core 不是 npm 依赖，因此用 alias 直接指向 monorepo 源码；
 * 长键在前，避免前缀匹配把 /pure-js 误替换成 index.ts/pure-js。
 *
 * `outputOptions.comments = false`：发布物只需要可执行的 JS，core 源码里那些「为什么 / RFC 依据」
 * 长注释只对读仓库的人有价值——它们一度占到 `dist/index.js` 的 44%（去注释 66.2KB → 37.4KB，
 * gzip 23.4KB → 10.0KB）。`.d.ts` 不受影响，JSDoc 保留给 IDE 提示。
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "neutral",
  target: "es2019",
  outDir: "dist",
  clean: true,
  dts: { tsconfig: "./tsconfig.dts.json" },
  outputOptions: { comments: false },
  alias: {
    "@yansongda/otp-core/pure-js": corePureJs,
    "@yansongda/otp-core": coreIndex,
  },
});
