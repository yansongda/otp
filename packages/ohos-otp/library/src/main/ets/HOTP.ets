/**
 * 薄壳：实现见 core/hotp.ts。
 * 构造签名沿用 core 的跨边界类型（algorithm: string）；OtpAlgorithm.SHA1 等 enum 值可直接传入。
 */
export { HOTP } from './core/hotp';
