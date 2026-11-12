const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const { execFile } = require("child_process");
const multer = require("multer");
const XLSX = require("xlsx");
const { DEFAULT_CONCURRENT_LOOKUPS, processAccessKeys } = require("./src/consultaDanfe");
const { extractAccessKeys, getIssueMonthFromAccessKey } = require("./src/accessKeys");
const {
  CertificateError,
  formatCnpj,
  inspectCertificate
} = require("./src/certificate");
const {
  discardCertificate,
  getCertificate,
  storeCertificate
} = require("./src/certificateSession");
const {
  processAccessKeysWithCertificate,
  processAccessKeysWithNsuDistribution
} = require("./src/nfeDistribution");
const { extractCandidatesFromPdfFiles } = require("./src/pdfToXml");
const { resolveUserDataDir } = require("./src/runtimePaths");
const { processAccessKeysWithSiteFallback } = require("./src/siteFallback");
const { findLocalXmls } = require("./src/localXml");
const {
  SUPPORTED_SPREADSHEET_EXTENSIONS,
  extractCandidatesFromSpreadsheetFiles
} = require("./src/spreadsheetKeys");

const app = express();
const preferredPort = Number.parseInt(process.env.PORT, 10) || 3000;
const allowPortFallback = !process.env.PORT;
const defaultDownloadsDir =
  process.env.DOWNLOADS_DIR ||
  path.join("C:\\Users\\Contas Contabilidade\\Desktop", "werasmim");
const { getCertificateOrganization, normalizeOrganization } = require("./src/xmlStorage");
let downloadsDir = defaultDownloadsDir;
let settingsFilePathPromise = null;
let diagnosticRunning = false;
const diagnosticReports = new Map();
const AUTHOR_UF_CODES = new Set([
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
  "31",
  "32",
  "33",
  "35",
  "41",
  "42",
  "43",
  "50",
  "51",
  "52",
  "53"
]);

function createMemoryUpload({ fileSize, files, validator, errorMessage }) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize,
      files
    },
    fileFilter: (_req, file, callback) => {
      if (!validator(file)) {
        callback(new Error(errorMessage));
        return;
      }

      callback(null, true);
    }
  });
}

const pdfUpload = createMemoryUpload({
  fileSize: 10 * 1024 * 1024,
  files: 20,
  validator: (file) =>
    file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf"),
  errorMessage: "Envie apenas arquivos PDF."
});

const spreadsheetUpload = createMemoryUpload({
  fileSize: 12 * 1024 * 1024,
  files: 10,
  validator: (file) => {
    const extension = path.extname(file.originalname || "").toLowerCase();

    return SUPPORTED_SPREADSHEET_EXTENSIONS.has(extension);
  },
  errorMessage: "Envie apenas arquivos CSV, XLSX, XLSM ou XLS."
});

const certificateUpload = createMemoryUpload({
  fileSize: 5 * 1024 * 1024,
  files: 1,
  validator: (file) =>
    [".pfx", ".p12"].includes(path.extname(file.originalname || "").toLowerCase()),
  errorMessage: "Envie um certificado A1 em formato .pfx ou .p12."
});

async function getSettingsFilePath() {
  if (!settingsFilePathPromise) {
    settingsFilePathPromise = resolveUserDataDir().then((userDataDir) =>
      path.join(userDataDir, ".downloads-dir.json")
    );
  }

  return settingsFilePathPromise;
}

async function loadDownloadsDirSetting() {
  if (process.env.DOWNLOADS_DIR) {
    downloadsDir = process.env.DOWNLOADS_DIR;
    return;
  }

  try {
    const settingsFilePath = await getSettingsFilePath();
    const raw = await fs.readFile(settingsFilePath, "utf8");
    const parsed = JSON.parse(raw);

    if (typeof parsed?.downloadsDir === "string" && parsed.downloadsDir.trim()) {
      downloadsDir = parsed.downloadsDir.trim();
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Nao foi possivel ler a pasta salva. Usando a pasta padrao.");
    }
  }
}

async function saveDownloadsDirSetting() {
  if (process.env.DOWNLOADS_DIR) {
    return;
  }

  const payload = {
    downloadsDir,
    updatedAt: new Date().toISOString()
  };

  const settingsFilePath = await getSettingsFilePath();
  await fs.mkdir(path.dirname(settingsFilePath), { recursive: true });
  await fs.writeFile(settingsFilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function updateDownloadsDir(nextDownloadsDir) {
  if (typeof nextDownloadsDir !== "string" || !nextDownloadsDir.trim()) {
    throw new Error("Informe uma pasta valida para salvar os XMLs.");
  }

  await fs.mkdir(nextDownloadsDir, { recursive: true });
  downloadsDir = nextDownloadsDir.trim();
  await saveDownloadsDirSetting();

  return downloadsDir;
}

function escapePowerShellString(value) {
  return String(value).replaceAll("'", "''");
}

function startResultStream(res) {
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
}

function writeStreamEvent(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

function writeResultEvent(res, result, meta = {}) {
  writeStreamEvent(res, {
    type: "result",
    result,
    ...meta
  });
}

function writeProgressEvent(res, progress, meta = {}) {
  writeStreamEvent(res, {
    type: "progress",
    progress,
    ...meta
  });
}

function groupCandidatesByKey(candidates) {
  const results = [];
  const candidatesByKey = new Map();

  for (const candidate of candidates) {
    if (!candidate.key || candidate.status === "error") {
      results.push(candidate);
      continue;
    }

    const groupedCandidates = candidatesByKey.get(candidate.key) ?? [];
    groupedCandidates.push(candidate);
    candidatesByKey.set(candidate.key, groupedCandidates);
  }

  return {
    results,
    candidatesByKey
  };
}

function getCertificateRequestData(req) {
  const certificateId = String(req.body?.certificateId || "").trim();

  if (!certificateId) {
    return null;
  }

  const storedCertificate = getCertificate(certificateId);
  if (!storedCertificate) {
    throw new CertificateError(
      "A selecao do certificado expirou. Selecione o arquivo novamente.",
      "certificado_expirado_na_sessao"
    );
  }

  const passphrase = req.body?.certificatePassphrase;
  if (typeof passphrase !== "string" || passphrase.length > 1024) {
    throw new CertificateError("Informe uma senha de certificado valida.");
  }

  const authorUfCode = String(req.body?.certificateAuthorUf || "").trim();
  if (!AUTHOR_UF_CODES.has(authorUfCode)) {
    throw new CertificateError("Selecione a UF da empresa vinculada ao certificado.");
  }

  const identity = inspectCertificate({
    pfx: storedCertificate.buffer,
    passphrase
  });

  return {
    id: certificateId,
    ...identity,
    authorUfCode,
    pfx: storedCertificate.buffer,
    passphrase
  };
}

function buildCertificateProcessor(certificate) {
  return ({ keys, downloadsDir: targetDownloadsDir, organization, onResult, onProgress }) =>
    processAccessKeysWithCertificate({
      keys,
      downloadsDir: targetDownloadsDir,
      organization,
      certificate,
      onResult: async (result, meta) => {
        const decorated =
          result.status === "success"
            ? {
                ...result,
                downloadMethod: result.downloadMethod || "certificate-key"
              }
            : result;

        if (typeof onResult === "function") {
          await onResult(decorated, meta);
        }
      },
      onProgress
    });
}

function buildNsuProcessor(certificate) {
  return async ({ keys, downloadsDir: targetDownloadsDir, organization, onResult, onProgress }) => {
    const results = await processAccessKeysWithNsuDistribution({
      keys,
      downloadsDir: targetDownloadsDir,
      organization,
      certificate,
      onProgress
    });

    for (const [index, result] of results.entries()) {
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
  };
}

function buildProcessorWithDownloadMethod(processor, downloadMethod) {
  return ({ keys, downloadsDir: targetDownloadsDir, organization, onResult, onProgress }) =>
    processor({
      keys,
      downloadsDir: targetDownloadsDir,
      organization,
      onProgress,
      onResult: async (result, meta) => {
        const decorated =
          result.status === "success"
            ? {
                ...result,
                downloadMethod
              }
            : result;

        if (typeof onResult === "function") {
          await onResult(decorated, meta);
        }
      }
    });
}

function shouldKeepCertificate(req) {
  return req.body?.keepCertificate === true || req.body?.keepCertificate === "true";
}

function createCandidatesFromItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item) => typeof item?.key === "string" && item.key.trim())
    .map((item) => ({
      key: item.key.trim(),
      sourceName: item.sourceName,
      sourceType: item.sourceType || "manual",
      sheetName: item.sheetName,
      rowNumber: item.rowNumber,
      status: "pending"
    }));
}

function getErrorStatus(error) {
  return error instanceof CertificateError ? 400 : 500;
}

function attachCandidateMetadata(downloadResult, candidate) {
  const metadata = {};

  if (downloadResult.key) {
    metadata.issueMonth = getIssueMonthFromAccessKey(downloadResult.key);
  }

  if (candidate.sourceName) {
    metadata.sourceName = candidate.sourceName;
  }

  if (candidate.sourceType) {
    metadata.sourceType = candidate.sourceType;
  }

  if (candidate.sheetName) {
    metadata.sheetName = candidate.sheetName;
  }

  if (candidate.rowNumber) {
    metadata.rowNumber = candidate.rowNumber;
  }

  return {
    ...downloadResult,
    ...metadata
  };
}

async function processCandidateBatch({
  res,
  candidates,
  organization,
  processor = processAccessKeys
}) {
  const total = candidates.length;
  const { results, candidatesByKey } = groupCandidatesByKey(candidates);
  let completed = 0;

  startResultStream(res);
  writeStreamEvent(res, {
    type: "start",
    total
  });

  for (const result of results) {
    completed += 1;
    writeResultEvent(res, result, {
      completed,
      total
    });
  }

  const requestedKeys = [...candidatesByKey.keys()];
  writeProgressEvent(res, { type: "local-scan" }, { total });
  const localResults = await findLocalXmls({ keys: requestedKeys, downloadsDir, organization });
  for (const [key, localResult] of localResults) {
    for (const candidate of candidatesByKey.get(key)) {
      const result = attachCandidateMetadata(localResult, candidate);
      results.push(result);
      completed += 1;
      writeResultEvent(res, result, { completed, total });
    }
  }
  const keys = requestedKeys.filter((key) => !localResults.has(key));

  if (keys.length > 0) {
    await processor({
      keys,
      downloadsDir,
      organization,
      onProgress: async (progress, meta = {}) => {
        writeProgressEvent(res, progress, {
          total,
          sourceIndex: meta.sourceIndex
        });
      },
      onResult: async (downloadResult) => {
        const groupedCandidates = candidatesByKey.get(downloadResult.key) ?? [];

        if (groupedCandidates.length === 0) {
          const fallbackResult = {
            ...downloadResult
          };

          results.push(fallbackResult);
          completed += 1;
          writeResultEvent(res, fallbackResult, {
            completed,
            total
          });
          return;
        }

        for (const candidate of groupedCandidates) {
          const result = attachCandidateMetadata(downloadResult, candidate);

          results.push(result);
          completed += 1;
          writeResultEvent(res, result, {
            completed,
            total
          });
        }
      }
    });
  }

  writeStreamEvent(res, {
    type: "complete",
    results,
    total
  });
}

function openDownloadsDirPicker(initialPath) {
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Selecione a pasta para salvar os XMLs'
$dialog.UseDescriptionForTitle = $true
$dialog.ShowNewFolderButton = $true
$dialog.SelectedPath = '${escapePowerShellString(initialPath)}'
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
}
`;

  return new Promise((resolve, reject) => {
    execFile(
      "powershell",
      ["-NoProfile", "-STA", "-Command", script],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message || "Falha ao abrir o seletor de pasta."));
          return;
        }

        resolve(stdout.trim());
      }
    );
  });
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/diagnostics", async (req, res) => {
  const keys = extractAccessKeys(req.body?.rawKeys);
  if (keys.length === 0) {
    return res.status(400).json({ error: "Informe chaves de 44 digitos no bloco de entrada para diagnosticar." });
  }
  if (diagnosticRunning) {
    return res.status(409).json({ error: "Ja existe um diagnostico em andamento. Aguarde a conclusao." });
  }
  diagnosticRunning = true;
  try {
    const { runBrowserDiagnostics } = require("./src/browserDiagnostics");
    startResultStream(res);
    writeStreamEvent(res, { type: "start", total: keys.length });
    const diagnostic = await runBrowserDiagnostics({
      keys,
      downloadsDir,
      onResult: (result, meta) => {
        if (!res.destroyed) writeResultEvent(res, result, meta);
      },
      onProgress: (progress) => {
        if (!res.destroyed) writeProgressEvent(res, progress, { total: keys.length });
      }
    });
    diagnosticReports.set(diagnostic.id, diagnostic.archivePath);
    if (diagnosticReports.size > 32) diagnosticReports.delete(diagnosticReports.keys().next().value);
    if (!res.destroyed) {
      writeStreamEvent(res, {
        type: "complete",
        total: keys.length,
        diagnosticReport: {
          directory: diagnostic.directory,
          downloadUrl: `/api/diagnostics/${diagnostic.id}/download`,
          fileName: path.basename(diagnostic.archivePath)
        }
      });
      res.end();
    }
  } catch (error) {
    if (!res.destroyed) {
      if (!res.headersSent) res.status(500).json({ error: error.message || "Falha ao gerar o diagnostico." });
      else {
        writeStreamEvent(res, { type: "error", error: error.message || "Falha ao gerar o diagnostico." });
        res.end();
      }
    }
  } finally {
    diagnosticRunning = false;
  }
});

app.get("/api/diagnostics/:id/download", (req, res) => {
  const archivePath = diagnosticReports.get(req.params.id);
  if (!archivePath) return res.status(404).json({ error: "Relatorio de diagnostico nao encontrado nesta sessao." });
  res.download(archivePath, path.basename(archivePath));
});

app.post("/api/certificate/inspect", certificateUpload.single("certificate"), async (req, res) => {
  const requestedCertificateId = String(req.body?.certificateId || "").trim();
  let certificateId = requestedCertificateId;
  let storedCertificate = requestedCertificateId ? getCertificate(requestedCertificateId) : null;

  try {
    if (req.file) {
      const session = storeCertificate({
        buffer: req.file.buffer,
        fileName: req.file.originalname
      });
      certificateId = session.id;
      storedCertificate = getCertificate(certificateId);
    }

    if (!storedCertificate || !certificateId) {
      throw new CertificateError("Selecione um certificado A1 em formato .pfx ou .p12.");
    }

    const passphrase = req.body?.certificatePassphrase;
    if (typeof passphrase !== "string" || passphrase.length > 1024) {
      throw new CertificateError("Informe uma senha de certificado valida.");
    }

    const identity = inspectCertificate({
      pfx: storedCertificate.buffer,
      passphrase
    });

    return res.json({
      certificateId,
      fileName: storedCertificate.fileName,
      cnpj: identity.cnpj,
      formattedCnpj: formatCnpj(identity.cnpj),
      commonName: identity.commonName,
      state: identity.state,
      validTo: identity.validTo
    });
  } catch (error) {
    return res.status(getErrorStatus(error)).json({
      error: error.message || "Nao foi possivel validar o certificado."
    });
  }
});

app.post("/api/certificate/discard", (req, res) => {
  discardCertificate(req.body?.certificateId);
  return res.status(204).end();
});

app.post("/api/process", async (req, res) => {
  const { rawKeys } = req.body ?? {};

  if (typeof rawKeys !== "string" || !rawKeys.trim()) {
    return res.status(400).json({
      error: "Informe ao menos uma chave de acesso."
    });
  }

  const keys = extractAccessKeys(rawKeys);

  if (keys.length === 0) {
    return res.status(400).json({
      error: "Nenhuma chave valida de 44 digitos foi encontrada."
    });
  }

  let certificate = null;

  try {
    certificate = getCertificateRequestData(req);
    await fs.mkdir(downloadsDir, { recursive: true });
    await processCandidateBatch({
      res,
      organization: certificate ? getCertificateOrganization(certificate) : normalizeOrganization(req.body?.organization),
      candidates: keys.map((key) => ({
        key,
        sourceType: "manual",
        status: "pending"
      })),
      processor: certificate ? buildCertificateProcessor(certificate) : processAccessKeys
    });
    return res.end();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(getErrorStatus(error)).json({
        error: error.message || "Falha ao processar as chaves."
      });
    }

    writeStreamEvent(res, {
      type: "error",
      error: error.message || "Falha ao processar as chaves."
    });
    return res.end();
  } finally {
    if (certificate?.id && !shouldKeepCertificate(req)) {
      discardCertificate(certificate.id);
    }
  }
});

app.post("/api/process-distnsu", async (req, res) => {
  const candidates = createCandidatesFromItems(req.body?.items);

  if (candidates.length === 0) {
    return res.status(400).json({
      error: "Nenhuma chave elegivel foi recebida para a distribuicao NSU."
    });
  }

  let certificate = null;

  try {
    certificate = getCertificateRequestData(req);
    if (!certificate) {
      throw new CertificateError("Selecione um certificado para usar a distribuicao NSU.");
    }

    await fs.mkdir(downloadsDir, { recursive: true });
    await processCandidateBatch({
      res,
      organization: certificate ? getCertificateOrganization(certificate) : normalizeOrganization(req.body?.organization),
      candidates,
      processor: buildNsuProcessor(certificate)
    });
    return res.end();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(getErrorStatus(error)).json({
        error: error.message || "Falha ao consultar a distribuicao NSU."
      });
    }

    writeStreamEvent(res, {
      type: "error",
      error: error.message || "Falha ao consultar a distribuicao NSU."
    });
    return res.end();
  } finally {
    if (certificate?.id) {
      discardCertificate(certificate.id);
    }
  }
});

app.post("/api/process-items", async (req, res) => {
  const candidates = createCandidatesFromItems(req.body?.items);

  if (candidates.length === 0) {
    return res.status(400).json({
      error: "Nenhuma chave elegivel foi recebida para a consulta sem certificado."
    });
  }

  try {
    await fs.mkdir(downloadsDir, { recursive: true });
    await processCandidateBatch({
      res,
      organization: normalizeOrganization(req.body?.organization),
      candidates,
      processor: buildProcessorWithDownloadMethod(processAccessKeys, "without-certificate-api")
    });
    return res.end();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({
        error: error.message || "Falha ao consultar as chaves sem certificado."
      });
    }

    writeStreamEvent(res, {
      type: "error",
      error: error.message || "Falha ao consultar as chaves sem certificado."
    });
    return res.end();
  }
});

app.post("/api/process-pdfs", pdfUpload.array("pdfs", 20), async (req, res) => {
  const files = req.files ?? [];

  if (files.length === 0) {
    return res.status(400).json({
      error: "Envie ao menos um PDF."
    });
  }

  let certificate = null;

  try {
    certificate = getCertificateRequestData(req);
    await fs.mkdir(downloadsDir, { recursive: true });

    const candidates = await extractCandidatesFromPdfFiles(files);
    await processCandidateBatch({
      res,
      organization: certificate ? getCertificateOrganization(certificate) : normalizeOrganization(req.body?.organization),
      candidates,
      processor: certificate ? buildCertificateProcessor(certificate) : processAccessKeys
    });
    return res.end();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(getErrorStatus(error)).json({
        error: error.message || "Falha ao processar os PDFs."
      });
    }

    writeStreamEvent(res, {
      type: "error",
      error: error.message || "Falha ao processar os PDFs."
    });
    return res.end();
  } finally {
    if (certificate?.id && !shouldKeepCertificate(req)) {
      discardCertificate(certificate.id);
    }
  }
});

app.post(
  "/api/process-spreadsheets",
  spreadsheetUpload.array("spreadsheets", 10),
  async (req, res) => {
    const files = req.files ?? [];

    if (files.length === 0) {
      return res.status(400).json({
        error: "Envie ao menos uma planilha."
      });
    }

    let certificate = null;

    try {
      certificate = getCertificateRequestData(req);
      await fs.mkdir(downloadsDir, { recursive: true });

      const candidates = await extractCandidatesFromSpreadsheetFiles(files);
      await processCandidateBatch({
        res,
        organization: certificate ? getCertificateOrganization(certificate) : normalizeOrganization(req.body?.organization),
        candidates,
        processor: certificate ? buildCertificateProcessor(certificate) : processAccessKeys
      });
      return res.end();
    } catch (error) {
      if (!res.headersSent) {
        return res.status(getErrorStatus(error)).json({
          error: error.message || "Falha ao processar as planilhas."
        });
      }

      writeStreamEvent(res, {
        type: "error",
        error: error.message || "Falha ao processar as planilhas."
      });
      return res.end();
    } finally {
      if (certificate?.id && !shouldKeepCertificate(req)) {
        discardCertificate(certificate.id);
      }
    }
  }
);

app.post("/api/process-fallback", async (req, res) => {
  const candidates = createCandidatesFromItems(req.body?.items);

  if (candidates.length === 0) {
    return res.status(400).json({
      error: "Nenhuma chave elegivel ao fallback foi recebida."
    });
  }

  try {
    await fs.mkdir(downloadsDir, { recursive: true });
    await processCandidateBatch({
      res,
      organization: normalizeOrganization(req.body?.organization),
      candidates,
      processor: buildProcessorWithDownloadMethod(
        processAccessKeysWithSiteFallback,
        "without-certificate-site"
      )
    });
    return res.end();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({
        error: error.message || "Falha ao executar o fallback automatico."
      });
    }

    writeStreamEvent(res, {
      type: "error",
      error: error.message || "Falha ao executar o fallback automatico."
    });
    return res.end();
  }
});

app.post("/api/certificate-fallback-report.xlsx", (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : [];

  if (rows.length === 0) {
    return res.status(400).json({
      error: "Nao ha notas para incluir no relatorio."
    });
  }

  const worksheet = XLSX.utils.json_to_sheet(
    rows.map((row) => ({
      Nota: String(row?.key || ""),
      "Competencia da chave": String(row?.issueMonth || "Nao identificada"),
      "Emissao no XML": String(row?.documentIssueDate || "XML nao obtido"),
      "Consulta SEFAZ": String(row?.sefazQuery || "Sem registro SEFAZ"),
      "Retorno SEFAZ": String(row?.sefazReason || ""),
      "Forma de download": String(row?.downloadMethod || "Nao baixada")
    }))
  );
  worksheet["!cols"] = [
    { wch: 48 },
    { wch: 25 },
    { wch: 30 },
    { wch: 52 },
    { wch: 65 },
    { wch: 42 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Resultado");
  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true
  });
  const fileName = `relatorio-consulta-certificado-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.xlsx`;

  res.status(200);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  return res.send(buffer);
});

app.post("/api/select-downloads-dir", async (_req, res) => {
  try {
    const selectedDir = await openDownloadsDirPicker(downloadsDir);

    if (!selectedDir) {
      return res.json({
        canceled: true,
        downloadsDir
      });
    }

    await updateDownloadsDir(selectedDir);

    return res.json({
      canceled: false,
      downloadsDir
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Falha ao selecionar a pasta."
    });
  }
});

app.post("/api/downloads-dir", async (req, res) => {
  try {
    const updatedDownloadsDir = await updateDownloadsDir(req.body?.downloadsDir);

    return res.json({
      downloadsDir: updatedDownloadsDir
    });
  } catch (error) {
    return res.status(400).json({
      error: error.message || "Falha ao atualizar a pasta."
    });
  }
});

app.get("/api/config", (_req, res) => {
  res.json({
    downloadsDir,
    lookupMode: "http-direct",
    concurrency: DEFAULT_CONCURRENT_LOOKUPS,
    fallbackMode: "site-automation"
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError || error) {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error:
          "Arquivo acima do limite. PDFs aceitam ate 10 MB por arquivo e planilhas aceitam ate 12 MB."
      });
    }

    return res.status(400).json({
      error: error.message || "Falha ao receber os arquivos."
    });
  }

  return res.status(500).json({
    error: "Erro inesperado no servidor."
  });
});

async function startServer() {
  await loadDownloadsDirSetting();

  return new Promise((resolve, reject) => {
    const server = app.listen(preferredPort, "127.0.0.1");

    server.on("listening", () => {
      const address = server.address();
      const activePort = typeof address === "object" && address ? address.port : preferredPort;
      console.log(`Servidor disponivel em http://localhost:${activePort}`);
      resolve(server);
    });

    server.on("error", (error) => {
      if (allowPortFallback && error?.code === "EADDRINUSE" && preferredPort !== 0) {
        console.warn(
          `Porta ${preferredPort} ocupada. Iniciando automaticamente em uma porta livre.`
        );

        const fallbackServer = app.listen(0, "127.0.0.1");

        fallbackServer.on("listening", () => {
          const address = fallbackServer.address();
          const activePort = typeof address === "object" && address ? address.port : preferredPort;
          console.log(`Servidor disponivel em http://localhost:${activePort}`);
          resolve(fallbackServer);
        });

        fallbackServer.on("error", reject);
        return;
      }

      reject(error);
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error.message || "Falha ao iniciar o servidor.");
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  loadDownloadsDirSetting,
  saveDownloadsDirSetting,
  updateDownloadsDir,
  downloadsDir
};
