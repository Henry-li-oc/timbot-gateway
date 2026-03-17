import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const {
  fnv1aHash,
  buildTargetUrl,
  initRouter,
  findRoute,
  findRouteByTimbotUserId,
  normalizeAccountId,
  isManagedSdkAppId,
  getRoutes,
  addRoute,
  removeRoute,
  enableRoute,
  disableRoute,
} = await import("../dist/src/router.js");

describe("FNV-1a Hash", () => {
  it("should return consistent hash for same input", () => {
    const hash1 = fnv1aHash("test-input");
    const hash2 = fnv1aHash("test-input");
    assert.equal(hash1, hash2);
  });

  it("should return different hashes for different inputs", () => {
    const hash1 = fnv1aHash("user-001");
    const hash2 = fnv1aHash("user-002");
    assert.notEqual(hash1, hash2);
  });

  it("should return positive integer", () => {
    const hash = fnv1aHash("anything");
    assert.ok(hash >= 0);
    assert.ok(Number.isInteger(hash));
  });

  it("should distribute evenly across buckets", () => {
    const buckets = [0, 0, 0];
    for (let i = 0; i < 1000; i++) {
      const hash = fnv1aHash(`1600130023:user_${i}`);
      buckets[hash % 3]++;
    }
    for (const count of buckets) {
      assert.ok(count > 200, `Bucket count ${count} is too low for even distribution`);
    }
  });
});

describe("buildTargetUrl", () => {
  it("should build correct URL with query string", () => {
    const route = { backend: "http://10.0.1.10:3000", webhookPath: "/timbot" };
    const url = buildTargetUrl(route, "SdkAppid=1600130023&Sign=abc");
    assert.equal(url, "http://10.0.1.10:3000/timbot?SdkAppid=1600130023&Sign=abc");
  });

  it("should handle trailing slash in backend", () => {
    const route = { backend: "http://10.0.1.10:3000/", webhookPath: "/timbot" };
    const url = buildTargetUrl(route, "SdkAppid=1600130023");
    assert.equal(url, "http://10.0.1.10:3000/timbot?SdkAppid=1600130023");
  });

  it("should handle empty query string", () => {
    const route = { backend: "http://10.0.1.10:3000", webhookPath: "/timbot" };
    const url = buildTargetUrl(route, "");
    assert.equal(url, "http://10.0.1.10:3000/timbot");
  });

  it("should handle webhookPath without leading slash", () => {
    const route = { backend: "http://10.0.1.10:3000", webhookPath: "timbot" };
    const url = buildTargetUrl(route, "test=1");
    assert.equal(url, "http://10.0.1.10:3000/timbot?test=1");
  });
});

describe("Router operations", () => {
  beforeEach(() => {
    initRouter({
      server: { port: 8080, host: "0.0.0.0" },
      imApp: {
        sdkAppId: "1600130023",
        callbackToken: "my_token",
        secretKey: "test-key",
        appAdmin: "administrator",
        botManager: "timbot_king",
      },
      routes: [
        {
          timbotUserId: "bot-alpha",
          backend: "http://10.0.1.10:3000",
          webhookPath: "/timbot",
          enabled: true,
          description: "Bot A",
        },
        {
          timbotUserId: "@bot-beta",
          backend: "http://10.0.1.11:3000",
          webhookPath: "/timbot",
          enabled: false,
          description: "Bot B (disabled)",
        },
      ],
      healthCheck: { enabled: false, intervalMs: 30000, timeoutMs: 5000 },
      logging: { level: "error" },
    });
  });

  it("should normalize account ids by stripping leading at sign", () => {
    assert.equal(normalizeAccountId("@bot-alpha"), "bot-alpha");
    assert.equal(normalizeAccountId("＠bot-alpha"), "bot-alpha");
    assert.equal(normalizeAccountId("bot-alpha"), "bot-alpha");
  });

  it("should identify managed sdkAppId", () => {
    assert.ok(isManagedSdkAppId("1600130023"));
    assert.ok(!isManagedSdkAppId("1600130999"));
    assert.ok(!isManagedSdkAppId("unknown"));
  });

  it("should find existing route by timbot userId", () => {
    const route = findRouteByTimbotUserId("bot-alpha");
    assert.ok(route);
    assert.equal(route.backend, "http://10.0.1.10:3000");
    assert.equal(route.enabled, true);
  });

  it("should find existing route by normalized timbot userId", () => {
    const route = findRouteByTimbotUserId("@bot-beta");
    assert.ok(route);
    assert.equal(route.timbotUserId, "bot-beta");
  });

  it("should find route by generic identifier", () => {
    assert.equal(findRoute("bot-alpha")?.timbotUserId, "bot-alpha");
    assert.equal(findRoute("@bot-beta")?.timbotUserId, "bot-beta");
  });

  it("should return undefined for unknown route", () => {
    assert.equal(findRoute("unknown-bot"), undefined);
    assert.equal(findRouteByTimbotUserId("ghost-bot"), undefined);
  });

  it("should list all routes", () => {
    const routes = getRoutes();
    assert.equal(routes.length, 2);
  });

  it("should add new route", () => {
    const result = addRoute({
      timbotUserId: "bot-gamma",
      backend: "http://10.0.1.12:3000",
      webhookPath: "/timbot",
      enabled: true,
    });
    assert.ok(result);
    assert.equal(getRoutes().length, 3);
    assert.ok(findRouteByTimbotUserId("bot-gamma"));
  });

  it("should not add duplicate route by timbot userId", () => {
    const result = addRoute({
      timbotUserId: "bot-alpha",
      backend: "http://other:3000",
      webhookPath: "/timbot",
      enabled: true,
    });
    assert.ok(!result);
    assert.equal(getRoutes().length, 2);
  });

  it("should remove route by timbot userId", () => {
    const result = removeRoute("@bot-beta");
    assert.ok(result);
    assert.equal(getRoutes().length, 1);
    assert.equal(findRoute("bot-beta"), undefined);
  });

  it("should not remove non-existent route", () => {
    const result = removeRoute("ghost-bot");
    assert.ok(!result);
    assert.equal(getRoutes().length, 2);
  });

  it("should enable disabled route by timbot userId", () => {
    assert.equal(findRoute("bot-beta").enabled, false);
    const result = enableRoute("bot-beta");
    assert.ok(result);
    assert.equal(findRoute("bot-beta").enabled, true);
  });

  it("should disable enabled route by timbot userId", () => {
    assert.equal(findRoute("bot-alpha").enabled, true);
    const result = disableRoute("bot-alpha");
    assert.ok(result);
    assert.equal(findRoute("bot-alpha").enabled, false);
  });

  it("should return false when enabling non-existent route", () => {
    assert.ok(!enableRoute("ghost-bot"));
  });

  it("should return false when disabling non-existent route", () => {
    assert.ok(!disableRoute("ghost-bot"));
  });
});
