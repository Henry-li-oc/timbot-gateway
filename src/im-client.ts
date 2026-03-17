/**
 * 腾讯 IM REST API 客户端
 *
 * 封装 UserSig 生成和消息发送，供管理命令结果回发使用。
 */

import type { ImAppConfig } from "./types.js";
import { logDebug, logError } from "./logger.js";

// @ts-ignore — JS 模块，TS 类型由 .d.ts 提供
import { genTestUserSig } from "./debug/GenerateTestUserSig-es.js";

/** UserSig 缓存，避免每次发消息都重新生成 */
let cachedUserSig: { cacheKey: string; sig: string; expireAt: number } | null = null;

function generateUserSigSilently(config: ImAppConfig) {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  try {
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    console.error = () => {};

    return genTestUserSig({
      userID: config.appAdmin,
      SDKAppID: Number(config.sdkAppId),
      SecretKey: config.secretKey,
    });
  } finally {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
}

/**
 * 获取或刷新 UserSig
 * 缓存有效期为 6 天（实际签发 7 天），过期前自动刷新
 */
function getUserSig(config: ImAppConfig): string {
  const now = Date.now();
  const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
  const cacheKey = `${config.sdkAppId}:${config.appAdmin}:${config.secretKey}`;

  if (cachedUserSig && cachedUserSig.cacheKey === cacheKey && cachedUserSig.expireAt > now) {
    return cachedUserSig.sig;
  }

  const result = generateUserSigSilently(config);

  if (!result || !result.userSig) {
    throw new Error("Failed to generate UserSig");
  }

  cachedUserSig = {
    cacheKey,
    sig: result.userSig,
    expireAt: now + SIX_DAYS_MS,
  };

  logDebug("UserSig generated/refreshed for AppAdmin");
  return cachedUserSig.sig;
}

/**
 * 构建腾讯 IM REST API URL
 */
function buildApiUrl(config: ImAppConfig, apiPath: string): string {
  const domain = config.apiDomain || "console.tim.qq.com";
  const userSig = getUserSig(config);
  const random = Math.floor(Math.random() * 4294967295);
  return `https://${domain}/v4/${apiPath}?sdkappid=${config.sdkAppId}&identifier=${config.appAdmin}&usersig=${encodeURIComponent(userSig)}&random=${random}&contenttype=json`;
}

/**
 * 通过腾讯 IM REST API 发送文本消息
 *
 * @param config IM 应用配置
 * @param toAccount 接收者 userId
 * @param text 文本内容
 */
export async function sendTextMessage(
  config: ImAppConfig,
  toAccount: string,
  text: string
): Promise<boolean> {
  const url = buildApiUrl(config, "openim/sendmsg");

  const body = {
    SyncOtherMachine: 2,
    From_Account: config.appAdmin,
    To_Account: toAccount,
    MsgRandom: Math.floor(Math.random() * 2147483647) + 1,
    MsgLifeTime: 60,
    MsgBody: [
      {
        MsgType: "TIMTextElem",
        MsgContent: {
          Text: text,
        },
      },
    ],
  };

  try {
    logDebug(`Sending IM message to ${toAccount}: ${text.substring(0, 50)}...`);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await response.json() as any;

    if (result.ActionStatus === "OK") {
      logDebug(`IM message sent successfully to ${toAccount}`);
      return true;
    } else {
      logError(`IM send failed: ${result.ErrorInfo || JSON.stringify(result)}`);
      return false;
    }
  } catch (err: any) {
    logError(`IM send error: ${err.message}`);
    return false;
  }
}
