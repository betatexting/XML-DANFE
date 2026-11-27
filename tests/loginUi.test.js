const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const express = require("express");
const { chromium } = require("playwright-core");
const { createLocalAuth } = require("../src/localAuth");
const { installAuth } = require("../src/authRoutes");
const browserPath = path.resolve(".playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe");

test("login screen follows the reference and validates setup, saved credentials and failed access", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "login-ui-"));
  const app = express();
  app.locals.auth = createLocalAuth({ filePath: path.join(directory, "user.json") });
  app.use(express.json());
  installAuth(app);
  const { createCompanyCatalog, installCompanyRoutes } = require("../src/companyCatalog");
  app.locals.companyCatalog = createCompanyCatalog({ filePath: path.join(directory, "companies.json") });
  installCompanyRoutes(app);
  app.use(express.static(path.resolve("public")));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const context = await browser.newContext({ viewport: { width: 745, height: 460 } });
  let savedFixture = null;
  await context.exposeBinding("saveFixture", (_source, credentials) => { savedFixture = credentials; });
  await context.exposeBinding("restoreFixture", () => savedFixture);
  await context.exposeBinding("forgetFixture", () => { savedFixture = null; });
  await context.addInitScript(() => {
    window.savedFixture = null;
    window.consultaDanfeDesktop = {
      isDesktop: true,
      restoreLogin: async () => ({ available: true, credentials: await window.restoreFixture() }),
      saveLogin: async (credentials) => { await window.saveFixture(credentials); },
      forgetLogin: async () => { await window.forgetFixture(); },
      minimizeWindow() {}, closeWindow() {},
      getWindowState: async () => ({ isMaximized: false }),
      onWindowStateChange: () => () => {}
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  const artifacts = path.resolve("tmp-login-validation");
  await fs.mkdir(artifacts, { recursive: true });
  await page.goto(base);
  await page.waitForFunction(() => typeof ready !== "undefined" && ready);
  assert.equal(await page.locator("#loginSubmit").isDisabled(), true);
  await page.fill("#loginUsername", "contas");
  await page.fill("#loginPassword", "fixture-password");
  await page.locator("#rememberLogin").check({ force: true });
  await page.click("#loginSubmit");
  await page.waitForSelector("#setupDialog[open]");
  await page.fill("#setupPassword", "different-password");
  await page.click("#setupForm button[type=submit]");
  assert.match(await page.textContent("#setupMessage"), /nao coincidem/);
  await page.fill("#setupPassword", "fixture-password");
  await page.click("#setupForm button[type=submit]");
  await page.waitForURL("**/menu");
  assert.deepEqual(savedFixture, { username: "contas", password: "fixture-password" });
  assert.equal(await app.locals.auth.isConfigured(), true);
  assert.equal(await page.locator("#process-form").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Notas Automáticas" }).isDisabled(), false);
  assert.equal(await page.getByRole("button", { name: "Planilhas de Chaves" }).isDisabled(), false);
  await page.setViewportSize({ width: 603, height: 580 });
  await page.screenshot({ path: path.join(artifacts, "menu-603x580.png"), omitBackground: true });
  const menuBounds = await page.locator("#manualNotesButton").boundingBox();
  assert.ok(Math.abs(menuBounds.x - 189) < 2);
  assert.ok(Math.abs(menuBounds.y - 191) < 2);
  await page.getByRole("button", { name: "Notas Automáticas" }).click();
  await page.waitForURL("**/notas-automaticas");
  await page.setViewportSize({ width: 1052, height: 589 });
  await page.screenshot({ path: path.join(artifacts, "automatic-notes-1052x589.png"), omitBackground: true });
  const automaticPanel = await page.locator(".automatic-notes-panel").boundingBox();
  assert.equal(automaticPanel.x, 20);
  assert.equal(automaticPanel.y, 48);
  assert.equal(automaticPanel.width, 992);
  assert.equal(automaticPanel.height, 509);
  assert.equal(await page.locator(".automatic-notes-tool img").count(), 3);
  await page.goto(base + "/menu");
  await page.setViewportSize({ width: 603, height: 580 });
  await page.getByRole("button", { name: "Notas Manuais" }).click();
  await page.waitForURL("**/consultas");
  assert.equal(await page.locator("#process-form").count(), 1);
  assert.equal(await page.locator("#logoutButton").count(), 0);
  await page.setViewportSize({ width: 745, height: 460 });
  await page.goto(base + "/login");
  await page.waitForFunction(() => ready);
  assert.equal(await page.inputValue("#loginUsername"), "contas");
  assert.equal(await page.inputValue("#loginPassword"), "fixture-password");
  assert.equal(await page.locator("#rememberLogin").isChecked(), true);
  assert.match(page.url(), /\/login$/, "saved access fills the inputs without automatic sign-in");
  await page.fill("#loginUsername", "contas");
  await page.fill("#loginPassword", "incorrect-password");
  await page.click("#loginSubmit");
  await page.waitForFunction(() => document.querySelector("#loginMessage").textContent.includes("incorretos"));
  assert.match(page.url(), /\/login$/);
  await page.fill("#loginUsername", "");
  await page.fill("#loginPassword", "");
  await page.locator("#rememberLogin").uncheck({ force: true });
  await page.evaluate(() => { document.querySelector("#loginMessage").textContent = ""; });
  await page.screenshot({ path: path.join(artifacts, "login-745x460.png"), omitBackground: true });
  await page.locator("#rememberLogin").check({ force: true });
  await page.screenshot({ path: path.join(artifacts, "login-checked-745x460.png"), omitBackground: true });
  const bounds = await page.locator("#loginPassword").boundingBox();
  assert.ok(Math.abs(bounds.x - 210) < 3);
  assert.ok(Math.abs(bounds.y - 252) < 3);
  assert.ok(Math.abs(bounds.width - 353) < 3);
  assert.equal(await page.locator("#loginPassword").getAttribute("type"), "password");
  await page.setViewportSize({ width: 390, height: 700 });
  await page.screenshot({ path: path.join(artifacts, "login-390x700.png"), omitBackground: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});
