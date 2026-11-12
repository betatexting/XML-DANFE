const https = require("https");
const { getCertificateOrganization, saveOrganizedXml } = require("./xmlStorage");
const zlib = require("zlib");
const { promisify } = require("util");
const { getIssueDateFromXml } = require("./accessKeys");
const {
  LookupError,
  createLookupErrorResult,
  createLookupSuccessResult
} = require("./lookupResult");
const {
  deferNextNsuCheck,
  getDistributionState,
  getLastNsu,
  normalizeNsu,
  readCachedXml,
  saveCachedXml,
  saveLastNsu
} = require("./nfeDistributionState");

const gunzip = promisify(zlib.gunzip);
const LOOKUP_MODE_CERTIFICATE = "nfe-distribution-certificate";
const LOOKUP_MODE_CERTIFICATE_NSU = "nfe-distribution-nsu";
const MAX_CERTIFICATE_POINT_LOOKUPS = Math.min(
  20,
  Math.max(1, Number.parseInt(process.env.NFE_CERTIFICATE_POINT_LOOKUP_LIMIT, 10) || 20)
);
const MAX_NSU_BATCHES_PER_FALLBACK = Math.min(
  10,
  Math.max(1, Number.parseInt(process.env.NFE_DISTRIBUTION_NSU_BATCH_LIMIT, 10) || 3)
);
const NSU_RETRY_WAIT_MS = 60 * 60 * 1000;
const DISTRIBUTION_URL =
  process.env.NFE_DISTRIBUTION_URL ||
  "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
const DISTRIBUTION_TIMEOUT_MS =
  Number.parseInt(process.env.NFE_DISTRIBUTION_TIMEOUT_MS, 10) || 30000;
const SOAP_ACTION =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXmlText(value) {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function getXmlTagValue(xml, tagName) {
  const match = String(xml || "").match(
    new RegExp(`<\\/?(?:[\\w-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`, "i")
  );
  return match ? decodeXmlText(match[1].trim()) : "";
}

function createSefazTrace({
  queryType,
  submitted,
  cStat = "",
  xMotivo = "",
  httpStatus = null,
  ...extra
}) {
  return {
    queryType,
    submitted: Boolean(submitted),
    cStat,
    xMotivo,
    httpStatus,
    checkedAt: new Date().toISOString(),
    ...extra
  };
}

function setSefazTrace(error, trace) {
  error.sefaz = {
    ...(error.sefaz || {}),
    ...trace
  };
  return error;
}

function buildDistributionEnvelope({ key, cnpj, authorUfCode }) {
  return buildNfeDistributionEnvelope({
    cnpj,
    authorUfCode,
    queryXml: `<consChNFe><chNFe>${escapeXml(key)}</chNFe></consChNFe>`
  });
}

function buildDistNsuEnvelope({ cnpj, authorUfCode, ultNsu }) {
  return buildNfeDistributionEnvelope({
    cnpj,
    authorUfCode,
    queryXml: `<distNSU><ultNSU>${escapeXml(normalizeNsu(ultNsu))}</ultNSU></distNSU>`
  });
}

function buildNfeDistributionEnvelope({ cnpj, authorUfCode, queryXml }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>1</tpAmb>
          <cUFAutor>${escapeXml(authorUfCode)}</cUFAutor>
          <CNPJ>${escapeXml(cnpj)}</CNPJ>
          ${queryXml}
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap:Body>
</soap:Envelope>`;
}

function requestSoap({
  body,
  certificate,
  lookupMode = LOOKUP_MODE_CERTIFICATE,
  queryType = "consChNFe"
}) {
  const endpoint = new URL(DISTRIBUTION_URL);
  if (endpoint.protocol !== "https:") {
    throw setSefazTrace(
      new LookupError("A URL do servico de distribuicao deve usar HTTPS.", {
        lookupMode
      }),
      createSefazTrace({
        queryType,
        submitted: false,
        xMotivo: "A chamada foi bloqueada antes do envio porque a URL nao usa HTTPS."
      })
    );
  }

  return new Promise((resolve, reject) => {
    const request = https.request(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: `"${SOAP_ACTION}"`,
          "Content-Length": Buffer.byteLength(body, "utf8")
        },
        pfx: certificate.pfx,
        passphrase: certificate.passphrase,
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
        agent: false,
        timeout: DISTRIBUTION_TIMEOUT_MS
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");

          if (response.statusCode < 200 || response.statusCode >= 300) {
            const message =
              getXmlTagValue(responseBody, "faultstring") ||
              `A SEFAZ retornou HTTP ${response.statusCode} na consulta com certificado.`;
            reject(
              setSefazTrace(
                new LookupError(message, {
                  lookupMode,
                  httpStatus: response.statusCode
                }),
                createSefazTrace({
                  queryType,
                  submitted: true,
                  httpStatus: response.statusCode,
                  xMotivo: message
                })
              )
            );
            return;
          }

          resolve(responseBody);
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(
        setSefazTrace(
          new LookupError("Tempo limite excedido ao consultar a SEFAZ com o certificado.", {
            lookupMode,
            retryable: true
          }),
          createSefazTrace({
            queryType,
            submitted: true,
            xMotivo: "A SEFAZ nao respondeu antes do tempo limite."
          })
        )
      );
    });
    request.on("error", (error) => {
      reject(
        error instanceof LookupError
          ? error
          : setSefazTrace(
              new LookupError(error.message || "Falha na conexao segura com a SEFAZ.", {
                lookupMode,
                retryable: true
              }),
              createSefazTrace({
                queryType,
                submitted: true,
                xMotivo: error.message || "Falha na conexao segura com a SEFAZ."
              })
            )
      );
    });
    request.end(body);
  });
}

function createSefazResponseError({ cStat, xMotivo, lookupMode, queryType = "consChNFe" }) {
  const isNoDocumentForCertificate = cStat === "137";
  const message = isNoDocumentForCertificate
    ? "A SEFAZ nao localizou esta nota para o certificado selecionado. " +
      "Verifique se ele pertence a uma empresa autorizada no documento." +
      (xMotivo ? ` Retorno: ${xMotivo}.` : "")
    : xMotivo || `A SEFAZ retornou o status ${cStat}.`;

  return setSefazTrace(
    new LookupError(message, {
      lookupMode,
      errorCode: isNoDocumentForCertificate ? "certificado_sem_autorizacao" : `sefaz_${cStat}`
    }),
    createSefazTrace({
      queryType,
      submitted: true,
      cStat,
      xMotivo
    })
  );
}

function extractAccessKeyFromXml(xml) {
  const value = String(xml || "");
  const infNfeMatch = value.match(/\bId\s*=\s*["']NFe(\d{44})["']/i);
  const chNFeMatch = value.match(/<(?:\w+:)?chNFe\b[^>]*>\s*(\d{44})\s*<\/(?:\w+:)?chNFe>/i);

  return infNfeMatch?.[1] || chNFeMatch?.[1] || "";
}

function isCompleteNfeXml(xml) {
  return /<(?:\w+:)?(?:nfeProc|procNFe)\b/i.test(String(xml || ""));
}

async function parseDistributionResponse(
  responseXml,
  { lookupMode = LOOKUP_MODE_CERTIFICATE, queryType = "consChNFe" } = {}
) {
  const cStat = getXmlTagValue(responseXml, "cStat");
  const xMotivo = getXmlTagValue(responseXml, "xMotivo");

  if (cStat && cStat !== "138" && cStat !== "137") {
    throw createSefazResponseError({
      cStat,
      xMotivo,
      lookupMode,
      queryType
    });
  }

  const documents = [
    ...String(responseXml).matchAll(/<docZip\b([^>]*)>([\s\S]*?)<\/docZip>/gi)
  ];
  const decodedDocuments = [];

  for (const document of documents) {
    const attributes = document[1] || "";
    const schema = attributes.match(/\bschema\s*=\s*["']([^"']+)["']/i)?.[1] || "";

    let xml;
    try {
      xml = (
        await gunzip(Buffer.from(document[2].replace(/\s/g, ""), "base64"))
      ).toString("utf8");
    } catch (_error) {
      continue;
    }

    decodedDocuments.push({
      key: extractAccessKeyFromXml(xml),
      schema,
      xml: xml.trim(),
      isComplete: isCompleteNfeXml(xml)
    });
  }

  return {
    cStat,
    xMotivo,
    ultNsu: normalizeNsu(getXmlTagValue(responseXml, "ultNSU")),
    maxNsu: normalizeNsu(getXmlTagValue(responseXml, "maxNSU")),
    documents: decodedDocuments
  };
}

async function extractCompleteDocument(responseXml) {
  const response = await parseDistributionResponse(responseXml, {
    lookupMode: LOOKUP_MODE_CERTIFICATE,
    queryType: "consChNFe"
  });

  if (response.cStat === "137") {
    throw createSefazResponseError({
      cStat: response.cStat,
      xMotivo: response.xMotivo,
      lookupMode: LOOKUP_MODE_CERTIFICATE,
      queryType: "consChNFe"
    });
  }

  const completeDocument = response.documents.find((document) => document.isComplete);
  if (completeDocument) {
    return {
      xml: completeDocument.xml,
      cStat: response.cStat,
      xMotivo: response.xMotivo
    };
  }

  if (response.documents.length === 0) {
    throw setSefazTrace(
      new LookupError(
        response.xMotivo || "A SEFAZ nao disponibilizou documento para esta chave e este certificado.",
        {
          lookupMode: LOOKUP_MODE_CERTIFICATE,
          errorCode: "documento_nao_disponivel"
        }
      ),
      createSefazTrace({
        queryType: "consChNFe",
        submitted: true,
        cStat: response.cStat,
        xMotivo: response.xMotivo
      })
    );
  }

  const schemas = [...new Set(response.documents.map((document) => document.schema))]
    .filter(Boolean)
    .join(", ");
  throw setSefazTrace(
    new LookupError(
      "A SEFAZ disponibilizou apenas um resumo do documento, nao o XML completo. " +
        "Verifique a autorizacao do certificado e, quando aplicavel, a manifestacao do destinatario." +
        (schemas ? ` Retorno: ${schemas}.` : ""),
      {
        lookupMode: LOOKUP_MODE_CERTIFICATE,
        errorCode: "documento_resumido"
      }
    ),
    createSefazTrace({
      queryType: "consChNFe",
      submitted: true,
      cStat: response.cStat,
      xMotivo: response.xMotivo,
      schemas
    })
  );
}

async function extractCompleteXml(responseXml) {
  return (await extractCompleteDocument(responseXml)).xml;
}

async function downloadForKey({ key, downloadsDir, organization, certificate, onProgress }) {
  if (typeof onProgress === "function") {
    await onProgress({
      type: "attempt",
      key,
      attempt: 1,
      maxAttempts: 1,
      lookupMode: LOOKUP_MODE_CERTIFICATE
    });
  }

  const envelope = buildDistributionEnvelope({
    key,
    cnpj: certificate.cnpj,
    authorUfCode: certificate.authorUfCode
  });
  const responseXml = await requestSoap({
    body: envelope,
    certificate,
    queryType: "consChNFe"
  });
  const document = await extractCompleteDocument(responseXml);
  const xml = document.xml;
  const targetFile = await saveOrganizedXml(xml, key, downloadsDir, organization);

  return {
    ...createLookupSuccessResult({
      key,
      targetFile,
      lookupMode: LOOKUP_MODE_CERTIFICATE,
      attemptCount: 1
    }),
    documentIssueDate: getIssueDateFromXml(xml),
    sefaz: createSefazTrace({
      queryType: "consChNFe",
      submitted: true,
      cStat: document.cStat,
      xMotivo: document.xMotivo
    })
  };
}

function createDeferredPointLookupResult(key) {
  const result = createLookupErrorResult({
    key,
    error: new LookupError(
      "A consulta individual com certificado foi limitada para evitar bloqueio da SEFAZ. " +
        "A chave sera buscada pela distribuicao NSU.",
      {
        lookupMode: LOOKUP_MODE_CERTIFICATE,
        errorCode: "consulta_por_chave_limitada"
      }
    ),
    lookupMode: LOOKUP_MODE_CERTIFICATE
  });
  result.sefaz = createSefazTrace({
    queryType: "consChNFe",
    submitted: false,
    xMotivo: "A chave nao foi enviada em consulta individual para respeitar o limite da SEFAZ.",
    forwardedTo: "distNSU"
  });
  return result;
}

async function processAccessKeysWithCertificate({
  keys,
  downloadsDir,
  organization,
  certificate,
  onResult,
  onProgress
}) {
  organization = getCertificateOrganization(certificate);
  const results = [];
  let shouldUseNsuFallback = false;

  for (const [index, key] of keys.entries()) {
    let result;

    if (shouldUseNsuFallback || index >= MAX_CERTIFICATE_POINT_LOOKUPS) {
      result = createDeferredPointLookupResult(key);
    } else {
      try {
        result = await downloadForKey({
          key,
          downloadsDir,
          organization,
          certificate,
          onProgress: (progress) =>
            onProgress?.(progress, {
              sourceIndex: index,
              total: keys.length
            })
        });
        result.downloadMethod = "certificate-key";
      } catch (error) {
        result = createLookupErrorResult({
          key,
          error,
          lookupMode: LOOKUP_MODE_CERTIFICATE
        });
      }

      if (result.errorCode === "sefaz_656") {
        shouldUseNsuFallback = true;
      }
    }

    results.push(result);
    if (typeof onResult === "function") {
      await onResult(result, {
        index,
        sourceIndex: index,
        completed: index + 1,
        total: keys.length
      });
    }
  }

  return results;
}

async function saveXmlForNsu({
  xml,
  key,
  downloadsDir,
  organization,
  attemptCount = 1,
  downloadMethod,
  sefaz = null
}) {
  let targetFile;
  try {
    targetFile = await saveOrganizedXml(xml, key, downloadsDir, organization);
  } catch (error) {
    return createLookupErrorResult({
      key,
      error: new LookupError(error.message, {
        lookupMode: LOOKUP_MODE_CERTIFICATE_NSU,
        sefaz
      }),
      lookupMode: LOOKUP_MODE_CERTIFICATE_NSU
    });
  }

  return {
    ...createLookupSuccessResult({
      key,
      targetFile,
      lookupMode: LOOKUP_MODE_CERTIFICATE_NSU,
      attemptCount
    }),
    downloadMethod,
    documentIssueDate: getIssueDateFromXml(xml),
    sefaz
  };
}

function createNsuNotFoundResult(key, error = null, sefaz = null) {
  const result = createLookupErrorResult({
    key,
    error:
      error ||
      new LookupError(
        "A chave nao foi localizada na distribuicao NSU deste certificado. " +
          "Ela sera buscada sem certificado.",
        {
          lookupMode: LOOKUP_MODE_CERTIFICATE_NSU,
          errorCode: "documento_nsu_nao_localizado"
        }
      ),
    lookupMode: LOOKUP_MODE_CERTIFICATE_NSU
  });
  result.sefaz = {
    ...(result.sefaz || {}),
    ...(sefaz || {})
  };
  return result;
}

async function processAccessKeysWithNsuDistribution({
  keys,
  downloadsDir,
  organization,
  certificate,
  onProgress
}) {
  organization = getCertificateOrganization(certificate);
  const resultsByKey = new Map();
  const remainingKeys = new Set(keys);

  for (const key of keys) {
    const cachedXml = await readCachedXml(certificate.cnpj, key);
    if (!cachedXml || !isCompleteNfeXml(cachedXml)) {
      continue;
    }

    resultsByKey.set(
      key,
      await saveXmlForNsu({
        xml: cachedXml,
        key,
        downloadsDir,
        organization,
        downloadMethod: "certificate-nsu-cache",
        sefaz: createSefazTrace({
          queryType: "distNSU",
          submitted: false,
          xMotivo: "XML completo localizado no cache da distribuicao NSU.",
          source: "cache-local"
        })
      })
    );
    remainingKeys.delete(key);
  }

  const distributionState = await getDistributionState(certificate.cnpj);
  const nsuTrace = {
    submitted: false,
    cStat: "",
    xMotivo: "",
    batches: 0,
    documentsRead: 0,
    requestedKeys: remainingKeys.size,
    initialNsu: distributionState.ultNsu,
    lastNsu: distributionState.ultNsu,
    maxNsu: distributionState.maxNsu
  };
  const getNsuTrace = (extra = {}) =>
    createSefazTrace({
      queryType: "distNSU",
      ...nsuTrace,
      ...extra
    });
  const nextAllowedAt = Date.parse(distributionState.nextAllowedAt);
  if (Number.isFinite(nextAllowedAt) && nextAllowedAt > Date.now()) {
    const nextTime = new Date(nextAllowedAt).toLocaleString("pt-BR");
    const waitError = setSefazTrace(
      new LookupError(
        `A distribuicao NSU deste certificado deve aguardar ate ${nextTime} antes de nova consulta. ` +
          "A chave sera buscada sem certificado.",
        {
          lookupMode: LOOKUP_MODE_CERTIFICATE_NSU,
          errorCode: "nsu_aguardar_nova_consulta"
        }
      ),
      getNsuTrace({
        xMotivo: `Aguardando nova consulta NSU ate ${nextTime}.`,
        nextAllowedAt: distributionState.nextAllowedAt
      })
    );
    return keys.map((key) => resultsByKey.get(key) || createNsuNotFoundResult(key, waitError));
  }

  let ultNsu = distributionState.ultNsu || (await getLastNsu(certificate.cnpj));
  let lastResponseError = null;
  let batchCount = 0;

  while (remainingKeys.size > 0 && batchCount < MAX_NSU_BATCHES_PER_FALLBACK) {
    batchCount += 1;

    if (typeof onProgress === "function") {
      await onProgress({
        type: "nsu-sync",
        key: [...remainingKeys][0] || "",
        batch: batchCount,
        lookupMode: LOOKUP_MODE_CERTIFICATE_NSU
      });
    }

    let response;
    try {
      const envelope = buildDistNsuEnvelope({
        cnpj: certificate.cnpj,
        authorUfCode: certificate.authorUfCode,
        ultNsu
      });
      response = await parseDistributionResponse(
        await requestSoap({
          body: envelope,
          certificate,
          lookupMode: LOOKUP_MODE_CERTIFICATE_NSU,
          queryType: "distNSU"
        }),
        {
          lookupMode: LOOKUP_MODE_CERTIFICATE_NSU,
          queryType: "distNSU"
        }
      );
    } catch (error) {
      lastResponseError = error;
      nsuTrace.submitted = Boolean(error?.sefaz?.submitted);
      nsuTrace.cStat = error?.sefaz?.cStat || "";
      nsuTrace.xMotivo = error?.sefaz?.xMotivo || error?.message || "";
      if (error?.errorCode === "sefaz_656") {
        await deferNextNsuCheck(certificate.cnpj, {
          ultNsu,
          delayMs: NSU_RETRY_WAIT_MS
        });
      }
      break;
    }

    nsuTrace.submitted = true;
    nsuTrace.cStat = response.cStat;
    nsuTrace.xMotivo = response.xMotivo;
    nsuTrace.batches = batchCount;
    nsuTrace.documentsRead += response.documents.length;
    nsuTrace.lastNsu = response.ultNsu;
    nsuTrace.maxNsu = response.maxNsu;

    if (response.cStat === "137") {
      await deferNextNsuCheck(certificate.cnpj, {
        ultNsu: response.ultNsu,
        maxNsu: response.maxNsu,
        delayMs: NSU_RETRY_WAIT_MS
      });
      break;
    }

    for (const document of response.documents) {
      if (!document.key) {
        continue;
      }

      if (document.isComplete) {
        await saveCachedXml(certificate.cnpj, document.key, document.xml);
      }

      if (!remainingKeys.has(document.key)) {
        continue;
      }

      if (document.isComplete) {
        resultsByKey.set(
          document.key,
          await saveXmlForNsu({
            xml: document.xml,
            key: document.key,
            downloadsDir,
            organization,
            attemptCount: batchCount,
            downloadMethod: "certificate-nsu",
            sefaz: getNsuTrace({
              documentFound: true,
              schema: document.schema
            })
          })
        );
      } else {
        resultsByKey.set(
          document.key,
          createNsuNotFoundResult(
            document.key,
            setSefazTrace(
              new LookupError(
                "A distribuicao NSU retornou apenas o resumo da NF-e, nao o XML completo.",
                {
                  lookupMode: LOOKUP_MODE_CERTIFICATE_NSU,
                  errorCode: "documento_resumido"
                }
              ),
              getNsuTrace({
                documentFound: true,
                completeXml: false,
                schema: document.schema
              })
            )
          )
        );
      }

      remainingKeys.delete(document.key);
    }

    await saveLastNsu(certificate.cnpj, response.ultNsu, response.maxNsu);

    if (response.ultNsu === response.maxNsu || response.ultNsu === ultNsu) {
      break;
    }

    ultNsu = response.ultNsu;
  }

  return keys.map(
    (key) =>
      resultsByKey.get(key) ||
      createNsuNotFoundResult(
        key,
        lastResponseError,
        getNsuTrace({
          documentFound: false,
          forwardedTo: "consulta-sem-certificado",
          batchLimitReached:
            remainingKeys.size > 0 && batchCount >= MAX_NSU_BATCHES_PER_FALLBACK
        })
      )
  );
}

module.exports = {
  LOOKUP_MODE_CERTIFICATE,
  LOOKUP_MODE_CERTIFICATE_NSU,
  MAX_CERTIFICATE_POINT_LOOKUPS,
  MAX_NSU_BATCHES_PER_FALLBACK,
  NSU_RETRY_WAIT_MS,
  buildDistNsuEnvelope,
  buildDistributionEnvelope,
  extractAccessKeyFromXml,
  extractCompleteXml,
  parseDistributionResponse,
  processAccessKeysWithCertificate,
  processAccessKeysWithNsuDistribution
};
