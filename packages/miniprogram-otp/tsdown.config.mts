import { defineConfig } from "tsdown";

/**
 * 单文件 CJS + 单文件 d.ts：core 源码在构建期被内联，
 * 发布物自包含（微信构建 npm 后 miniprogram_npm 内无额外依赖）。
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "neutral",
  target: "es2019",
  outDir: "dist",
  clean: true,
  dts: { tsconfig: "./tsconfig.dts.json" },
});
