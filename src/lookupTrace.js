const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

// Explicit allowlist: certificates, passwords and fiscal XML never enter these logs.
function traceResult(result = {}) {
  const fields = ["key", "status", "message", "errorCode", "httpStatus", "lookupMode", "attemptCount", "startedAt", "finishedAt", "durationMs", "attempt", "retryable", "downloadMethod", "companyCnpj", "invoiceType", "interestedCnpj"];
  const entry = Object.fromEntries(fields.filter((field) => result[field] !== undefined).map((field) => [field, result[field]]));
  for (const field of ["attempts", "fallbackHistory"]) {
    if (Array.isArray(result[field])) entry[field] = result[field].map(traceResult);
  }
  if (result.initialError) entry.initialError = traceResult(result.initialError);
  if (result.sefaz) entry.sefaz = Object.fromEntries(["queryType", "submitted", "cStat", "xMotivo", "source", "batches", "documentsRead", "requestedKeys", "initialNsu", "lastNsu", "maxNsu", "batchLimitReached", "nextAllowedAt", "documentFound", "completeXml"]
    .filter((field) => ["string", "boolean", "number"].includes(typeof result.sefaz[field]))
    .map((field) => [field, result.sefaz[field]]));
  if (result.routing) entry.routing = Object.fromEntries(["method", "initialMethod", "period", "reason", "timeZone"]
    .filter((field) => typeof result.routing[field] === "string")
    .map((field) => [field, result.routing[field]]));
  return entry;
}

async function createTrace(downloadsDir, label) {
  const directory = path.join(downloadsDir, "relatorios-consultas");
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.jsonl`);
  let writing = Promise.resolve();
  return {
    filePath,
    append(event) {
      const line = JSON.stringify({ timestamp: new Date().toISOString(), label, ...event }) + "\n";
      writing = writing.then(() => fs.appendFile(filePath, line, "utf8"));
      return writing;
    }
  };
}

function attemptRecord({ attempt, startedAt, lookupMode, error }) {
  return {
    attempt, startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt, lookupMode, status: error ? "error" : "success",
    ...(error ? { message: error.message, errorCode: error.errorCode || "", httpStatus: error.httpStatus || null, retryable: Boolean(error.retryable) } : {})
  };
}

module.exports = { traceResult, createTrace, attemptRecord };
