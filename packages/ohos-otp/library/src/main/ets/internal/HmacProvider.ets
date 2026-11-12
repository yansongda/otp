/**
 * 薄壳：接口 + 注册表见 core/crypto.ts。
 *
 * 本文件必须 kit-free；真实实现见 internal/CryptoSource.ets（全库唯一 @kit 导入点）。
 */
export {
  HmacProvider,
  RandomSource,
  registerHmac,
  registerRandom,
  requireHmac,
  requireRandom,
  reset,
} from '../core/crypto';
