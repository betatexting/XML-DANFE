const path = require("path");
const fs = require("fs/promises");
process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(__dirname, "..", ".playwright-browsers");
const { chromium } = require("playwright");
const selectors = require("./selectors");

const LOOKUP_TIMEOUT_MS = 45000;
const AFTER_PAGE_READY_DELAY_MS = 1500;
const AFTER_TYPING_DELAY_MS = 1000;
const TYPING_DELAY_MS = 45;
const MAX_ATTEMPTS_PER_KEY = 3;
const RETRY_DELAY_MS = 4000;
const BETWEEN_KEYS_DELAY_MS = 2500;

function ensureSelector(name, value) {
  if (!value || typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Selector ausente em src/selectors.js: preencha "${name}" antes de rodar a automacao.`
    );
  }
}

class LookupError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = "LookupError";
    this.retryable = retryable;
  }
}

async function launchBrowser(headless) {
  const launchOptions = {
    headless
  };

  try {
    return await chromium.launch({
      ...launchOptions,
      channel: "chrome"
    });
  } catch (_error) {
    return chromium.launch(launchOptions);
  }
}

async function createBrowserContext(browser) {
  const context = await browser.newContext({
    acceptDownloads: true,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    viewport: {
      width: 1365,
      height: 900
    },
    extraHTTPHeaders: {
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  });

  return context;
}

async function openLookupPage(page) {
  await page.goto(selectors.siteUrl, {
    waitUntil: "networkidle",
    timeout: LOOKUP_TIMEOUT_MS
  });
  await page.locator(selectors.accessKeyInput).waitFor({
    state: "visible",
    timeout: LOOKUP_TIMEOUT_MS
  });
  await page.waitForTimeout(AFTER_PAGE_READY_DELAY_MS);
}

async function typeAccessKey(page, key) {
  const input = page.locator(selectors.accessKeyInput);

  await input.click();
  await input.press("ControlOrMeta+A");
  await input.press("Delete");
  await input.pressSequentially(key, { delay: TYPING_DELAY_MS });
  await page.waitForTimeout(AFTER_TYPING_DELAY_MS);
}

async function requestXmlForKey(page) {
  const lookupResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/chave") && response.request().method().toUpperCase() === "POST",
    {
      timeout: LOOKUP_TIMEOUT_MS
    }
  );

  await page.getByRole("button", { name: /imprimir danfe/i }).click();
  const lookupResponse = await lookupResponsePromise;

  let payload = null;
  try {
    payload = await lookupResponse.json();
  } catch (_error) {
    payload = null;
  }

  const xml = typeof payload?.codigo_xml === "string" ? payload.codigo_xml.trim() : "";
  if (lookupResponse.ok() && payload?.status === "sucesso" && xml) {
    return xml;
  }

  const message =
    typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : `O site retornou ${lookupResponse.status()} ao consultar a chave.`;

  throw new LookupError(message, {
    // O consultadanfe esta respondendo 404 intermitente para chaves validas.
    retryable: lookupResponse.status() === 404 || lookupResponse.status() >= 500
  });
}

async function saveXmlForKey(xml, key, downloadsDir) {
  const targetFile = path.join(downloadsDir, `${key}.xml`);
  await fs.writeFile(targetFile, `${xml}\n`, "utf8");

  return {
    key,
    status: "success",
    fileName: path.basename(targetFile),
    filePath: targetFile
  };
}

async function downloadForKey(page, key, downloadsDir) {
  ensureSelector("accessKeyInput", selectors.accessKeyInput);

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_KEY; attempt += 1) {
    try {
      await openLookupPage(page);
      await typeAccessKey(page, key);
      const xml = await requestXmlForKey(page);
      return await saveXmlForKey(xml, key, downloadsDir);
    } catch (error) {
      lastError = error;

      if (!(error instanceof LookupError) || !error.retryable || attempt === MAX_ATTEMPTS_PER_KEY) {
        break;
      }

      await page.waitForTimeout(RETRY_DELAY_MS * attempt);
    }
  }

  if (lastError instanceof LookupError) {
    throw new Error(
      `Falha apos ${MAX_ATTEMPTS_PER_KEY} tentativas. ${lastError.message}`
    );
  }

  throw lastError;
}

async function processAccessKeys({ keys, headless, downloadsDir, onResult }) {
  const browser = await launchBrowser(headless);
  const context = await createBrowserContext(browser);
  const page = await context.newPage();
  const results = [];

  try {
    for (const [index, key] of keys.entries()) {
      let result = null;

      try {
        result = await downloadForKey(page, key, downloadsDir);
      } catch (error) {
        result = {
          key,
          status: "error",
          message: error.message || "Falha ao baixar o arquivo."
        };
      }

      results.push(result);

      if (typeof onResult === "function") {
        await onResult(result, {
          index,
          total: keys.length
        });
      }

      if (index < keys.length - 1) {
        await page.waitForTimeout(BETWEEN_KEYS_DELAY_MS);
      }
    }

    return results;
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = {
  processAccessKeys
};
