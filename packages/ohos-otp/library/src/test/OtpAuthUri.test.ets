/**
 * OTPAuthURI 解析 / 生成 / round-trip 测试。
 * 解析与生成遵循 Google Authenticator Key URI Format（IANA Provisional #13829）。
 */
import { describe, it, expect } from '@ohos/hypium';
import { OTPAuthURI } from '../main/ets/OTPAuthURI';
import { OtpAlgorithm, OtpAuthParams, OtpType } from '../main/ets/OtpOptions';
import { OtpError, OtpErrorCode } from '../main/ets/OtpError';

/** 期望抛出指定错误码（try/catch 捕获后断言 code，比消息匹配精确）。 */
function expectThrowsCode(fn: () => void, code: OtpErrorCode): void {
  let thrown: boolean = false;
  let actualCode: string = '';
  try {
    fn();
  } catch (e) {
    thrown = true;
    actualCode = (e as OtpError).code;
  }
  expect(thrown).assertTrue();
  expect(actualCode).assertEqual(code);
}

/**
 * 语义等价断言：type/secret/algorithm/digits/period/counter/issuer/account 逐项相等。
 * 缺省语义：TOTP period 缺省 30、HOTP counter 缺省 0（parse(build(p)) 会补齐默认值）。
 */
function assertParamsEqual(actual: OtpAuthParams, expected: OtpAuthParams): void {
  expect(actual.type).assertEqual(expected.type);
  expect(actual.secret).assertEqual(expected.secret);
  expect(actual.algorithm).assertEqual(expected.algorithm);
  expect(actual.digits).assertEqual(expected.digits);
  const expPeriod: number | undefined = expected.period === undefined
    ? (expected.type === OtpType.TOTP ? 30 : undefined) : expected.period;
  const expCounter: number | undefined = expected.counter === undefined
    ? (expected.type === OtpType.HOTP ? 0 : undefined) : expected.counter;
  expect(actual.period).assertEqual(expPeriod);
  expect(actual.counter).assertEqual(expCounter);
  expect(actual.issuer).assertEqual(expected.issuer === undefined ? undefined : expected.issuer);
  expect(actual.account).assertEqual(expected.account === undefined ? undefined : expected.account);
}

export default function otpAuthUriTest() {
  describe('otpAuthUriTest', () => {
    it('parse_standardTotpAllFields', 0, () => {
      const p: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/ACME%20Co:john@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60'
      );
      expect(p.type).assertEqual(OtpType.TOTP);
      expect(p.secret).assertEqual('JBSWY3DPEHPK3PXP');
      expect(p.algorithm).assertEqual(OtpAlgorithm.SHA256);
      expect(p.digits).assertEqual(8);
      expect(p.period).assertEqual(60);
      expect(p.issuer).assertEqual('ACME Co');
      expect(p.account).assertEqual('john@example.com');
    });

    it('parse_missingOptionalDefaults', 0, () => {
      // 无 algorithm/digits/period → SHA1/6/30
      const p: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP'
      );
      expect(p.algorithm).assertEqual(OtpAlgorithm.SHA1);
      expect(p.digits).assertEqual(6);
      expect(p.period).assertEqual(30);
      expect(p.account).assertEqual('alice');
    });

    it('parse_hotpWithCounter', 0, () => {
      const p: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://hotp/ACME%20Co:alice?secret=JBSWY3DPEHPK3PXP&counter=42'
      );
      expect(p.type).assertEqual(OtpType.HOTP);
      expect(p.counter).assertEqual(42);
      expect(p.period).assertUndefined();
    });

    it('parse_unknownParamsIgnored', 0, () => {
      const p: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&image=foo.png&lock=true'
      );
      expect(p.secret).assertEqual('JBSWY3DPEHPK3PXP');
      expect(p.digits).assertEqual(6);
    });

    it('parse_uppercaseScheme', 0, () => {
      const p: OtpAuthParams = OTPAuthURI.parse(
        'OTPAUTH://TOTP/alice?secret=JBSWY3DPEHPK3PXP'
      );
      expect(p.type).assertEqual(OtpType.TOTP);
      expect(p.secret).assertEqual('JBSWY3DPEHPK3PXP');
    });

    it('parse_queryIssuerWinsOverLabelPrefix', 0, () => {
      const p: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/Foo:bar?secret=JBSWY3DPEHPK3PXP&issuer=Baz'
      );
      expect(p.issuer).assertEqual('Baz'); // 以 query 为准
      expect(p.account).assertEqual('bar');
    });

    it('parse_failInvalidScheme', 0, () => {
      expectThrowsCode(() => OTPAuthURI.parse('http://example.com/x'), OtpErrorCode.INVALID_OTPAUTH_URI);
    });

    it('parse_failUnsupportedType', 0, () => {
      expectThrowsCode(() => OTPAuthURI.parse('otpauth://steam/alice?secret=JBSWY3DPEHPK3PXP'),
        OtpErrorCode.UNSUPPORTED_OTPAUTH_TYPE);
    });

    it('parse_failMissingSecret', 0, () => {
      expectThrowsCode(() => OTPAuthURI.parse('otpauth://totp/alice'), OtpErrorCode.EMPTY_SECRET);
    });

    it('parse_failInvalidAlgorithm', 0, () => {
      expectThrowsCode(() => OTPAuthURI.parse('otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&algorithm=MD5'),
        OtpErrorCode.INVALID_ALGORITHM);
    });

    it('parse_failInvalidDigits', 0, () => {
      expectThrowsCode(() => OTPAuthURI.parse('otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&digits=5'),
        OtpErrorCode.INVALID_DIGITS);
    });

    it('parse_failInvalidPeriod', 0, () => {
      expectThrowsCode(() => OTPAuthURI.parse('otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&period=0'),
        OtpErrorCode.INVALID_PERIOD);
    });

    it('parse_failInvalidCounter', 0, () => {
      expectThrowsCode(() => OTPAuthURI.parse('otpauth://hotp/alice?secret=JBSWY3DPEHPK3PXP&counter=-1'),
        OtpErrorCode.INVALID_COUNTER);
    });

    it('parse_failUnsafeCounter', 0, () => {
      // > 2^53-1 的 counter 会丢精度：与 build / HOTP 构造器同口径拒绝
      expectThrowsCode(() => OTPAuthURI.parse(
        'otpauth://hotp/alice?secret=JBSWY3DPEHPK3PXP&counter=9007199254740993'),
        OtpErrorCode.INVALID_COUNTER);
    });

    it('parse_failUnsafePeriod', 0, () => {
      // period 必须是正安全整数
      expectThrowsCode(() => OTPAuthURI.parse(
        'otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&period=1e300'),
        OtpErrorCode.INVALID_PERIOD);
    });

    it('parse_nonDecimalNumerics_throws', 0, () => {
      // 导入边界只认纯十进制：0x / 科学计数 / 小数一律拒绝（Number() 会把它们静默放宽）。
      expectThrowsCode(() => OTPAuthURI.parse(
        'otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&digits=0x7'),
        OtpErrorCode.INVALID_DIGITS);
      expectThrowsCode(() => OTPAuthURI.parse(
        'otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&period=1e3'),
        OtpErrorCode.INVALID_PERIOD);
      expectThrowsCode(() => OTPAuthURI.parse(
        'otpauth://hotp/alice?secret=JBSWY3DPEHPK3PXP&counter=0x2A'),
        OtpErrorCode.INVALID_COUNTER);
    });

    it('parse_strictAcceptsCanonicalSecret', 0, () => {
      // 大小写/空白等归一化仍容忍，其余字段行为不变
      const p: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/alice?secret=jbswy3dpehpk3pxp&digits=8', { strict: true });
      expect(p.secret).assertEqual('JBSWY3DPEHPK3PXP');
      expect(p.digits).assertEqual(8);
      expect(p.period).assertEqual(30);
    });

    it('parse_strictRejectsNonCanonicalSecret', 0, () => {
      // 'MZXW6YT'：尾长 7，'T'=19 低 3 位非 0
      expectThrowsCode(() => OTPAuthURI.parse('otpauth://totp/alice?secret=MZXW6YT', { strict: true }),
        OtpErrorCode.INVALID_BASE32_PADDING);
    });

    it('parse_defaultStaysLenientOnSameUri', 0, () => {
      // 同一 URI 不传 options：保持 v1 宽松行为，静默规范化为 'MZXW6YQ'
      const p: OtpAuthParams = OTPAuthURI.parse('otpauth://totp/alice?secret=MZXW6YT');
      expect(p.secret).assertEqual('MZXW6YQ');
    });

    it('build_exactTotpFullOutput', 0, () => {
      const p: OtpAuthParams = {
        type: OtpType.TOTP,
        secret: 'JBSWY3DPEHPK3PXP',
        algorithm: OtpAlgorithm.SHA256,
        digits: 8,
        period: 60,
        issuer: 'ACME Co',
        account: 'john@example.com'
      };
      expect(OTPAuthURI.build(p)).assertEqual(
        'otpauth://totp/ACME%20Co:john%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60'
      );
    });

    it('build_exactMinimalTotpOutput', 0, () => {
      const p: OtpAuthParams = {
        type: OtpType.TOTP,
        secret: 'JBSWY3DPEHPK3PXP',
        algorithm: OtpAlgorithm.SHA1,
        digits: 6,
        account: 'alice'
      };
      // 最小必填集 = type / secret / algorithm / digits / account（label 必填）；
      // digits=6 省略、period=30 省略、无 issuer 时 label 就是 account
      expect(OTPAuthURI.build(p)).assertEqual('otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1');
    });

    it('build_exactHotpOutput', 0, () => {
      const p: OtpAuthParams = {
        type: OtpType.HOTP,
        secret: 'JBSWY3DPEHPK3PXP',
        algorithm: OtpAlgorithm.SHA1,
        digits: 6,
        counter: 42,
        issuer: 'ACME Co',
        account: 'alice'
      };
      // HOTP 输出 counter 而非 period；digits=6 省略
      expect(OTPAuthURI.build(p)).assertEqual(
        'otpauth://hotp/ACME%20Co:alice?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA1&counter=42'
      );
    });

    it('build_normalizesSecret', 0, () => {
      // 小写+填充的 secret 经 build 规范化为大写无填充（与 parse 的 encode(decode()) 对称）：
      // decode 去空白/尾'='并转大写 → 'JBSWY3DPEHPK3PXP'，再 encode 得同形规范串。
      const p: OtpAuthParams = { type: OtpType.TOTP, secret: 'jbswy3dpeh pk3pxp=', algorithm: OtpAlgorithm.SHA1, digits: 6, account: 'alice' };
      expect(OTPAuthURI.build(p)).assertEqual('otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1');
    });

    it('build_invalidSecretChar_throws', 0, () => {
      // secret 含 base32 字母表外字符 → 与 parse 同样抛 INVALID_BASE32_CHAR
      const p: OtpAuthParams = { type: OtpType.TOTP, secret: 'JBSW!@#', algorithm: OtpAlgorithm.SHA1, digits: 6 };
      expectThrowsCode(() => { OTPAuthURI.build(p); }, OtpErrorCode.INVALID_BASE32_CHAR);
    });

    it('roundtrip_totpFullFields', 0, () => {
      const p: OtpAuthParams = {
        type: OtpType.TOTP,
        secret: 'JBSWY3DPEHPK3PXP',
        algorithm: OtpAlgorithm.SHA512,
        digits: 8,
        period: 60,
        issuer: 'ACME Co',
        account: 'john@example.com'
      };
      const back: OtpAuthParams = OTPAuthURI.parse(OTPAuthURI.build(p));
      assertParamsEqual(back, p);
    });

    it('roundtrip_hotp', 0, () => {
      const p: OtpAuthParams = {
        type: OtpType.HOTP,
        secret: 'JBSWY3DPEHPK3PXP',
        algorithm: OtpAlgorithm.SHA1,
        digits: 6,
        counter: 42,
        issuer: 'ACME Co',
        account: 'alice'
      };
      const back: OtpAuthParams = OTPAuthURI.parse(OTPAuthURI.build(p));
      assertParamsEqual(back, p);
    });

    it('build_colonHandling', 0, () => {
      // label 段不得含冒号（"Neither issuer nor account name may themselves contain a colon"）：
      // account 段的冒号不可表示，只能 fail-closed；issuer 是 pchar（RFC 3986 允许冒号），
      // 落在 issuer 参数上即可 —— 此时省略 label 前缀，往返无损
      const colonAccount: OtpAuthParams = {
        type: OtpType.TOTP, secret: 'JBSWY3DPEHPK3PXP', algorithm: OtpAlgorithm.SHA1,
        digits: 6, issuer: 'ACME', account: 'a:b'
      };
      const colonOnlyAccount: OtpAuthParams = {
        type: OtpType.TOTP, secret: 'JBSWY3DPEHPK3PXP', algorithm: OtpAlgorithm.SHA1,
        digits: 6, account: 'a:b'
      };
      expectThrowsCode(() => { OTPAuthURI.build(colonAccount); }, OtpErrorCode.INVALID_OTPAUTH_URI);
      expectThrowsCode(() => { OTPAuthURI.build(colonOnlyAccount); }, OtpErrorCode.INVALID_OTPAUTH_URI);

      const colonIssuer: OtpAuthParams = {
        type: OtpType.TOTP, secret: 'JBSWY3DPEHPK3PXP', algorithm: OtpAlgorithm.SHA1,
        digits: 6, issuer: 'AC:ME', account: 'alice'
      };
      const uri: string = OTPAuthURI.build(colonIssuer);
      expect(uri).assertEqual(
        'otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&issuer=AC%3AME&algorithm=SHA1');
      const back: OtpAuthParams = OTPAuthURI.parse(uri);
      expect(back.issuer).assertEqual('AC:ME');
      expect(back.account).assertEqual('alice');
    });

    it('parse_percent3ASeparatorIsSeparator', 0, () => {
      // ABNF 里分隔符是 `:` 或 `%3A`（大小写不敏感），与 query 里有没有 issuer 无关
      const upper: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/ACME%3Aco@example.com?secret=JBSWY3DPEHPK3PXP');
      expect(upper.issuer).assertEqual('ACME');
      expect(upper.account).assertEqual('co@example.com');
      const lower: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/ACME%3aco@example.com?secret=JBSWY3DPEHPK3PXP');
      expect(lower.issuer).assertEqual('ACME');
      expect(lower.account).assertEqual('co@example.com');

      // query issuer 存在但与 label 前缀不一致：规范要求两者相等（属签发方数据问题），
      // 不改变分隔符判定；issuer 量仍以 query 为准
      const mismatch: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/ACME%3Aalice?secret=JBSWY3DPEHPK3PXP&issuer=OTHER');
      expect(mismatch.issuer).assertEqual('OTHER');
      expect(mismatch.account).assertEqual('alice');
    });

    it('parse_specExampleWithSpacePadding', 0, () => {
      // Key URI Format 自带示例：Big%20Corporation%3A%20alice%40bigco.com
      // ABNF 的 `*"%20"` 表示分隔符后的空格是 padding，不属于 account
      const p: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/Big%20Corporation%3A%20alice%40bigco.com?secret=JBSWY3DPEHPK3PXP&issuer=Big%20Corporation');
      expect(p.issuer).assertEqual('Big Corporation');
      expect(p.account).assertEqual('alice@bigco.com');
    });

    it('parse_colonInAccountThrows', 0, () => {
      // 按首个 `:` / `%3A` 切分之后残余的冒号必然落在 account 里；规范禁止 label 段含
      // 冒号（且无法再序列化）→ parse 与 build 同口径拒绝
      expectThrowsCode(() => {
        OTPAuthURI.parse('otpauth://totp/ACME%3Aalice:bob?secret=JBSWY3DPEHPK3PXP');
      }, OtpErrorCode.INVALID_OTPAUTH_URI);
      expectThrowsCode(() => {
        OTPAuthURI.parse('otpauth://totp/ACME:a%3Ab?secret=JBSWY3DPEHPK3PXP');
      }, OtpErrorCode.INVALID_OTPAUTH_URI);
    });

    it('build_leadingSpaceAccountOmitsLabelPrefix', 0, () => {
      // 分隔符后的空格按 ABNF 是 padding（parse 会剥掉）：带 issuer 时若写前缀，
      // 前导空格会被吃掉。issuer 参数才是权威、label 前缀是可选的 → 省略前缀。
      const withIssuer: OtpAuthParams = {
        type: OtpType.TOTP, secret: 'JBSWY3DPEHPK3PXP', algorithm: OtpAlgorithm.SHA1,
        digits: 6, issuer: 'ACME', account: ' alice'
      };
      const uri: string = OTPAuthURI.build(withIssuer);
      expect(uri).assertEqual(
        'otpauth://totp/%20alice?secret=JBSWY3DPEHPK3PXP&issuer=ACME&algorithm=SHA1');
      const back: OtpAuthParams = OTPAuthURI.parse(uri);
      expect(back.issuer).assertEqual('ACME');
      expect(back.account).assertEqual(' alice');

      const noIssuer: OtpAuthParams = {
        type: OtpType.TOTP, secret: 'JBSWY3DPEHPK3PXP', algorithm: OtpAlgorithm.SHA1,
        digits: 6, account: ' alice'
      };
      const noIssuerUri: string = OTPAuthURI.build(noIssuer);
      expect(noIssuerUri).assertEqual(
        'otpauth://totp/%20alice?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1');
      expect(OTPAuthURI.parse(noIssuerUri).account).assertEqual(' alice');
    });

    it('emptyAccountFailsClosed', 0, () => {
      // label 只能由 account 派生，且 account 不可为空（Key URI Format 的 label 必填、
      // 草案 `account = 1*`）。`OtpAuthParams.account` 是**必填**字段，因此「字段缺失」
      // 由编译器拦截（ArkTS 侧无需也无从绕过）；运行期仍拒空串与空 label。
      const emptyAccount: OtpAuthParams = {
        type: OtpType.TOTP, secret: 'JBSWY3DPEHPK3PXP', algorithm: OtpAlgorithm.SHA1, digits: 6, account: ''
      };
      expectThrowsCode(() => { OTPAuthURI.build(emptyAccount); }, OtpErrorCode.INVALID_OTPAUTH_URI);
      expectThrowsCode(() => {
        OTPAuthURI.parse('otpauth://totp/?secret=JBSWY3DPEHPK3PXP&issuer=ACME');
      }, OtpErrorCode.INVALID_OTPAUTH_URI);
      expectThrowsCode(() => {
        OTPAuthURI.parse('otpauth://totp/ACME:?secret=JBSWY3DPEHPK3PXP');
      }, OtpErrorCode.INVALID_OTPAUTH_URI);
    });

    it('parse_labelContractAndDuplicates', 0, () => {
      // 已知参数重复 → 拒绝（草案 consumer MUST reject）；未知参数重复忽略
      expectThrowsCode(() => {
        OTPAuthURI.parse('otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&secret=MZXW6YTBOI');
      }, OtpErrorCode.INVALID_OTPAUTH_URI);
      const unknown: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP&foo=1&foo=2');
      expect(unknown.account).assertEqual('alice');

      // padding 矩阵：分隔符后可有零到多个 %20（原始空格为宽容超集）；无分隔符不剥
      const twoPadded: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/ACME%3A%20%20alice?secret=JBSWY3DPEHPK3PXP');
      expect(twoPadded.account).assertEqual('alice');
      const noSeparator: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/%20alice?secret=JBSWY3DPEHPK3PXP');
      expect(noSeparator.account).assertEqual(' alice');

      // `%253A` 解码后是字面量 `%3A`，不是分隔符
      const literal: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/ACME%253Aalice?secret=JBSWY3DPEHPK3PXP');
      expect(literal.issuer).assertUndefined();
      expect(literal.account).assertEqual('ACME%3Aalice');
    });

    it('roundtrip_minimalRequired', 0, () => {
      // 最小必填集 = type / secret / algorithm / digits / account（label 必填）
      const p: OtpAuthParams = {
        type: OtpType.TOTP,
        secret: 'JBSWY3DPEHPK3PXP',
        algorithm: OtpAlgorithm.SHA1,
        digits: 6,
        account: 'alice'
      };
      const back: OtpAuthParams = OTPAuthURI.parse(OTPAuthURI.build(p));
      assertParamsEqual(back, p);
    });

    it('build_loneSurrogateLabel_throws', 0, () => {
      // 孤立代理字符（如被截断的 emoji）会让 encodeURIComponent 抛原生 URIError；
      // 公开契约是一切失败均抛 OtpError，必须收敛为 INVALID_OTPAUTH_URI
      const loneSurrogate: string = String.fromCharCode(0xd800);
      const p: OtpAuthParams = {
        type: OtpType.TOTP,
        secret: 'JBSWY3DPEHPK3PXP',
        algorithm: OtpAlgorithm.SHA1,
        digits: 6,
        account: loneSurrogate
      };
      expectThrowsCode(() => OTPAuthURI.build(p), OtpErrorCode.INVALID_OTPAUTH_URI);
    });

    it('parse_separatorScanAfterExpandingCaseChar', 0, () => {
      // 'İ'（U+0130）小写后变成两个码位（i + U+0307）：在 `labelRaw.toLowerCase()` 上取
      // `%3A` 下标会比原始串多 1 → 切错。必须是**原始**的 İ 才触发；分隔符扫描改用原生
      // indexOf 后不再受影响
      const dotI: string = String.fromCharCode(0x130);
      const uri: string = 'otpauth://totp/' + dotI +
        '%3Aalice?secret=JBSWY3DPEHPK3PXP';
      const p: OtpAuthParams = OTPAuthURI.parse(uri);
      expect(p.issuer).assertEqual(dotI);
      expect(p.account).assertEqual('alice');
    });

    it('parse_inapplicableParamsIgnored', 0, () => {
      // type 不适用的 query 参数被忽略（TOTP 的 counter / HOTP 的 period）
      const totp: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&counter=42');
      expect(totp.counter).assertUndefined();
      expect(totp.period).assertEqual(30);
      const hotp: OtpAuthParams = OTPAuthURI.parse(
        'otpauth://hotp/a?secret=JBSWY3DPEHPK3PXP&period=60');
      expect(hotp.period).assertUndefined();
      expect(hotp.counter).assertEqual(0);
    });
  });
}
