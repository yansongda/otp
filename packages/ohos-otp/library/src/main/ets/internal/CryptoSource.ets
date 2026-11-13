/**
 * kit-only 实现层：cryptoFramework 的 HMAC / 随机源实现。
 *
 * ⚠️ 全库唯一允许 import '@kit.CryptoArchitectureKit' 的文件；
 * 只被 library/Index.ets 值导入（installCryptoDefaults），公开类与 Secret 严禁引用它。
 * 接口与注册表来自 core/crypto.ts（跨边界签名用基础类型 string）。
 *
 * 错误一律经 core 的 otpFail 走平台工厂（与 core 内部零差异，不再绕开工厂直接 new OtpError）。
 */
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { HmacProvider, RandomSource, registerHmac, registerRandom } from '../core/crypto';
import { otpFail } from '../core/errors';

/** 将算法名映射为 cryptoFramework 的 HMAC 算法名；未知算法必须失败，绝不静默降级。 */
function toMacAlgName(algorithm: string): string {
  switch (algorithm) {
    case 'SHA1':
      return 'SHA1';
    case 'SHA256':
      return 'SHA256';
    case 'SHA512':
      return 'SHA512';
    default:
      // 静默回退 SHA1 会让调用方以为在用更强的算法（与 pure-js provider 的行为也对不上）
      return otpFail('CRYPTO_FAILED');
  }
}

/**
 * cryptoFramework HMAC 实现（同步 *Sync 链路）。
 *
 * 密钥生成器必须用通用 'HMAC' 规格（官方支持 [1, 4096] 字节任意长度密钥）；
 * 严禁用管道符拼接算法名的组合规格（如 'HMAC|SHA1'）——它要求密钥长度恰等于摘要长度。
 */
export class CryptoFrameworkHmac implements HmacProvider {
  sign(algorithm: string, key: Uint8Array, message: Uint8Array): Uint8Array {
    try {
      const gen = cryptoFramework.createSymKeyGenerator('HMAC');
      const symKey = gen.convertKeySync({ data: key });
      const mac = cryptoFramework.createMac(toMacAlgName(algorithm));
      mac.initSync(symKey);
      mac.updateSync({ data: message });
      return new Uint8Array(mac.doFinalSync().data);
    } catch (e) {
      // 固定文案：不透传原生错误、不打日志、不含 key/message
      return otpFail('CRYPTO_FAILED');
    }
  }
}

/** cryptoFramework 随机源实现。 */
export class CryptoFrameworkRandom implements RandomSource {
  random(bytes: number): Uint8Array {
    if (!(Number.isInteger(bytes) && bytes >= 1 && bytes <= 4096)) {
      // 长度越界是参数错误，不是「密钥强度不足」
      return otpFail('INVALID_SECRET_LENGTH');
    }
    try {
      return new Uint8Array(cryptoFramework.createRandom().generateRandomSync(bytes).data);
    } catch (e) {
      return otpFail('CRYPTO_FAILED');
    }
  }
}

/** 注册默认 crypto 实现（只 new + 注册，不发起任何 crypto 调用）。 */
export function installCryptoDefaults(): void {
  registerHmac(new CryptoFrameworkHmac());
  registerRandom(new CryptoFrameworkRandom());
}
