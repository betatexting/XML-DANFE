const fs = require("fs");
const path = require("path");
const { classifyXml, saveOrganizedXml } = require("./xmlStorage");
const { chromium } = require("playwright-core");
const { getIssueDateFromXml } = require("./accessKeys");
const selectors = require("./selectors");
const { attemptRecord } = require("./lookupTrace");
const { extractXmlFromApiPayload } = require("./consultaDanfe");
const {
  LOOKUP_MODE_SITE_FALLBACK,
  LookupError,
  createLookupErrorResult,
  createLookupSuccessResult
} = require("./lookupResult");

const LOOKUP_TIMEOUT_MS = Number.parseInt(process.env.CONSULTA_DANFE_TIMEOUT_MS, 10) || 18000;
const AFTER_PAGE_READY_DELAY_MS = 700;
const AFTER_TYPING_DELAY_MS = 250;
const TYPING_DELAY_MS = 30;
const MAX_ATTEMPTS_PER_KEY = Math.max(
  1,
  Number.parseInt(process.env.CONSULTA_DANFE_MAX_ATTEMPTS, 10) || 2
);
const RETRY_DELAY_MS = 1200;
const BETWEEN_KEYS_DELAY_MS = 350;
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
    throw new Error(`Selector ausente em src/selectors.js: preencha "${name}" antes do fallback.`);
  }
}

function getWindowsBrowserCandidates() {
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const localAppData =
    process.env.LOCALAPPDATA ||
    path.join(process.env.USERPROFILE || "C:\\Users\\Default", "AppData", "Local");

  return [
    {
      name: "msedge-exec-x64",
      executablePath: path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe")
    },
    {
      name: "msedge-exec-x86",
      executablePath: path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
    },
    {
      name: "chrome-exec-x64",
      executablePath: path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe")
    },
    {
      name: "chrome-exec-local",
      executablePath: path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
    }
  ].filter((candidate) => fs.existsSync(candidate.executablePath));
}

function getLaunchCandidates() {
  const baseOptions = {
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--lang=pt-BR",
      `--window-size=${DEFAULT_VIEWPORT.width},${DEFAULT_VIEWPORT.height}`
    ]
  };

  const candidates = [
    {
      name: "msedge",
      options: {
        ...baseOptions,
        channel: "msedge"
      }
    },
    {
      name: "chrome",
      options: {
        ...baseOptions,
        channel: "chrome"
      }
    }
  ];

  for (const candidate of getWindowsBrowserCandidates()) {
    candidates.push({
      name: candidate.name,
      options: {
        ...baseOptions,
        executablePath: candidate.executablePath
      }
    });
  }

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

async function launchBrowser() {
  const failures = [];

  for (const candidate of getLaunchCandidates()) {
    try {
      const browser = await chromium.launch(candidate.options);

      console.log(`[fallback-site] Navegador oculto iniciado com ${candidate.name}.`);

      return {
        browser,
        launchInfo: {
          channel: candidate.name
        }
      };
    } catch (error) {
      failures.push(`${candidate.name}: ${error?.message || "erro desconhecido"}`);
    }
  }

  throw new Error(
    [
      "Nao foi possivel iniciar o navegador oculto para o fallback do site.",
      "Verifique se o Microsoft Edge ou o Google Chrome esta instalado nesta maquina.",
      failures.length > 0 ? `Tentativas: ${failures.join(" | ")}` : ""
    ]
      .filter(Boolean)
      .join(" ")
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

async function openLookupPage(page) {
  ensureSelector("accessKeyInput", selectors.accessKeyInput);

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
  await input.pressSequentially(key, {
    delay: TYPING_DELAY_MS
  });
  await page.waitForTimeout(AFTER_TYPING_DELAY_MS);
}

async function clickSubmitButton(page) {
  try {
    await page.getByRole("button", { name: /imprimir danfe/i }).click();
    return;
  } catch (_error) {
    if (!selectors.submitButton) {
      throw new Error("Nao foi possivel localizar o botao de consulta do fallback.");
    }
  }

  await page.locator(selectors.submitButton).click();
}

function isLookupResponse(response) {
  const url = response.url();
  const method = response.request().method().toUpperCase();

  return method === "POST" && (/\/chave(?:[/?#]|$)/.test(url) || url.endsWith("/chave"));
}

async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function buildSiteErrorMessage(payload, response) {
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }

  return `O fallback do site retornou ${response.status()} ao consultar a chave.`;
}

async function requestXmlForKey(page) {
  const lookupResponsePromise = page.waitForResponse(isLookupResponse, {
    timeout: LOOKUP_TIMEOUT_MS
  });

  // Attach rejection handlers immediately, including when clicking fails first.
  const [, lookupResponse] = await Promise.all([
    clickSubmitButton(page),
    lookupResponsePromise
  ]);
  const payload = await readJsonSafely(lookupResponse);
  const xml = extractXmlFromApiPayload(payload);

  if (lookupResponse.ok() && xml) {
    return xml;
  }

  throw new LookupError(buildSiteErrorMessage(payload, lookupResponse), {
    retryable: lookupResponse.status() === 404 || lookupResponse.status() >= 500,
    httpStatus: lookupResponse.status(),
    lookupMode: LOOKUP_MODE_SITE_FALLBACK
  });
}

async function saveXmlForKey(xml, key, downloadsDir, attemptCount, organization) {
  const targetFile = await saveOrganizedXml(xml, key, downloadsDir, organization);

  return {
    ...createLookupSuccessResult({
      key,
      targetFile,
      lookupMode: LOOKUP_MODE_SITE_FALLBACK,
      attemptCount
    }),
    companyCnpj: classifyXml(xml, key, organization).cnpj,
    invoiceType: classifyXml(xml, key, organization).type,
    documentIssueDate: getIssueDateFromXml(xml)
  };
}

function decorateLookupAttempt(error, attemptCount) {
  if (error instanceof LookupError) {
    error.attemptCount = attemptCount;
    error.lookupMode = LOOKUP_MODE_SITE_FALLBACK;
    return error;
  }

  return new LookupError(
    error?.message || "Falha ao consultar a chave no fallback automatico do site.",
    {
      retryable: true,
      attemptCount,
      lookupMode: LOOKUP_MODE_SITE_FALLBACK
    }
  );
}

async function downloadForKey(page, key, downloadsDir, onProgress, organization) {
  let lastError = null;
  const attempts = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_KEY; attempt += 1) {
    const startedAt = Date.now();
    try {
      if (typeof onProgress === "function") {
        await onProgress({
          type: "attempt",
          key,
          attempt,
          maxAttempts: MAX_ATTEMPTS_PER_KEY,
          lookupMode: LOOKUP_MODE_SITE_FALLBACK
        });
      }

      await openLookupPage(page);
      await typeAccessKey(page, key);
      const xml = await requestXmlForKey(page);
      const result = await saveXmlForKey(xml, key, downloadsDir, attempt, organization);
      attempts.push(attemptRecord({ attempt, startedAt, lookupMode: LOOKUP_MODE_SITE_FALLBACK }));
      return { ...result, attempts, initialError: attempts.find((item) => item.status === "error") || null };
    } catch (error) {
      lastError = decorateLookupAttempt(error, attempt);
      attempts.push(attemptRecord({ attempt, startedAt, lookupMode: LOOKUP_MODE_SITE_FALLBACK, error: lastError }));
      lastError.attempts = [...attempts];
      await onProgress?.({ type: "attempt-result", key, ...attempts[attempts.length - 1] });

      if (!lastError.retryable || attempt === MAX_ATTEMPTS_PER_KEY) {
        break;
      }

      if (typeof onProgress === "function") {
        await onProgress({
          type: "retry-wait",
          key,
          attempt,
          maxAttempts: MAX_ATTEMPTS_PER_KEY,
          retryDelayMs: RETRY_DELAY_MS,
          message: lastError.message,
          lookupMode: LOOKUP_MODE_SITE_FALLBACK
        });
      }

      await page.waitForTimeout(RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

async function emitUnavailableResults({ keys, onResult, message }) {
  const results = [];

  for (const [index, key] of keys.entries()) {
    const result = createLookupErrorResult({
      key,
      error: new LookupError(message, {
        retryable: false,
        attemptCount: 1,
        errorCode: "fallback_indisponivel",
        lookupMode: LOOKUP_MODE_SITE_FALLBACK
      }),
      lookupMode: LOOKUP_MODE_SITE_FALLBACK
    });

    results.push(result);

    if (typeof onResult === "function") {
      await onResult(result, {
        index,
        total: keys.length
      });
    }
  }

  return results;
}

async function processAccessKeysWithSiteFallback({ keys, downloadsDir, organization, onResult, onProgress }) {
  let browser = null;
  let context = null;
  let page = null;

  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    context = await createBrowserContext(browser);
    page = await context.newPage();
    page.setDefaultTimeout(LOOKUP_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(LOOKUP_TIMEOUT_MS);

    console.log(
      `[fallback-site] Processando ${keys.length} chave(s) com canal=${launched.launchInfo.channel}.`
    );

    const results = [];

    for (const [index, key] of keys.entries()) {
      let result = null;

      try {
        result = await downloadForKey(page, key, downloadsDir, async (progress) => {
          if (typeof onProgress === "function") {
            await onProgress(progress, {
              sourceIndex: index,
              total: keys.length
            });
          }
        }, organization);
      } catch (error) {
        result = createLookupErrorResult({
          key,
          error,
          lookupMode: LOOKUP_MODE_SITE_FALLBACK
        });
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
  } catch (error) {
    return emitUnavailableResults({
      keys,
      onResult,
      message: error?.message || "Falha ao iniciar o fallback automatico do site."
    });
  } finally {
    if (context) {
      await context.close();
    }

    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  processAccessKeysWithSiteFallback,
  diagnosticBrowser: {
    launchBrowser,
    createBrowserContext,
    openLookupPage,
    typeAccessKey,
    requestXmlForKey,
    lookupTimeoutMs: LOOKUP_TIMEOUT_MS,
    maxAttempts: MAX_ATTEMPTS_PER_KEY,
    retryDelayMs: RETRY_DELAY_MS
  }
};
