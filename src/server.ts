/**
 * HTTP 服务器模块
 *
 * 创建 node:http 服务器，请求入口分发：
 * - POST /timbot → 签名校验 / 管理命令判断 / 路由转发
 * - GET /gateway/status → 管理状态接口
 * - 其他 → 404/405
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { URL } from "node:url";
import type { GatewayConfig, RouteEntry, WebhookMessage } from "./types.js";
import {
  isManagedSdkAppId,
  findRouteByTimbotUserId,
  buildTargetUrl,
  normalizeAccountId,
  getRoutes,
  getImAppConfig,
} from "./router.js";
import { readRequestBody, forwardRequest } from "./proxy.js";
import { handleAdminMessage } from "./admin.js";
import { getHealthStatuses } from "./health.js";
import { logInfo, logDebug, logWarn, logError } from "./logger.js";


export function extractMentionedTimbotUserIds(text: string): string[] {
  const mentions = new Set<string>();
  const regex = /(^|\s)[@＠]([^\s@＠]+)/g;
  for (const match of text.matchAll(regex)) {
    const candidate = normalizeAccountId(match[2]);
    if (candidate) mentions.add(candidate);
  }
  return [...mentions];
}


function isC2CMessage(msg: WebhookMessage): boolean {
  return msg.CallbackCommand === "Bot.OnC2CMessage" || msg.CallbackCommand === "C2C.CallbackAfterSendMsg";
}

function isGroupMessage(msg: WebhookMessage): boolean {
  return msg.CallbackCommand === "Bot.OnGroupMessage";
}


function buildExpectedSignature(token: string, requestTime: string): string {
  return createHash("sha256").update(`${token}${requestTime}`).digest("hex");
}

export function validateWebhookSignature(
  requestTime: string | null,
  sign: string | null,
  token: string
): { ok: boolean; reason?: string } {
  if (!requestTime) {
    return { ok: false, reason: "missing RequestTime" };
  }

  if (!sign) {
    return { ok: false, reason: "missing Sign" };
  }

  const expected = buildExpectedSignature(token, requestTime).toLowerCase();
  const provided = sign.trim().toLowerCase();
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");

  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false, reason: "signature length mismatch" };
  }

  if (!timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: "signature mismatch" };
  }

  return { ok: true };
}

function isAdminConversation(msg: WebhookMessage): boolean {
  const imAppConfig = getImAppConfig();
  if (!imAppConfig) return false;

  return (
    isC2CMessage(msg) &&
    normalizeAccountId(msg.To_Account) === normalizeAccountId(imAppConfig.appAdmin)
  );
}

export function resolveRouteForWebhook(msg: WebhookMessage): { route?: RouteEntry; dropReason?: string } {
  // 单聊消息：通过 To_Account 匹配路由
  if (isC2CMessage(msg)) {
    const toAccount = normalizeAccountId(msg.To_Account);
    if (!toAccount) {
      return { dropReason: "missing To_Account" };
    }

    const route = findRouteByTimbotUserId(toAccount);
    if (!route) {
      return { dropReason: `unknown To_Account: ${msg.To_Account}` };
    }

    return { route };
  }

  // 群消息：通过 AtRobots_Account 匹配路由
  if (isGroupMessage(msg)) {
    const atRobots = msg.AtRobots_Account;
    if (!Array.isArray(atRobots) || atRobots.length === 0) {
      return { dropReason: "missing AtRobots_Account" };
    }

    // 逐个匹配被@的机器人，找到第一个有路由的
    for (const robotAccount of atRobots) {
      const normalized = normalizeAccountId(robotAccount);
      if (!normalized) continue;

      const route = findRouteByTimbotUserId(normalized);
      if (route) {
        return { route };
      }
    }

    return { dropReason: `no matching route for AtRobots: ${atRobots.join(", ")}` };
  }

  return { dropReason: `unsupported CallbackCommand: ${msg.CallbackCommand}` };
}

/**
 * 创建并返回 HTTP 服务器（不立即监听）
 */
export function createGatewayServer(config: GatewayConfig): Server {
  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, config);
    } catch (err: any) {
      logError(`Unhandled error: ${err.message}`);
      sendJson(res, 500, { error: "Internal Server Error" });
    }
  });

  return server;
}

/**
 * 主请求处理入口
 */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: GatewayConfig
): Promise<void> {
  const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = urlObj.pathname;
  const method = (req.method || "GET").toUpperCase();

  logDebug(`${method} ${req.url}`);

  if (pathname === "/gateway/status" && method === "GET") {
    return handleStatusApi(res, config);
  }

  if (pathname === "/timbot" && method === "POST") {
    return handleWebhook(req, res, urlObj, config);
  }

  if (pathname === "/timbot" && method !== "POST") {
    sendJson(res, 405, { error: "Method Not Allowed" });
    return;
  }

  sendJson(res, 404, { error: "Not Found" });
}

/**
 * 处理 Webhook POST 请求
 */
async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  urlObj: URL,
  config: GatewayConfig
): Promise<void> {
  const sdkAppId = urlObj.searchParams.get("SdkAppid");
  if (!sdkAppId) {
    logWarn("Webhook request missing SdkAppid query parameter");
    sendJson(res, 400, { error: "Missing SdkAppid parameter" });
    return;
  }

  if (!isManagedSdkAppId(sdkAppId)) {
    logWarn(`Webhook request rejected due to unexpected SdkAppid: ${sdkAppId}`);
    sendJson(res, 403, { error: "Invalid SdkAppid" });
    return;
  }

  const signatureValidation = validateWebhookSignature(
    urlObj.searchParams.get("RequestTime"),
    urlObj.searchParams.get("Sign"),
    config.imApp.callbackToken
  );
  if (!signatureValidation.ok) {
    logWarn(`Webhook signature validation failed: ${signatureValidation.reason}`);
    sendJson(res, 403, { error: "Signature verification failed" });
    return;
  }

  let body: Buffer;
  try {
    body = await readRequestBody(req);
  } catch (err: any) {
    if (err.message.includes("exceeds")) {
      sendJson(res, 413, { error: "Request Entity Too Large" });
    } else {
      sendJson(res, 400, { error: "Failed to read request body" });
    }
    return;
  }

  let msgObj: WebhookMessage;
  try {
    msgObj = JSON.parse(body.toString("utf-8"));
  } catch {
    logWarn("Failed to parse webhook body as JSON");
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (isAdminConversation(msgObj)) {
    return handleAdminWebhook(msgObj, res);
  }

  const decision = resolveRouteForWebhook(msgObj);
  if (!decision.route) {
    logInfo(`Dropping webhook: SdkAppid=${sdkAppId}, reason=${decision.dropReason || "no matching route"}`);
    return sendOk(res);
  }

  if (!decision.route.enabled) {
    logWarn(`Route disabled for timbotUserId=${decision.route.timbotUserId}`);
    return sendOk(res);
  }

  const queryString = urlObj.search ? urlObj.search.substring(1) : "";
  const targetUrl = buildTargetUrl(decision.route, queryString);

  const target = msgObj.To_Account
    ? `To=${msgObj.To_Account}`
    : `AtRobots=${(msgObj.AtRobots_Account || []).join(",")} Group=${msgObj.GroupId || "?"}`;

  logInfo(
    `Forwarding: SdkAppid=${sdkAppId} ${target} From=${msgObj.From_Account || "?"} → ${decision.route.backend}`
  );

  // 立即给 IM 回 200 OK，避免后端慢或异常时 IM 重试导致重复消息
  sendOk(res);

  // 异步转发到后端，错误仅记录日志
  forwardRequest(targetUrl, body, req.headers)
    .then((result) => {
      if (result.statusCode >= 400) {
        logWarn(`Backend returned ${result.statusCode} for ${targetUrl}`);
      }
    })
    .catch((err) => {
      logError(`Unexpected forward error: ${err.message}`);
    });
}

/**
 * 处理管理命令 Webhook
 */
async function handleAdminWebhook(
  msg: WebhookMessage,
  res: ServerResponse
): Promise<void> {
  sendOk(res);

  try {
    await handleAdminMessage(msg);
  } catch (err: any) {
    logError(`Admin message handling error: ${err.message}`);
  }
}

/**
 * GET /gateway/status — 管理状态接口
 */
function handleStatusApi(res: ServerResponse, config: GatewayConfig): void {
  const routes = getRoutes();
  const healthStatuses = getHealthStatuses();

  const status = {
    gateway: "running",
    timestamp: new Date().toISOString(),
    imApp: {
      sdkAppId: config.imApp.sdkAppId,
      appAdmin: config.imApp.appAdmin,
      botManager: config.imApp.botManager,
    },
    routes: routes.map((r) => {
      const health = healthStatuses.find((h) => h.backend === r.backend);
      return {
        timbotUserId: r.timbotUserId,
        backend: r.backend,
        webhookPath: r.webhookPath,
        enabled: r.enabled,
        description: r.description,
        health: health
          ? {
              healthy: health.healthy,
              lastCheck: new Date(health.lastCheck).toISOString(),
              lastError: health.lastError,
            }
          : null,
      };
    }),
    totalRoutes: routes.length,
    enabledRoutes: routes.filter((r) => r.enabled).length,
  };

  sendJson(res, 200, status);
}

// ============================================================================
// 工具函数
// ============================================================================

function sendOk(res: ServerResponse): void {
  sendJson(res, 200, { ActionStatus: "OK", ErrorCode: 0, ErrorInfo: "" });
}

function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
