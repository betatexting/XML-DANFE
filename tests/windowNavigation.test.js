const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const express = require("express");
const { chromium } = require("playwright-core");
const { installAuth } = require("../src/authRoutes");
const { resizeBounds } = require("../src/windowResize");

test("resize edges preserve the opposite edge, minimum dimensions and display limits", () => {
  const start = { bounds: { x: 100, y: 100, width: 745, height: 460 }, cursor: { x: 500, y: 300 } };
  const work = { x: 0, y: 0, width: 1920, height: 1080 };
  for (const edge of ["n", "s", "w", "e", "nw", "ne", "sw", "se"]) {
    const result = resizeBounds(start, { x: 570, y: 350 }, edge, [360, 400], work);
    assert.ok(result.width >= 360 && result.height >= 400);
    if (!edge.includes("w")) assert.equal(result.x, 100);
    if (!edge.includes("n")) assert.equal(result.y, 100);
    if (edge.includes("w")) assert.equal(result.x + result.width, 845);
    if (edge.includes("n")) assert.equal(result.y + result.height, 560);
  }
  const huge = resizeBounds(start, { x: 9000, y: 9000 }, "se", [360, 400], work);
  assert.equal(huge.x + huge.width, 1920);
  assert.equal(huge.y + huge.height, 1080);
  const tiny = resizeBounds(start, { x: -9000, y: -9000 }, "se", [360, 400], work);
  assert.equal(tiny.width, 360);
  assert.equal(tiny.height, 400);
  assert.throws(() => resizeBounds(start, start.cursor, "bad", [360, 400], work), /invalida/);
});

test("all screens adapt to window sizes and back arrows follow the screen hierarchy", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "responsive-screens-"));
  const app = express();
  app.use(express.json());
  const cookie = await require("./helpers/auth").authenticateTestApp(app, directory);
  installAuth(app);
  const { createCompanyCatalog, installCompanyRoutes } = require("../src/companyCatalog");
  app.locals.companyCatalog = createCompanyCatalog({ filePath: path.join(directory, "companies.json") });
  installCompanyRoutes(app);
  app.use(express.static(path.resolve("public")));
  app.get("/api/config", (_req, res) => res.json({ downloadsDir: directory }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const browser = await chromium.launch({ executablePath: path.resolve(".playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe"), headless: true });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const context = await browser.newContext();
  const base = `http://127.0.0.1:${server.address().port}`;
  await context.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=")[1], url: base }]);
  await context.addInitScript(() => {
    window.resizeCalls = [];
    window.consultaDanfeDesktop = {
      isDesktop: true, restoreLogin: async () => ({ available: true }),
      getWindowState: async () => ({ isMaximized: false }), onWindowStateChange: () => () => {},
      minimizeWindow() {}, closeWindow() {},
      startWindowResize: async (edge) => { window.resizeCalls.push(edge); return true; },
      resizeWindow: async () => { window.resizeCalls.push("move"); }, endWindowResize: async () => { window.resizeCalls.push("end"); }
    };
  });
  const page = await context.newPage();
  const artifacts = path.resolve("tmp-window-navigation");
  await fs.mkdir(artifacts, { recursive: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const cases = [
    ["/login", [[360, 400], [745, 460], [1600, 1000]], "#loginForm"],
    ["/menu", [[360, 400], [603, 580], [1280, 800]], ".menu-options"],
    ["/notas-automaticas", [[480, 400], [1052, 589], [1600, 1000]], "#automaticNotesContent"],
    ["/consultas", [[760, 640], [1440, 960]], "#process-form"]
  ];
  for (const [route, sizes, content] of cases) {
    await page.goto(base + route);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await page.screenshot({ path: path.join(artifacts, `${route.slice(1)}-${width}x${height}.png`), omitBackground: route !== "/consultas" });
      const overflowing = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((node) => {
        const box = node.getBoundingClientRect(); return box.width && box.right > innerWidth + 1;
      }).slice(0, 12).map((node) => ({ tag: node.tagName, id: node.id, className: node.className, right: node.getBoundingClientRect().right })));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} at ${width}x${height}: ${JSON.stringify(overflowing)}`);
      if (route !== "/consultas") {
        const bounds = await page.locator(content).boundingBox();
        const panel = await page.locator(".login-panel").boundingBox();
        assert.ok(bounds.x >= panel.x && bounds.x + bounds.width <= panel.x + panel.width + 1, route);
        assert.ok(bounds.y + bounds.height <= panel.y + panel.height + 1, `${route} vertical bounds`);
        assert.equal(await page.locator(".window-resize-handle").count(), 8);
      }
    }
    if (route === "/login") assert.equal(await page.getByRole("button", { name: "Voltar", exact: true }).count(), 0);
    else {
      await page.getByRole("button", { name: "Voltar", exact: true }).click();
      await page.waitForURL(base + (route === "/menu" ? "/login" : "/menu"));
    }
  }
  await page.goto(base + "/menu");
  await page.setViewportSize({ width: 603, height: 580 });
  const corner = await page.locator('[data-edge="se"]').boundingBox();
  await page.mouse.move(corner.x + 8, corner.y + 8);
  await page.mouse.down();
  await page.waitForFunction(() => window.resizeCalls.includes("se"));
  await page.mouse.move(corner.x + 25, corner.y + 25);
  await page.waitForFunction(() => window.resizeCalls.includes("move"));
  await page.mouse.up();
  await page.waitForFunction(() => window.resizeCalls.includes("end"));
  assert.deepEqual(errors, []);
});
