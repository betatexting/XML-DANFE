const { saveOrganizedXml } = require("./xmlStorage");
const { getIssueDateFromXml } = require("./accessKeys");
const {
  DEFAULT_RETRY_DELAY_MS,
  LOOKUP_MODE_HTTP_DIRECT,
  LookupError,
  WINDOW_EXPIRED_ERROR_CODE,
  createLookupErrorResult,
  createLookupSuccessResult
} = require("./lookupResult");

const LOOKUP_URL =
  process.env.CONSULTA_DANFE_API_URL || "https://consultadanfe.com/api/v1/consulta";
const LOOKUP_TIMEOUT_MS = Number.parseInt(process.env.CONSULTA_DANFE_TIMEOUT_MS, 10) || 18000;
const MAX_ATTEMPTS_PER_KEY = Math.max(
  1,
  Number.parseInt(process.env.CONSULTA_DANFE_MAX_ATTEMPTS, 10) || 2
);
const DEFAULT_CONCURRENT_LOOKUPS =
  Math.max(1, Number.parseInt(process.env.CONSULTA_DANFE_CONCURRENCY, 10) || 3);
const RETRYABLE_STATUS_CODES = new Set([202, 408, 425, 429, 500, 502, 503, 504]);
const PENDING_ERROR_CODE = "pendente";
const MAX_RETRY_DELAY_MS = Number.parseInt(process.env.CONSULTA_DANFE_MAX_RETRY_DELAY_MS, 10) || 3000;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function decodeBase64Text(value) {
  return Buffer.from(value, "base64").toString("utf8").trim();
}

function extractXmlFromApiPayload(payload) {
  const directXmlCandidates = [payload?.xml, payload?.codigo_xml];

  for (const candidate of directXmlCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (typeof payload?.xml_base64 === "string" && payload.xml_base64.trim()) {
    return decodeBase64Text(payload.xml_base64);
  }

  return "";
}

function readApiMessage(payload, fallback) {
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  if (typeof payload?.error_description === "string" && payload.error_description.trim()) {
    return payload.error_description.trim();
  }

  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }

  return fallback;
}

function readApiErrorCode(payload, response) {
  const payloadCode = typeof payload?.error === "string" ? payload.error.trim() : "";
  const headerCode = response.headers.get("x-error-code");

  if (payloadCode) {
    return payloadCode;
  }

  if (typeof headerCode === "string" && headerCode.trim()) {
    return headerCode.trim();
  }

  return "";
}

function isFallbackEligibleErrorCode(errorCode) {
  return errorCode === WINDOW_EXPIRED_ERROR_CODE;
}

function buildApiErrorMessage({ payload, response, errorCode, fallback }) {
  if (errorCode === WINDOW_EXPIRED_ERROR_CODE) {
    return [
      "A chave esta fora da janela da API publica atual.",
      "Ela pode ser reenviada pelo fallback automatico do site ao final da rodada."
    ].join(" ");
  }

  if (errorCode === PENDING_ERROR_CODE) {
    return readApiMessage(
      payload,
      "A API ainda esta preparando essa consulta. O app vai tentar novamente em instantes."
    );
  }

  return readApiMessage(payload, fallback);
}

function parseRetryAfterMs(response) {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) {
    return DEFAULT_RETRY_DELAY_MS;
  }

  const seconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.max(seconds * 1000, DEFAULT_RETRY_DELAY_MS), MAX_RETRY_DELAY_MS);
  }

  const dateValue = Date.parse(retryAfter);
  if (Number.isFinite(dateValue)) {
    return Math.min(
      Math.max(dateValue - Date.now(), DEFAULT_RETRY_DELAY_MS),
      MAX_RETRY_DELAY_MS
    );
  }

  return DEFAULT_RETRY_DELAY_MS;
}

async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function createLookupError(message, options = {}) {
  return new LookupError(message, {
    ...options,
    lookupMode: LOOKUP_MODE_HTTP_DIRECT
  });
}

function decorateLookupAttempt(error, attemptCount) {
  if (error instanceof LookupError) {
    error.attemptCount = attemptCount;
    error.lookupMode = LOOKUP_MODE_HTTP_DIRECT;
    return error;
  }

  return createLookupError(error?.message || "Falha ao consultar a chave no Consulta DANFE.", {
    retryable: true,
    attemptCount
  });
}

function isPendingPayload(payload, response) {
  const normalizedStatus = String(payload?.status || "")
    .trim()
    .toLowerCase();

  return response.status === 202 || normalizedStatus === "pendente";
}

async function requestXmlForKey(key) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, LOOKUP_TIMEOUT_MS);

  try {
    const response = await fetch(LOOKUP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "consulta-danfe-automacao/0.1.0"
      },
      body: JSON.stringify({
        chave: key,
        format: "json"
      }),
      signal: controller.signal
    });
    const payload = await readJsonSafely(response);
    const errorCode = readApiErrorCode(payload, response);

    if (!response.ok) {
      throw createLookupError(
        buildApiErrorMessage({
          payload,
          response,
          errorCode,
          fallback: `A API retornou ${response.status} ao consultar a chave.`
        }),
        {
          retryable: RETRYABLE_STATUS_CODES.has(response.status),
          retryAfterMs: parseRetryAfterMs(response),
          errorCode,
          httpStatus: response.status,
          fallbackEligible: isFallbackEligibleErrorCode(errorCode)
        }
      );
    }

    if (isPendingPayload(payload, response)) {
      throw createLookupError(
        buildApiErrorMessage({
          payload,
          response,
          errorCode: errorCode || PENDING_ERROR_CODE,
          fallback: "A API ainda nao liberou o XML dessa chave."
        }),
        {
          retryable: true,
          retryAfterMs: parseRetryAfterMs(response),
          errorCode: errorCode || PENDING_ERROR_CODE,
          httpStatus: response.status
        }
      );
    }

    const xml = extractXmlFromApiPayload(payload);
    if (!xml) {
      throw createLookupError(
        buildApiErrorMessage({
          payload,
          response,
          errorCode,
          fallback: "A resposta da API nao trouxe o XML esperado."
        }),
        {
          retryable: false,
          errorCode,
          httpStatus: response.status,
          fallbackEligible: isFallbackEligibleErrorCode(errorCode)
        }
      );
    }

    return xml;
  } catch (error) {
    if (error instanceof LookupError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw createLookupError("Tempo limite excedido ao consultar a chave no Consulta DANFE.", {
        retryable: true
      });
    }

    throw createLookupError(error?.message || "Falha ao consultar a chave no Consulta DANFE.", {
      retryable: true
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function saveXmlForKey(xml, key, downloadsDir, attemptCount, organization) {
  const targetFile = await saveOrganizedXml(xml, key, downloadsDir, organization);

  return {
    ...createLookupSuccessResult({
      key,
      targetFile,
      lookupMode: LOOKUP_MODE_HTTP_DIRECT,
      attemptCount
    }),
    documentIssueDate: getIssueDateFromXml(xml)
  };
}

async function downloadForKey(key, downloadsDir, onProgress, organization) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_KEY; attempt += 1) {
    try {
      if (typeof onProgress === "function") {
        await onProgress({
          type: "attempt",
          key,
          attempt,
          maxAttempts: MAX_ATTEMPTS_PER_KEY,
          lookupMode: LOOKUP_MODE_HTTP_DIRECT
        });
      }

      const xml = await requestXmlForKey(key);
      return await saveXmlForKey(xml, key, downloadsDir, attempt, organization);
    } catch (error) {
      lastError = decorateLookupAttempt(error, attempt);

      if (!lastError.retryable || attempt === MAX_ATTEMPTS_PER_KEY) {
        break;
      }

      const retryDelayMs = Math.min(
        Math.max(lastError.retryAfterMs || DEFAULT_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS),
        MAX_RETRY_DELAY_MS
      );

      if (typeof onProgress === "function") {
        await onProgress({
          type: "retry-wait",
          key,
          attempt,
          maxAttempts: MAX_ATTEMPTS_PER_KEY,
          retryDelayMs,
          message: lastError.message,
          lookupMode: LOOKUP_MODE_HTTP_DIRECT
        });
      }

      await delay(retryDelayMs);
    }
  }

  throw lastError;
}

async function processAccessKeys({
  keys,
  downloadsDir,
  organization,
  onResult,
  onProgress,
  concurrency = DEFAULT_CONCURRENT_LOOKUPS
}) {
  const results = new Array(keys.length);
  const total = keys.length;
  const activeConcurrency = Math.min(Math.max(1, concurrency), Math.max(1, total));
  let nextIndex = 0;
  let completedCount = 0;

  console.log(
    `[consulta-http] Processando ${total} chave(s) pela API direta com concorrencia=${activeConcurrency}.`
  );

  async function processOne(index) {
    const key = keys[index];

    try {
      return await downloadForKey(key, downloadsDir, async (progress) => {
        if (typeof onProgress === "function") {
          await onProgress(progress, {
            sourceIndex: index,
            total
          });
        }
      }, organization);
    } catch (error) {
      return createLookupErrorResult({
        key,
        error,
        lookupMode: LOOKUP_MODE_HTTP_DIRECT
      });
    }
  }

  async function worker() {
    while (nextIndex < total) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      const result = await processOne(currentIndex);
      results[currentIndex] = result;
      completedCount += 1;

      if (typeof onResult === "function") {
        await onResult(result, {
          index: completedCount - 1,
          sourceIndex: currentIndex,
          completed: completedCount,
          total
        });
      }
    }
  }

  await Promise.all(Array.from({ length: activeConcurrency }, () => worker()));
  return results;
}

module.exports = {
  DEFAULT_CONCURRENT_LOOKUPS,
  LOOKUP_MODE_HTTP_DIRECT,
  LookupError,
  PENDING_ERROR_CODE,
  WINDOW_EXPIRED_ERROR_CODE,
  decodeBase64Text,
  extractXmlFromApiPayload,
  processAccessKeys,
  requestXmlForKey
};
