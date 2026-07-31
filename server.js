const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const { execFile } = require("child_process");
const multer = require("multer");
const { processAccessKeys } = require("./src/consultaDanfe");
const { extractAccessKeys } = require("./src/accessKeys");
const { extractCandidatesFromPdfFiles } = require("./src/pdfToXml");

const app = express();
const port = process.env.PORT || 3000;
const settingsFilePath = path.join(__dirname, ".downloads-dir.json");
const defaultDownloadsDir =
  process.env.DOWNLOADS_DIR ||
  path.join("C:\\Users\\Contas Contabilidade\\Desktop", "werasmim");
let downloadsDir = defaultDownloadsDir;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 20
  },
  fileFilter: (_req, file, callback) => {
    const isPdf =
      file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      callback(new Error("Envie apenas arquivos PDF."));
      return;
    }

    callback(null, true);
  }
});

function normalizeHeadlessValue(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value !== "false";
  }

  return true;
}

async function loadDownloadsDirSetting() {
  if (process.env.DOWNLOADS_DIR) {
    downloadsDir = process.env.DOWNLOADS_DIR;
    return;
  }

  try {
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

  await fs.writeFile(settingsFilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

app.post("/api/process", async (req, res) => {
  const { rawKeys, headless = true } = req.body ?? {};

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

  try {
    await fs.mkdir(downloadsDir, { recursive: true });
    startResultStream(res);
    writeStreamEvent(res, {
      type: "start",
      total: keys.length
    });

    const results = [];

    await processAccessKeys({
      keys,
      headless: normalizeHeadlessValue(headless),
      downloadsDir,
      onResult: async (result, meta) => {
        results.push(result);
        writeResultEvent(res, result, {
          completed: meta.index + 1,
          total: meta.total
        });
      }
    });

    writeStreamEvent(res, {
      type: "complete",
      results,
      total: keys.length
    });
    return res.end();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({
        error: error.message || "Falha ao processar as chaves."
      });
    }

    writeStreamEvent(res, {
      type: "error",
      error: error.message || "Falha ao processar as chaves."
    });
    return res.end();
  }
});

app.post("/api/process-pdfs", upload.array("pdfs", 20), async (req, res) => {
  const files = req.files ?? [];
  const headless = normalizeHeadlessValue(req.body?.headless);

  if (files.length === 0) {
    return res.status(400).json({
      error: "Envie ao menos um PDF."
    });
  }

  try {
    await fs.mkdir(downloadsDir, { recursive: true });

    const candidates = await extractCandidatesFromPdfFiles(files);
    const total = candidates.length;
    const results = [];
    const candidatesByKey = new Map();

    for (const candidate of candidates) {
      if (!candidate.key) {
        results.push(candidate);
        continue;
      }

      const groupedCandidates = candidatesByKey.get(candidate.key) ?? [];
      groupedCandidates.push(candidate);
      candidatesByKey.set(candidate.key, groupedCandidates);
    }

    startResultStream(res);
    writeStreamEvent(res, {
      type: "start",
      total
    });

    for (const result of results) {
      writeResultEvent(res, result, {
        completed: results.indexOf(result) + 1,
        total
      });
    }

    const keys = [...candidatesByKey.keys()];

    if (keys.length > 0) {
      await processAccessKeys({
        keys,
        headless,
        downloadsDir,
        onResult: async (downloadResult) => {
          const groupedCandidates = candidatesByKey.get(downloadResult.key) ?? [];

          if (groupedCandidates.length === 0) {
            const fallbackResult = {
              ...downloadResult
            };

            results.push(fallbackResult);
            writeResultEvent(res, fallbackResult, {
              completed: results.length,
              total
            });
            return;
          }

          for (const candidate of groupedCandidates) {
            const result = {
              ...downloadResult,
              sourceName: candidate.sourceName
            };

            results.push(result);
            writeResultEvent(res, result, {
              completed: results.length,
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
    return res.end();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({
        error: error.message || "Falha ao processar os PDFs."
      });
    }

    writeStreamEvent(res, {
      type: "error",
      error: error.message || "Falha ao processar os PDFs."
    });
    return res.end();
  }
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

    await fs.mkdir(selectedDir, { recursive: true });
    downloadsDir = selectedDir;
    await saveDownloadsDirSetting();

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

app.get("/api/config", (_req, res) => {
  res.json({
    downloadsDir
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "Cada PDF pode ter no maximo 10 MB."
      });
    }

    return res.status(400).json({
      error: error.message || "Falha ao receber os arquivos."
    });
  }

  if (error) {
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

  app.listen(port, () => {
    console.log(`Servidor disponivel em http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error(error.message || "Falha ao iniciar o servidor.");
  process.exit(1);
});
