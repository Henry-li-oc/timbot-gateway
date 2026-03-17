/**
 * 配置加载与持久化模块
 *
 * - 从 YAML 文件读取配置并校验
 * - 支持配置持久化写回（原子写入）
 */

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import YAML from "yaml";
import type { GatewayConfig, RouteEntry } from "./types.js";
import { logInfo, logError } from "./logger.js";

/** 配置文件路径（运行时记录，用于持久化写回） */
let configFilePath = "";

/** 获取当前配置文件路径 */
export function getConfigFilePath(): string {
  return configFilePath;
}

function normalizeAccountId(raw: unknown): string {
  return String(raw ?? "").trim().replace(/^[@＠]+/, "");
}

/**
 * 从 YAML 文件加载并校验配置
 */
export function loadConfig(filePath: string): GatewayConfig {
  configFilePath = resolve(filePath);
  logInfo(`Loading config from: ${configFilePath}`);

  let raw: string;
  try {
    raw = readFileSync(configFilePath, "utf-8");
  } catch (err: any) {
    throw new Error(`Failed to read config file: ${configFilePath}\n${err.message}`);
  }

  let parsed: any;
  try {
    parsed = YAML.parse(raw);
  } catch (err: any) {
    throw new Error(`Failed to parse YAML config: ${err.message}`);
  }

  return validateConfig(parsed);
}

/**
 * 校验配置完整性并设置默认值
 */
function validateConfig(raw: any): GatewayConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("Config must be a YAML object");
  }

  const server = {
    port: raw.server?.port ?? 8080,
    host: raw.server?.host ?? "0.0.0.0",
  };

  const rawImApp = raw.imApp ?? raw.adminBot;
  if (!rawImApp) {
    throw new Error("Config missing required field: imApp");
  }

  const sdkAppId = String(rawImApp.sdkAppId ?? rawImApp.SDKAppId ?? "").trim();
  const secretKey = String(rawImApp.secretKey ?? rawImApp.SecretKey ?? "").trim();
  const appAdmin = normalizeAccountId(rawImApp.appAdmin ?? rawImApp.AppAdmin ?? rawImApp.botAccount);
  const botManager = normalizeAccountId(rawImApp.botManager ?? rawImApp.BotManager ?? rawImApp.adminUserId);
  const callbackToken = String(rawImApp.callbackToken ?? rawImApp.CallbackToken ?? "my_token").trim() || "my_token";

  if (!sdkAppId) {
    throw new Error("Config missing required field: imApp.sdkAppId");
  }
  if (!secretKey) {
    throw new Error("Config missing required field: imApp.secretKey");
  }
  if (!appAdmin) {
    throw new Error("Config missing required field: imApp.appAdmin");
  }
  if (!botManager) {
    throw new Error("Config missing required field: imApp.botManager");
  }

  const imApp = {
    sdkAppId,
    callbackToken,
    secretKey,
    appAdmin,
    botManager,
    apiDomain: rawImApp.apiDomain ?? "console.tim.qq.com",
  };

  const routes: RouteEntry[] = [];
  if (Array.isArray(raw.routes)) {
    for (const r of raw.routes) {
      const timbotUserId = normalizeAccountId(r.timbotUserId ?? r.timbot_userid ?? r.botAccount);
      if (!timbotUserId) {
        throw new Error("Route missing required field: timbotUserId");
      }
      if (!r.backend) {
        throw new Error(`Route \"${timbotUserId}\" missing required field: backend`);
      }
      routes.push({
        timbotUserId,
        backend: String(r.backend),
        webhookPath: r.webhookPath ?? "/timbot",
        enabled: r.enabled !== false,
        description: r.description,
      });
    }
  }

  const healthCheck = {
    enabled: raw.healthCheck?.enabled !== false,
    intervalMs: raw.healthCheck?.intervalMs ?? 30000,
    timeoutMs: raw.healthCheck?.timeoutMs ?? 5000,
  };

  const validLevels = ["debug", "info", "warn", "error"];
  const loggingLevel = validLevels.includes(raw.logging?.level)
    ? raw.logging.level
    : "info";
  const logging = { level: loggingLevel as GatewayConfig["logging"]["level"] };

  return { server, imApp, routes, healthCheck, logging };
}

/**
 * 将配置持久化写回 YAML 文件（原子写入：写临时文件 + rename）
 */
export function saveConfig(config: GatewayConfig): void {
  if (!configFilePath) {
    throw new Error("Config file path not set. Load config first.");
  }

  const serializable: any = {
    server: config.server,
    imApp: {
      sdkAppId: config.imApp.sdkAppId,
      callbackToken: config.imApp.callbackToken,
      secretKey: config.imApp.secretKey,
      appAdmin: config.imApp.appAdmin,
      botManager: config.imApp.botManager,
      ...(config.imApp.apiDomain && config.imApp.apiDomain !== "console.tim.qq.com"
        ? { apiDomain: config.imApp.apiDomain }
        : {}),
    },
    routes: config.routes.map((r) => {
      const entry: any = {
        timbotUserId: r.timbotUserId,
        backend: r.backend,
        webhookPath: r.webhookPath,
        enabled: r.enabled,
      };
      if (r.description) entry.description = r.description;
      return entry;
    }),
    healthCheck: config.healthCheck,
    logging: config.logging,
  };

  const yamlStr = YAML.stringify(serializable, {
    lineWidth: 120,
    defaultStringType: "QUOTE_DOUBLE",
  });

  const tmpFile = configFilePath + `.tmp.${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(tmpFile, yamlStr, "utf-8");
    renameSync(tmpFile, configFilePath);
    logInfo(`Config saved to: ${configFilePath}`);
  } catch (err: any) {
    logError(`Failed to save config: ${err.message}`);
    try {
      writeFileSync(tmpFile, "", "utf-8");
    } catch {}
    throw err;
  }
}
