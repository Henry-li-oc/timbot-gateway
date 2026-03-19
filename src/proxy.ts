/**
 * 请求转发模块
 *
 * 使用全局 fetch 将请求转发到后端节点：
 * - 完整保留 query string + 关键 headers
 * - 设置 30 秒超时
 * - 将后端响应状态码和 body 原样回传
 */

import type { IncomingHttpHeaders } from "node:http";
import type { ProxyResult } from "./types.js";
import { logDebug, logInfo, logError } from "./logger.js";

/** 转发超时（毫秒） */
const PROXY_TIMEOUT_MS = 30_000;

/** 请求体大小上限（1MB，与 timbot 一致） */
export const MAX_BODY_SIZE = 1024 * 1024;

/**
 * 读取请求体到 Buffer
 * 超过 MAX_BODY_SIZE 时抛出错误
 */
export function readRequestBody(req: { on: Function; removeListener?: Function }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;

    const onData = (chunk: Buffer) => {
      totalLength += chunk.length;
      if (totalLength > MAX_BODY_SIZE) {
        reject(new Error(`Request body exceeds ${MAX_BODY_SIZE} bytes`));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      resolve(Buffer.concat(chunks));
    };

    const onError = (err: Error) => {
      reject(err);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

/**
 * 将请求转发到后端节点
 *
 * @param targetUrl 完整的转发目标 URL
 * @param body 请求体 Buffer
 * @param originalHeaders 原始请求头
 * @returns 后端响应
 */
export async function forwardRequest(
  targetUrl: string,
  body: Buffer,
  originalHeaders: IncomingHttpHeaders
): Promise<ProxyResult> {
  logDebug(`Forwarding request to: ${targetUrl}`);

  // 构建转发请求头（保留关键头，移除 hop-by-hop 头）
  const forwardHeaders: Record<string, string> = {
    "content-type": originalHeaders["content-type"] || "application/json",
    "content-length": String(body.length),
  };

  // 保留客户端 IP 信息
  if (originalHeaders["x-forwarded-for"]) {
    forwardHeaders["x-forwarded-for"] = String(originalHeaders["x-forwarded-for"]);
  }
  if (originalHeaders["x-real-ip"]) {
    forwardHeaders["x-real-ip"] = String(originalHeaders["x-real-ip"]);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: forwardHeaders,
      body: body.toString("utf-8"),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseBody = Buffer.from(await response.arrayBuffer());
    const responseHeaders: Record<string, string | string[] | undefined> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    logInfo(`Backend responded: ${response.status} (${responseBody.length} bytes)`);

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: responseBody,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      logError(`Forward timeout after ${PROXY_TIMEOUT_MS}ms: ${targetUrl}`);
      return {
        statusCode: 504,
        headers: {},
        body: Buffer.from(JSON.stringify({ error: "Gateway Timeout" })),
      };
    }

    logError(`Forward error to ${targetUrl}: ${err.message}`);
    return {
      statusCode: 502,
      headers: {},
      body: Buffer.from(JSON.stringify({ error: "Bad Gateway", detail: err.message })),
    };
  }
}
