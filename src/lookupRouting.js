const { getIssueMonthFromAccessKey } = require("./accessKeys");
const apiClient = require("./consultaDanfe");
const siteClient = require("./siteFallback");
const { LookupError, createLookupErrorResult, isFallbackEligibleResult } = require("./lookupResult");

const POLICY_TIME_ZONE = "America/Sao_Paulo";

function planLookup(key, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: POLICY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const current = Number(parts.year) * 12 + Number(parts.month) - 1;
  const period = getIssueMonthFromAccessKey(key);
  const issued = Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1;
  let reason = "";
  if (!/^\d{44}$/.test(key)) reason = "invalid_key";
  else if (!period) reason = "invalid_period";
  else if (key.slice(20, 22) !== "55") reason = "unsupported_model";
  else if (issued > current) reason = "future_period";
  if (reason) return { method: "none", period, reason, timeZone: POLICY_TIME_ZONE };
  const eligible = issued === current || (issued === current - 1 && Number(parts.day) < 15);
  return { method: eligible ? "api" : "site", period,
    reason: eligible ? "within_api_window" : "outside_api_window", timeZone: POLICY_TIME_ZONE };
}

async function processRoutedKeys({ keys, downloadsDir, organization, onResult, onProgress,
  now = new Date(), apiProcessor = apiClient.processAccessKeys, siteProcessor = siteClient.processAccessKeysWithSiteFallback }) {
  const plans = keys.map((key) => planLookup(key, now));
  const results = new Array(keys.length);
  const apiFailures = new Map();
  const indexes = new Map(keys.map((key, index) => [key, index]));
  let completed = 0;
  async function publish(result) {
    const index = indexes.get(result.key);
    if (index === undefined || results[index]) return;
    if (result.lookupMode === "http-direct" && isFallbackEligibleResult(result)) {
      if (!apiFailures.has(result.key)) {
        apiFailures.set(result.key, result);
        await onProgress?.({ ...result, type: "route-fallback" }, { sourceIndex: index, total: keys.length });
      }
      return;
    }
    const initial = result.lookupMode === "site-fallback" ? apiFailures.get(result.key) : null;
    if (initial) result = { ...result, initialError: initial.initialError || initial,
      fallbackHistory: [...(initial.fallbackHistory || []), initial] };
    const routing = initial ? { ...plans[index], initialMethod: "api", method: "site", reason: "api_failed_fallback" } : plans[index];
    const decorated = { ...result, routing, ...(result.status === "success" ? {
      downloadMethod: result.downloadMethod || (routing.method === "site" ? "without-certificate-site" : "without-certificate-api")
    } : {}) };
    results[index] = decorated;
    completed++;
    await onResult?.(decorated, { index: completed - 1, sourceIndex: index, completed, total: keys.length });
  }
  for (let index = 0; index < keys.length; index++) {
    if (plans[index].method !== "none") continue;
    await publish(createLookupErrorResult({ key: keys[index], error: new LookupError(
      ({ invalid_key: "Chave invalida.", invalid_period: "Periodo da chave invalido.",
        unsupported_model: "A consulta pela chave aceita somente NF-e modelo 55.",
        future_period: "A chave informa um mes de emissao futuro." })[plans[index].reason],
      { errorCode: plans[index].reason, retryable: false, lookupMode: "input-validation" }
    ) }));
  }
  async function run(method, processor, selectedKeys) {
    const group = selectedKeys || keys.filter((_, index) => plans[index].method === method);
    if (!group.length) return;
    const lookupMode = method === "api" ? "http-direct" : "site-fallback";
    try {
      const returned = await processor({ keys: group, downloadsDir, organization, onResult: publish,
        onProgress: async (progress) => onProgress?.(progress, {
          sourceIndex: indexes.get(progress.key), total: keys.length
        }) });
      for (const result of returned || []) await publish(result);
    } catch (error) {
      for (const key of group) {
        if (!results[indexes.get(key)]) await publish(createLookupErrorResult({ key, lookupMode,
          error: new LookupError(error.message || "Falha ao consultar a origem selecionada.", { lookupMode }) }));
      }
    }
  }
  // The two origins start independently; old keys do not wait for predictable API errors.
  await Promise.all([run("api", apiProcessor), run("site", siteProcessor)]);
  // A single site worker handles real API failures too, without a second UI round.
  if (apiFailures.size) await run("site", siteProcessor, [...apiFailures.keys()]);
  return results;
}

module.exports = { POLICY_TIME_ZONE, planLookup, processRoutedKeys };
