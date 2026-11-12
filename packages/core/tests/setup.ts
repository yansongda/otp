/**
 * core 测试统一入口：注册纯 JS HMAC 兜底实现。
 *
 * core 的公开 barrel 刻意不做注册（注册是平台差异：ohos 用 cryptoFramework、小程序用纯 JS），
 * 因此单测通过 bunfig preload 显式安装。
 */
import { installPureJsHmac } from "../src/pure-js/pure-js-hmac";

installPureJsHmac();
