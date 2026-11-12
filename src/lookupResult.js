const path = require("path");

const LOOKUP_MODE_HTTP_DIRECT = "http-direct";
const LOOKUP_MODE_SITE_FALLBACK = "site-fallback";
const WINDOW_EXPIRED_ERROR_CODE = "data_fora_da_janela";
const DEFAULT_RETRY_DELAY_MS = 1500;

class LookupError extends Error {
  constructor(
    message,
    {
      retryable = false,
      retryAfterMs = DEFAULT_RETRY_DELAY_MS,
      errorCode = "",
      httpStatus = null,
      fallbackEligible = false,
      attemptCount = 1,
      lookupMode = LOOKUP_MODE_HTTP_DIRECT,
      sefaz = null
    } = {}
  ) {
    super(message);
    this.name = "LookupError";
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.errorCode = errorCode;
    this.httpStatus = httpStatus;
    this.fallbackEligible = fallbackEligible;
    this.attemptCount = attemptCount;
    this.lookupMode = lookupMode;
    this.sefaz = sefaz;
  }
}

function formatLookupFailureMessage(error) {
  const baseMessage =
    typeof error?.message === "string" && error.message.trim()
      ? error.message.trim()
      : "Falha ao baixar o arquivo.";
  const attempts = Number.isFinite(error?.attemptCount) ? error.attemptCount : 1;

  if (attempts <= 1) {
    return baseMessage;
  }

  return `Falha apos ${attempts} tentativas. ${baseMessage}`;
}

function createLookupSuccessResult({
  key,
  targetFile,
  lookupMode = LOOKUP_MODE_HTTP_DIRECT,
  attemptCount = 1
}) {
  return {
    key,
    status: "success",
    fileName: path.basename(targetFile),
    filePath: targetFile,
    lookupMode,
    attemptCount
  };
}

function createLookupErrorResult({
  key,
  error,
  lookupMode = LOOKUP_MODE_HTTP_DIRECT
}) {
  const normalizedError =
    error instanceof LookupError
      ? error
      : new LookupError(error?.message || "Falha ao baixar o arquivo.", {
          lookupMode
        });

  return {
    key,
    status: "error",
    message: formatLookupFailureMessage(normalizedError),
    errorCode: normalizedError.errorCode || "",
    httpStatus: normalizedError.httpStatus || null,
    fallbackEligible: Boolean(normalizedError.fallbackEligible),
    retryable: Boolean(normalizedError.retryable),
    attemptCount: Number.isFinite(normalizedError.attemptCount)
      ? normalizedError.attemptCount
      : 1,
    lookupMode: normalizedError.lookupMode || lookupMode,
    sefaz: normalizedError.sefaz || null
  };
}

function isFallbackEligibleResult(result) {
  return (
    result?.status === "error" &&
    result?.lookupMode !== LOOKUP_MODE_SITE_FALLBACK &&
    typeof result?.key === "string" &&
    /^\d{44}$/.test(result.key)
  );
}

module.exports = {
  DEFAULT_RETRY_DELAY_MS,
  LOOKUP_MODE_HTTP_DIRECT,
  LOOKUP_MODE_SITE_FALLBACK,
  LookupError,
  WINDOW_EXPIRED_ERROR_CODE,
  createLookupErrorResult,
  createLookupSuccessResult,
  formatLookupFailureMessage,
  isFallbackEligibleResult
};
