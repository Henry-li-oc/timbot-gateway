/**
 * timbot-gateway 入口文件
 *
 * 解析命令行参数（--config 指定配置路径）
 * 加载配置 → 初始化路由 → 启动 HTTP 服务器 → 启动健康检查
 * 注册 SIGINT/SIGTERM 优雅退出
 */

import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { initRouter, getRoutes } from "./router.js";
import { createGatewayServer } from "./server.js";
import { startHealthCheck, stopHealthCheck } from "./health.js";
import { setLogLevel, logInfo, logError } from "./logger.js";

// ============================================================================
// 命令行参数解析
// ============================================================================

function parseArgs(): { configPath: string } {
  const args = process.argv.slice(2);
  let configPath = "timbot-gateway.yaml"; // 默认

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) {
      configPath = args[i + 1];
      i++;
    }
  }

  return { configPath: resolve(configPath) };
}

// ============================================================================
// 主入口
// ============================================================================

async function main(): Promise<void> {
  console.log(`
  ╔════════════════════════════════════╗
  ║       timbot-gateway  v1.0.0      ║
  ║  Tencent IM Webhook Gateway Proxy ║
  ╚════════════════════════════════════╝
  `);

  // 1. 解析命令行参数
  const { configPath } = parseArgs();

  // 2. 加载配置
  let config;
  try {
    config = loadConfig(configPath);
  } catch (err: any) {
    console.error(`[FATAL] ${err.message}`);
    process.exit(1);
  }

  // 3. 设置日志级别
  setLogLevel(config.logging.level);

  // 4. 初始化路由
  initRouter(config);
  logInfo(`Loaded ${config.routes.length} route(s)`);
  logInfo(
    `Managed IM sdkAppId: ${config.imApp.sdkAppId}, AppAdmin: ${config.imApp.appAdmin}, BotManager: ${config.imApp.botManager}`
  );

  // 5. 创建 HTTP 服务器
  const server = createGatewayServer(config);

  // 6. 启动健康检查
  startHealthCheck(config.healthCheck, getRoutes);

  // 7. 启动 HTTP 服务器
  const { port, host } = config.server;
  server.listen(port, host, () => {
    logInfo(`Gateway server listening on http://${host}:${port}`);
    logInfo(`Webhook endpoint: POST http://${host}:${port}/timbot?SdkAppid=xxx`);
    logInfo(`Status endpoint:  GET  http://${host}:${port}/gateway/status`);
  });

  // 8. 优雅退出
  const shutdown = (signal: string) => {
    logInfo(`Received ${signal}, shutting down...`);
    stopHealthCheck();
    server.close(() => {
      logInfo("Server closed");
      process.exit(0);
    });
    // 如果 5 秒内没有关闭，强制退出
    setTimeout(() => {
      logError("Forced shutdown after timeout");
      process.exit(1);
    }, 5000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(`[FATAL] Unexpected error: ${err.message}`);
  process.exit(1);
});
