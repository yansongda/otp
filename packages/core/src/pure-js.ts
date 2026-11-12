/**
 * 纯 JS 兜底 crypto 入口（仅需要无平台 crypto 的环境引用，如微信小程序）。
 * ohos 不得 import 本入口。
 */
export { installPureJsHmac, PureJsHmac } from "./pure-js/pure-js-hmac";
