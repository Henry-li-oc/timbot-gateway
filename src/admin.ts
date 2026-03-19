/**
 * 管理命令处理模块
 *
 * 处理 BotManager 通过 IM 发送的管理命令：
 * /addbot, /removebot, /list, /status, /enable, /disable, /reload, /help
 */

import type {
  WebhookMessage,
  ParsedCommand,
  AdminCommandName,
  RouteEntry,
} from "./types.js";
import {
  getRoutes,
  addRoute,
  removeRoute,
  enableRoute,
  disableRoute,
  getImAppConfig,
  initRouter,
  getGatewayConfig,
  normalizeAccountId,
} from "./router.js";
import { saveConfig, loadConfig, getConfigFilePath } from "./config.js";
import { sendTextMessage } from "./im-client.js";
import { getHealthStatuses } from "./health.js";
import { logInfo, logWarn, logError } from "./logger.js";

function extractText(msg: WebhookMessage): string {
  if (!msg.MsgBody || !Array.isArray(msg.MsgBody)) return "";

  const texts: string[] = [];
  for (const item of msg.MsgBody) {
    if (item.MsgType === "TIMTextElem" && item.MsgContent?.Text) {
      texts.push(item.MsgContent.Text);
    }
  }
  return texts.join("").trim();
}

const VALID_COMMANDS: Set<string> = new Set([
  "addbot",
  "removebot",
  "list",
  "status",
  "enable",
  "disable",
  "reload",
  "help",
]);

function parseCommand(text: string): ParsedCommand | null {
  if (!text.startsWith("/")) return null;

  const parts = text.split(/\s+/);
  const cmdName = parts[0].substring(1).toLowerCase();

  if (!VALID_COMMANDS.has(cmdName)) return null;

  return {
    name: cmdName as AdminCommandName,
    args: parts.slice(1),
    rawText: text,
  };
}

export async function handleAdminMessage(msg: WebhookMessage): Promise<boolean> {
  const imAppConfig = getImAppConfig();
  if (!imAppConfig) {
    logError("IM app config not available");
    return false;
  }

  if (msg.CallbackCommand !== "Bot.OnC2CMessage" && msg.CallbackCommand !== "Bot.OnC2cMessage") {
    return false;
  }

  const text = extractText(msg);
  if (!text) return false;

  const cmd = parseCommand(text);
  if (!cmd) return false;

  const fromAccount = normalizeAccountId(msg.From_Account);
  const toAccount = normalizeAccountId(msg.To_Account);
  const expectedManager = normalizeAccountId(imAppConfig.botManager);
  const expectedAdministrator = normalizeAccountId(imAppConfig.appAdmin);

  if (fromAccount !== expectedManager || toAccount !== expectedAdministrator) {
    logWarn(
      `Unauthorized admin command attempt: from=${msg.From_Account}, to=${msg.To_Account} (expected from=${imAppConfig.botManager}, to=${imAppConfig.appAdmin})`
    );
    return false;
  }

  logInfo(`Admin command: ${cmd.name} [${cmd.args.join(", ")}] from ${msg.From_Account}`);

  let replyText: string;
  try {
    replyText = await executeCommand(cmd);
  } catch (err: any) {
    replyText = `❌ 命令执行失败: ${err.message}`;
    logError(`Command error: ${err.message}`);
  }

  await sendTextMessage(imAppConfig, imAppConfig.botManager, replyText);

  return true;
}

async function executeCommand(cmd: ParsedCommand): Promise<string> {
  switch (cmd.name) {
    case "addbot":
      return handleAddBot(cmd.args);
    case "removebot":
      return handleRemoveBot(cmd.args);
    case "list":
      return handleList();
    case "status":
      return handleStatus();
    case "enable":
      return handleEnable(cmd.args);
    case "disable":
      return handleDisable(cmd.args);
    case "reload":
      return handleReload();
    case "help":
      return handleHelp();
    default:
      return `❓ 未知命令: /${cmd.name}\n输入 /help 查看可用命令`;
  }
}

/**
 * /addbot <timbot_userid> <backend_url> [description]
 */
function handleAddBot(args: string[]): string {
  if (args.length < 2) {
    return "❌ 用法: /addbot <timbot_userid> <backend_url> [description]\n示例: /addbot bot_a http://10.0.1.10:3000 生产Bot";
  }

  const [rawTimbotUserId, backend, ...descParts] = args;
  const timbotUserId = normalizeAccountId(rawTimbotUserId);
  const description = descParts.join(" ") || undefined;

  if (!timbotUserId) {
    return "❌ timbot_userid 不能为空";
  }

  try {
    const url = new URL(backend);
    if (!["http:", "https:"].includes(url.protocol)) {
      return `❌ backend_url 必须是 http/https 地址: ${backend}`;
    }
  } catch {
    return `❌ 非法 backend_url: ${backend}`;
  }

  const entry: RouteEntry = {
    timbotUserId,
    backend,
    webhookPath: "/timbot",
    enabled: true,
    description,
  };

  if (!addRoute(entry)) {
    return `❌ 路由已存在: ${timbotUserId}\n如需修改，请先 /removebot ${timbotUserId}`;
  }

  persistConfig();

  return `✅ 路由已添加:\n  timbotUserId: ${timbotUserId}\n  backend: ${backend}${description ? `\n  描述: ${description}` : ""}\n  状态: 启用`;
}

/**
 * /removebot <timbot_userid>
 */
function handleRemoveBot(args: string[]): string {
  if (args.length < 1) {
    return "❌ 用法: /removebot <timbot_userid>\n示例: /removebot bot_a";
  }

  const identifier = normalizeAccountId(args[0]);

  if (!removeRoute(identifier)) {
    return `❌ 路由不存在: ${identifier}`;
  }

  persistConfig();

  return `✅ 路由已删除: ${identifier}`;
}

/**
 * /list
 */
function handleList(): string {
  const routes = getRoutes();
  const imAppConfig = getImAppConfig();

  if (routes.length === 0) {
    return "📋 当前无路由配置";
  }

  const lines = ["📋 路由列表:"];
  if (imAppConfig) {
    lines.push(`IM 应用: ${imAppConfig.sdkAppId}`);
  }
  lines.push("─".repeat(30));

  for (const r of routes) {
    const status = r.enabled ? "🟢 启用" : "🔴 禁用";
    lines.push(`${status} ${r.timbotUserId}`);
    lines.push(`   → ${r.backend}${r.webhookPath}`);
    if (r.description) lines.push(`   📝 ${r.description}`);
    lines.push("");
  }

  lines.push(`共 ${routes.length} 条路由`);
  return lines.join("\n");
}

/**
 * /status
 */
function handleStatus(): string {
  const healthStatuses = getHealthStatuses();
  const routes = getRoutes();
  const imAppConfig = getImAppConfig();

  if (routes.length === 0) {
    return "📊 当前无路由配置";
  }

  const lines = ["📊 节点状态:"];
  if (imAppConfig) {
    lines.push(`IM 应用: ${imAppConfig.sdkAppId}`);
  }
  lines.push("─".repeat(30));

  for (const r of routes) {
    const health = healthStatuses.find((h) => h.backend === r.backend);
    const routeStatus = r.enabled ? "启用" : "禁用";

    let healthIcon: string;
    let healthText: string;
    if (!health) {
      healthIcon = "⚪";
      healthText = "未检查";
    } else if (health.healthy) {
      healthIcon = "🟢";
      healthText = "健康";
    } else {
      healthIcon = "🔴";
      healthText = `不健康 (${health.lastError || "unknown"})`;
    }

    const lastCheck = health ? new Date(health.lastCheck).toLocaleString() : "N/A";

    lines.push(`${healthIcon} ${r.timbotUserId} [${routeStatus}]`);
    lines.push(`   → ${r.backend}`);
    lines.push(`   健康: ${healthText}`);
    lines.push(`   最后检查: ${lastCheck}`);
    if (r.description) lines.push(`   📝 ${r.description}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * /enable <timbot_userid>
 */
function handleEnable(args: string[]): string {
  if (args.length < 1) {
    return "❌ 用法: /enable <timbot_userid>";
  }

  const identifier = normalizeAccountId(args[0]);

  if (!enableRoute(identifier)) {
    return `❌ 路由不存在: ${identifier}`;
  }

  persistConfig();

  return `✅ 路由已启用: ${identifier}`;
}

/**
 * /disable <timbot_userid>
 */
function handleDisable(args: string[]): string {
  if (args.length < 1) {
    return "❌ 用法: /disable <timbot_userid>";
  }

  const identifier = normalizeAccountId(args[0]);

  if (!disableRoute(identifier)) {
    return `❌ 路由不存在: ${identifier}`;
  }

  persistConfig();

  return `✅ 路由已禁用: ${identifier}`;
}

/**
 * /reload
 */
function handleReload(): string {
  try {
    const configPath = getConfigFilePath();
    if (!configPath) {
      return "❌ 配置文件路径未知，无法重新加载";
    }

    const newConfig = loadConfig(configPath);
    initRouter(newConfig);

    return `✅ 配置已重新加载\nIM 应用: ${newConfig.imApp.sdkAppId}\n共 ${newConfig.routes.length} 条路由`;
  } catch (err: any) {
    return `❌ 配置重新加载失败: ${err.message}`;
  }
}

/**
 * /help
 */
function handleHelp(): string {
  return [
    "🤖 timbot-gateway 管理命令:",
    "─".repeat(30),
    "/addbot <timbot_userid> <url> [描述]  添加路由",
    "/removebot <timbot_userid>           删除路由",
    "/list                                列出所有路由",
    "/status                              查看节点状态",
    "/enable <timbot_userid>              启用路由",
    "/disable <timbot_userid>             禁用路由",
    "/reload                              重新加载配置",
    "/help                                显示此帮助",
  ].join("\n");
}

function persistConfig(): void {
  try {
    const config = getGatewayConfig();
    if (config) {
      saveConfig(config);
    }
  } catch (err: any) {
    logError(`Failed to persist config: ${err.message}`);
  }
}
