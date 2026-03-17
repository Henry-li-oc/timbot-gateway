/**
 * 健康检查模块
 *
 * 定时对所有 enabled 的后端节点发送 HEAD 请求探活，
 * 维护节点状态 Map，提供 getHealthStatus() 供查询。
 */

import type { HealthCheckConfig, HealthStatus, RouteEntry } from "./types.js";
import { logDebug, logWarn, logInfo } from "./logger.js";

/** 节点健康状态 Map<backend, HealthStatus> */
const healthMap: Map<string, HealthStatus> = new Map();

/** 健康检查定时器 */
let checkTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 对单个后端节点执行健康检查
 */
async function checkBackend(route: RouteEntry, timeoutMs: number): Promise<void> {
  const key = route.backend;
  const url = `${key.replace(/\/+$/, "")}/`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    healthMap.set(key, {
      backend: key,
      timbotUserId: route.timbotUserId,
      healthy: response.status < 500,
      lastCheck: Date.now(),
    });

    logDebug(`Health check OK: ${key} (status=${response.status})`);
  } catch (err: any) {
    const prev = healthMap.get(key);
    const wasHealthy = prev?.healthy !== false;

    healthMap.set(key, {
      backend: key,
      timbotUserId: route.timbotUserId,
      healthy: false,
      lastCheck: Date.now(),
      lastError: err.name === "AbortError" ? "Timeout" : err.message,
    });

    if (wasHealthy) {
      logWarn(`Health check FAILED: ${key} — ${err.message}`);
    }
  }
}

/**
 * 执行一轮健康检查（检查所有 enabled 路由）
 */
async function runHealthChecks(routes: RouteEntry[], timeoutMs: number): Promise<void> {
  const enabledRoutes = routes.filter((r) => r.enabled);
  const seen = new Set<string>();
  const uniqueRoutes: RouteEntry[] = [];
  for (const route of enabledRoutes) {
    if (!seen.has(route.backend)) {
      seen.add(route.backend);
      uniqueRoutes.push(route);
    }
  }

  await Promise.allSettled(uniqueRoutes.map((r) => checkBackend(r, timeoutMs)));
}

/**
 * 启动健康检查定时器
 */
export function startHealthCheck(
  config: HealthCheckConfig,
  getRoutes: () => RouteEntry[]
): void {
  if (!config.enabled) {
    logInfo("Health check disabled");
    return;
  }

  logInfo(`Health check started (interval=${config.intervalMs}ms, timeout=${config.timeoutMs}ms)`);

  runHealthChecks(getRoutes(), config.timeoutMs);

  checkTimer = setInterval(() => {
    runHealthChecks(getRoutes(), config.timeoutMs);
  }, config.intervalMs);

  if (checkTimer.unref) {
    checkTimer.unref();
  }
}

/**
 * 停止健康检查
 */
export function stopHealthCheck(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
    logInfo("Health check stopped");
  }
}

/**
 * 获取所有节点的健康状态
 */
export function getHealthStatuses(): HealthStatus[] {
  return Array.from(healthMap.values());
}

/**
 * 获取指定后端的健康状态
 */
export function getBackendHealth(backend: string): HealthStatus | undefined {
  return healthMap.get(backend);
}
