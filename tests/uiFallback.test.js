const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const { chromium } = require("playwright-core");
const { isFallbackEligibleResult } = require("../src/lookupResult");

const keyA = "35260444823938000187551090000002691092067649";
const keyB = "29260621444661000186550030000065351001699396";
const browserPath = process.env.DIAGNOSTIC_TEST_BROWSER || path.resolve(".playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe");

test("site fallback eligibility includes generic failures and excludes invalid keys and site retries", () => {
  assert.equal(isFallbackEligibleResult({ key: keyA, status: "error", lookupMode: "http-direct", errorCode: "pendente", fallbackEligible: false }), true);
  assert.equal(isFallbackEligibleResult({ key: keyA, status: "success" }), false);
  assert.equal(isFallbackEligibleResult({ key: "invalid", status: "error" }), false);
  assert.equal(isFallbackEligibleResult({ key: keyA, status: "error", lookupMode: "site-fallback" }), false);
  assert.equal(isFallbackEligibleResult({ key: keyA, status: "error", lookupMode: "nfe-distribution-certificate", errorCode: "xml_organization_failed" }), false);
});

test("manual, PDF and spreadsheet flows offer site fallback and generate copyable key lists", { skip: !fs.existsSync(browserPath) }, async (t) => {
  const app = express();
  app.use(express.static(path.resolve("public")));
  app.get("/api/config", (_req, res) => res.json({ downloadsDir: "pasta-de-teste" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const certified of [false, true]) {
    for (const source of ["manual", "pdf", "spreadsheet"]) {
      const page = await browser.newPage();
      const errors = [];
      const called = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/**", async (route) => {
        const endpoint = new URL(route.request().url()).pathname;
        if (!endpoint.startsWith("/api/process") && endpoint !== "/api/certificate/discard") return route.continue();
        called.push(endpoint);
        if (endpoint === "/api/certificate/discard") return route.fulfill({ contentType: "application/json", body: "{}" });
        const site = endpoint === "/api/process-fallback";
        const mode = endpoint === "/api/process-distnsu" ? "nfe-distribution-nsu" : certified && endpoint !== "/api/process-items" ? "nfe-distribution-certificate" : "http-direct";
        const results = [
          { key: keyA, status: site ? "success" : "error", lookupMode: site ? "site-fallback" : mode, errorCode: site ? "" : "pendente", fallbackEligible: false, fileName: `${keyA}.xml` },
          { key: keyB, status: "error", lookupMode: site ? "site-fallback" : mode, message: "Erro simulado sem rejeicao de prazo", fallbackEligible: false }
        ];
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ results }) });
      });
      await page.goto(url);
      if (certified) await page.evaluate(() => {
        certificateMode.checked = true;
        certificateState = { certificateId: "fixture", formattedCnpj: "44.823.938/0001-87", passphrase: "fixture", authorUfCode: "35" };
      });
      if (source === "manual") {
        await page.fill("#rawKeys", `${keyA}\n${keyB}`);
        await page.click("#submitButton");
      } else {
        const pdf = source === "pdf";
        await page.setInputFiles(pdf ? "#pdfFiles" : "#spreadsheetFiles", {
          name: pdf ? "nota.pdf" : "notas.csv", mimeType: pdf ? "application/pdf" : "text/csv", buffer: Buffer.from("fixture")
        });
        await page.evaluate((selector) => document.querySelector(selector).click(), pdf ? "#pdfSubmitButton" : "#spreadsheetSubmitButton");
      }
      if (!certified) {
        await page.waitForSelector("#organizationDialog[open]");
        await page.selectOption("#organizationType", "saidas");
        await page.click("#organizationForm button[type=submit]");
        await page.waitForSelector("#fallbackDialog[open]");
        assert.match(await page.textContent("#fallbackDialogCopy"), /terminaram com falha/);
        await page.click('#fallbackDialog button[value="confirm"]');
      }
      await page.waitForFunction(() => !document.querySelector("#submitButton").disabled);
      assert.equal(called.filter((endpoint) => endpoint === "/api/process-fallback").length, 1, `${source}, certificado=${certified}`);
      if (certified) {
        assert.ok(called.includes("/api/process-distnsu"));
        assert.ok(called.includes("/api/process-items"));
        assert.equal(await page.locator("#fallbackDialog[open]").count(), 0);
      }
      const expected = `Sucessos:\n\n${keyA}\n\nFalhas:\n\n${keyB}\n`;
      assert.equal(await page.textContent("#reportOutput"), expected);
      assert.equal(await page.evaluate(() => currentReportText), expected);
      assert.equal(await page.evaluate(({ keyA, keyB }) => buildFinalReport({
        label: "Teste", startedAt: 0, finishedAt: 1,
        results: [{ key: keyA, status: "success" }, { key: keyA, status: "success" }, { key: keyB, status: "error", message: "nao imprimir" }, { key: "invalid", status: "error" }]
      }).text, { keyA, keyB }), expected);
      assert.deepEqual(errors, []);
      const history = await page.evaluate(() => {
        const first = { key: "test", status: "error", errorCode: "initial", httpStatus: 400,
          lookupMode: "http-direct", attempts: [{ status: "error", durationMs: 5, startedAt: "2026-11-16T12:00:00Z" }] };
        const second = mergeSingleFallbackResult(first, { key: "test", status: "error", errorCode: "second", lookupMode: "nfe-distribution-nsu" });
        return mergeSingleFallbackResult(second, { key: "test", status: "success", lookupMode: "site-fallback", attempts: [{ status: "success", durationMs: 10 }] });
      });
      assert.equal(history.status, "success");
      assert.equal(history.initialError.errorCode, "initial");
      assert.equal(history.initialError.attempts[0].durationMs, 5);
      assert.equal(history.fallbackHistory.length, 2);
      assert.equal(history.fallbackHistory[1].errorCode, "second");
      await page.close();
    }
  }
});
