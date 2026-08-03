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
const DEFAULT_VIEWPORT = {
  width: 1365,
  height: 900
};
const DEFAULT_LANGUAGES = ["pt-BR", "pt", "en-US", "en"];

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

function getLaunchCandidates(headless) {
  const baseLaunchOptions = {
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--lang=pt-BR",
      `--window-size=${DEFAULT_VIEWPORT.width},${DEFAULT_VIEWPORT.height}`
    ]
  };

  const candidates = [
    {
      name: "chrome",
      options: {
        ...baseLaunchOptions,
        channel: "chrome"
      }
    }
  ];

  if (headless) {
    candidates.push({
      name: "chromium",
      options: {
        ...baseLaunchOptions,
        // Usa o "new headless" do Chromium antes de cair no shell legado.
        channel: "chromium"
      }
    });
  }

  candidates.push({
    name: "playwright-default",
    options: baseLaunchOptions
  });

  return candidates;
}

function buildUserAgent(browser) {
  const rawVersion = typeof browser.version === "function" ? browser.version() : "";
  const normalizedVersion = /^\d+(\.\d+){0,3}$/.test(rawVersion) ? rawVersion : "138.0.0.0";

  return [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "AppleWebKit/537.36 (KHTML, like Gecko)",
    `Chrome/${normalizedVersion} Safari/537.36`
  ].join(" ");
}

async function launchBrowser(headless) {
  const failures = [];

  for (const candidate of getLaunchCandidates(headless)) {
    try {
      const browser = await chromium.launch(candidate.options);
      const launchInfo = {
        channel: candidate.name,
        headless
      };

      console.log(
        `[playwright] Navegador iniciado com canal=${launchInfo.channel} headless=${launchInfo.headless}`
      );

      return {
        browser,
        launchInfo
      };
    } catch (error) {
      const message = error?.message || "erro desconhecido";
      failures.push(`${candidate.name}: ${message}`);
      console.warn(
        `[playwright] Falha ao iniciar com canal=${candidate.name} headless=${headless}: ${message}`
      );
    }
  }

  throw new Error(
    `Falha ao iniciar o navegador para a automacao. Tentativas: ${failures.join(" | ")}`
  );
}

async function createBrowserContext(browser) {
  const context = await browser.newContext({
    acceptDownloads: true,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    viewport: DEFAULT_VIEWPORT,
    screen: DEFAULT_VIEWPORT,
    userAgent: buildUserAgent(browser),
    extraHTTPHeaders: {
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  });

  await context.addInitScript((languages) => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined
    });

    Object.defineProperty(navigator, "languages", {
      get: () => languages
    });

    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5]
    });

    window.chrome = window.chrome || {
      runtime: {}
    };
  }, DEFAULT_LANGUAGES);

  return context;
}

async function createLookupSession(browser) {
  const context = await createBrowserContext(browser);
  const page = await context.newPage();

  page.setDefaultTimeout(LOOKUP_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(LOOKUP_TIMEOUT_MS);

  return {
    context,
    page
  };
}

async function openLookupPage(page) {
  await page.goto(selectors.siteUrl, {
    waitUntil: "domcontentloaded",
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
  const { browser, launchInfo } = await launchBrowser(headless);
  const results = [];

  console.log(
    `[playwright] Processando ${keys.length} chave(s) com canal=${launchInfo.channel} headless=${launchInfo.headless}`
  );

  try {
    for (const [index, key] of keys.entries()) {
      let result = null;
      let session = null;

      try {
        session = await createLookupSession(browser);
        result = await downloadForKey(session.page, key, downloadsDir);
      } catch (error) {
        result = {
          key,
          status: "error",
          message: error.message || "Falha ao baixar o arquivo."
        };
      } finally {
        if (session) {
          await session.context.close();
        }
      }

      results.push(result);

      if (typeof onResult === "function") {
        await onResult(result, {
          index,
          total: keys.length
        });
      }

      if (index < keys.length - 1) {
        await delay(BETWEEN_KEYS_DELAY_MS);
      }
    }

    return results;
  } finally {
    await browser.close();
  }
}

module.exports = {
  processAccessKeys
};
