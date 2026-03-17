/**
 * 路由模块
 *
 * - 保存被代理 IM 应用的全局配置
 * - 按 timbot userId 维护路由索引
 * - 支持单聊 To_Account 与群聊 @bot 的路由匹配
 * - 提供路由表的增删改查方法
 */

import type { GatewayConfig, RouteEntry, ImAppConfig } from "./types.js";
import { logDebug } from "./logger.js";

/** 按 timbot userId 查找路由 */
let routeMapByTimbotUserId: Map<string, RouteEntry> = new Map();

/** 被代理 IM 应用配置引用 */
let imAppConfig: ImAppConfig | null = null;

/** 当前完整配置引用（用于持久化） */
let gatewayConfig: GatewayConfig | null = null;

// ============================================================================
// 初始化
// ============================================================================

function rebuildRouteIndexes(routes: RouteEntry[]): void {
  routeMapByTimbotUserId = new Map();

  for (const route of routes) {
    const normalized = normalizeAccountId(route.timbotUserId);
    if (!normalized) continue;
    route.timbotUserId = normalized;
    routeMapByTimbotUserId.set(normalized, route);
  }
}

/** 用配置初始化路由表 */
export function initRouter(config: GatewayConfig): void {
  gatewayConfig = config;
  imAppConfig = config.imApp;
  rebuildRouteIndexes(config.routes);
  logDebug(`Router initialized with ${config.routes.length} routes`);
}

/** 获取当前完整配置引用 */
export function getGatewayConfig(): GatewayConfig | null {
  return gatewayConfig;
}

/** 获取被代理 IM 应用配置 */
export function getImAppConfig(): ImAppConfig | null {
  return imAppConfig;
}

// ============================================================================
// 路由查询
// ============================================================================

/** 统一标准化账号，兼容 @bot 和 bot 两种写法 */
export function normalizeAccountId(raw: string | null | undefined): string {
  return String(raw ?? "").trim().replace(/^[@＠]+/, "");
}

/** 判断 sdkAppId 是否与当前代理 IM 应用一致 */
export function isManagedSdkAppId(sdkAppId: string): boolean {
  return imAppConfig !== null && imAppConfig.sdkAppId === String(sdkAppId).trim();
}

/** 根据 timbot userId 查找路由 */
export function findRouteByTimbotUserId(timbotUserId: string): RouteEntry | undefined {
  const normalized = normalizeAccountId(timbotUserId);
  if (!normalized) return undefined;
  return routeMapByTimbotUserId.get(normalized);
}

/** 根据 timbot userId 查找路由 */
export function findRoute(identifier: string): RouteEntry | undefined {
  return findRouteByTimbotUserId(identifier);
}

/** 获取所有路由 */
export function getRoutes(): RouteEntry[] {
  return gatewayConfig ? [...gatewayConfig.routes] : Array.from(routeMapByTimbotUserId.values());
}

/** 获取已注册的 timbot userId 列表 */
export function listRouteTimbotUserIds(): string[] {
  return getRoutes().map((route) => route.timbotUserId);
}

// ============================================================================
// 路由表动态操作
// ============================================================================

/** 添加路由 */
export function addRoute(entry: RouteEntry): boolean {
  const normalizedTimbotUserId = normalizeAccountId(entry.timbotUserId);
  if (!normalizedTimbotUserId) {
    return false;
  }

  if (findRouteByTimbotUserId(normalizedTimbotUserId)) {
    return false;
  }

  const normalizedEntry: RouteEntry = {
    ...entry,
    timbotUserId: normalizedTimbotUserId,
    webhookPath: entry.webhookPath || "/timbot",
    enabled: entry.enabled !== false,
  };

  routeMapByTimbotUserId.set(normalizedTimbotUserId, normalizedEntry);
  if (gatewayConfig) {
    gatewayConfig.routes.push(normalizedEntry);
  }
  return true;
}

/** 删除路由（支持 timbot userId） */
export function removeRoute(identifier: string): boolean {
  const route = findRoute(identifier);
  if (!route) {
    return false;
  }

  routeMapByTimbotUserId.delete(normalizeAccountId(route.timbotUserId));
  if (gatewayConfig) {
    gatewayConfig.routes = gatewayConfig.routes.filter(
      (item) => normalizeAccountId(item.timbotUserId) !== normalizeAccountId(route.timbotUserId)
    );
  }
  return true;
}

/** 启用路由（支持 timbot userId） */
export function enableRoute(identifier: string): boolean {
  const route = findRoute(identifier);
  if (!route) return false;
  route.enabled = true;
  return true;
}

/** 禁用路由（支持 timbot userId） */
export function disableRoute(identifier: string): boolean {
  const route = findRoute(identifier);
  if (!route) return false;
  route.enabled = false;
  return true;
}

// ============================================================================
// FNV-1a 哈希（保留给后续 sticky session 扩展）
// ============================================================================

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32-bit 哈希算法
 * 轻量且分布均匀，适合 sticky session 场景
 */
export function fnv1aHash(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * 构建转发目标 URL
 *
 * @param route 匹配到的路由条目
 * @param originalQueryString 原始请求的 query string（不含 ?）
 * @returns 完整的转发目标 URL
 */
export function buildTargetUrl(route: RouteEntry, originalQueryString: string): string {
  const base = route.backend.replace(/\/+$/, "");
  const path = route.webhookPath.startsWith("/") ? route.webhookPath : `/${route.webhookPath}`;
  const qs = originalQueryString ? `?${originalQueryString}` : "";
  return `${base}${path}${qs}`;
}
