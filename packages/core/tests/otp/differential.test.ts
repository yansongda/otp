/**
 * 差分测试：纯 JS 实现 vs Node 内置 `node:crypto`（只在本文件内使用的测试期 oracle）。
 *
 * 为什么需要它：`vectors.ts` 的官方向量只覆盖少量固定输入（RFC / FIPS 附录），
 * 而 SHA-512 是手写的 64 位 hi/lo 实现，填充分支、跨块累加、进位传播都有可能在
 * 「向量没覆盖到的长度」上出错（历史上 tuple 版本改标量版本时正是这类风险）。
 * 这里用独立实现逐字节对拍全长度区间，把「实现自证」换成「外部 oracle 对拍」。
 *
 * 只覆盖长度与 key/message 组合，不引入任何运行期依赖（`node:crypto` 仅测试用）。
 */
import { describe, expect, it } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { hmac } from "../../src/pure-js/hmac";
import { sha1 } from "../../src/pure-js/sha1";
import { sha256 } from "../../src/pure-js/sha256";
import { sha512 } from "../../src/pure-js/sha512";
import { toHex } from "./vectors";

/** 确定性伪随机（同一长度每次跑出同一输入，便于复现失败）。 */
function patternBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed * 0x9e3779b1 + 0x7f4a7c15;
  for (let i = 0; i < length; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out[i] = (x >>> 24) & 0xff;
  }
  return out;
}

/** 覆盖每个 padding 边界：0..259 含 SHA-512 的 111/112 与 239/240 块尾边界，再加跨多块。
 *  用连续区间而非手写枚举，避免重复项（重名用例会被静默跑两遍）。 */
const LENGTHS = [
  ...Array.from({ length: 260 }, (_, i) => i),
  511,
  512,
  513,
  1000,
];

describe("differential / hash", () => {
  for (const length of LENGTHS) {
    it(`length_${length}`, () => {
      const message = patternBytes(length, length + 1);
      expect(toHex(sha1(message))).toBe(
        createHash("sha1").update(message).digest("hex"),
      );
      expect(toHex(sha256(message))).toBe(
        createHash("sha256").update(message).digest("hex"),
      );
      expect(toHex(sha512(message))).toBe(
        createHash("sha512").update(message).digest("hex"),
      );
    });
  }
});

describe("differential / hmac", () => {
  // key 覆盖：短于摘要 / 等于块长 / 长于块长（RFC 2104 §2 的「先哈希密钥」分支）
  const KEY_LENGTHS = [1, 16, 20, 64, 65, 128, 129, 200];
  const MESSAGE_LENGTHS = [0, 8, 20, 64, 128, 300];

  for (const keyLength of KEY_LENGTHS) {
    for (const messageLength of MESSAGE_LENGTHS) {
      it(`sha1_key${keyLength}_msg${messageLength}`, () => {
        const key = patternBytes(keyLength, keyLength);
        const message = patternBytes(messageLength, messageLength + 7);
        expect(toHex(hmac(sha1, 64, key, message))).toBe(
          createHmac("sha1", key).update(message).digest("hex"),
        );
        expect(toHex(hmac(sha256, 64, key, message))).toBe(
          createHmac("sha256", key).update(message).digest("hex"),
        );
        expect(toHex(hmac(sha512, 128, key, message))).toBe(
          createHmac("sha512", key).update(message).digest("hex"),
        );
      });
    }
  }
});
