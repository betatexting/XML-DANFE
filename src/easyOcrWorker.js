const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const scriptName = "easyocr_worker.py";
const packaged = process.resourcesPath && path.basename(path.dirname(__dirname)) === "app.asar";
const defaultWorkerPath = packaged
  ? path.join(process.resourcesPath, "easyocr", scriptName)
  : path.join(__dirname, scriptName);

class EasyOcrWorker {
  constructor({ workerPath = defaultWorkerPath, timeout = 30000, startupTimeout = 60000, idleTimeout = 1000, pythonCandidates } = {}) {
    this.workerPath = workerPath;
    this.timeout = timeout;
    this.startupTimeout = startupTimeout;
    this.idleTimeout = idleTimeout;
    this.pythonCandidates = pythonCandidates || [
      ...(process.env.EASYOCR_PYTHON ? [{ command: process.env.EASYOCR_PYTHON, args: [] }] : []),
      { command: "python", args: [] },
      { command: "py", args: ["-3"] }
    ];
    this.session = null;
    this.queue = Promise.resolve();
  }

  async start() {
    if (!this.session) this.session = this.openSession();
    const opening = this.session;
    try {
      const session = await opening;
      if (!session.stopped) return session;
      if (this.session === opening) this.session = null;
      return this.start();
    } catch (error) {
      if (this.session === opening) this.session = null;
      throw error;
    }
  }

  async openSession() {
    const errors = [];
    for (const candidate of this.pythonCandidates) {
      let session;
      try {
        session = this.spawnSession(candidate);
        await session.ready;
        this.scheduleIdleClose(session);
        return session;
      } catch (error) {
        errors.push(`${candidate.command}: ${error.message}`);
        await session?.closed;
      }
    }
    throw new Error(`Não foi possível inicializar o EasyOCR. ${errors.join(" | ")}`);
  }

  spawnSession(candidate) {
    const child = spawn(candidate.command, [...candidate.args, this.workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        OPENBLAS_NUM_THREADS: "1",
        OMP_NUM_THREADS: "1",
        MKL_NUM_THREADS: "1",
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONDONTWRITEBYTECODE: "1"
      }
    });
    const output = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    const session = { child, pending: null, sequence: 0, stopped: false };
    const { promise, resolve, reject } = Promise.withResolvers();
    session.ready = promise;
    let stderr = "";
    const startupTimer = setTimeout(() => fail(new Error("Tempo excedido ao inicializar o EasyOCR.")), this.startupTimeout);

    function fail(error) {
      clearTimeout(startupTimer);
      reject(error);
      session.pending?.reject(error);
      session.stop();
    }

    session.stop = () => {
      if (session.stopped) return;
      session.stopped = true;
      clearTimeout(session.idleTimer);
      output.close();
      child.kill();
    };

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4096); });
    child.on("error", fail);
    child.stdin.on("error", fail);
    session.closed = new Promise((resolveClose) => {
      child.once("close", (code) => {
        const detail = stderr.trim();
        fail(new Error(`Processo EasyOCR encerrado (${code ?? "sem código"}).${detail ? " " + detail : ""}`));
        resolveClose();
      });
    });
    output.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); }
      catch { return; }
      if (message?.type === "ready") {
        clearTimeout(startupTimer);
        if (message.success) resolve(session);
        else fail(new Error(message.error || "Falha ao carregar o modelo."));
      } else if (session.pending && message?.id === session.pending.id) {
        if (message.success && typeof message.text === "string") session.pending.resolve(message.text);
        else session.pending.reject(new Error(message.error || "Falha no reconhecimento da imagem."));
      }
    });
    return session;
  }

  scheduleIdleClose(session) {
    const opening = this.session;
    session.idleTimer = setTimeout(() => {
      if (this.session === opening) this.session = null;
      session.stop();
    }, this.idleTimeout);
  }

  readImage(imagePath) {
    const operation = this.queue.then(async () => {
      const absolutePath = path.resolve(imagePath);
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile() || stat.size === 0) throw new Error("Informe um arquivo de imagem válido.");
      if (stat.size > 20 * 1024 * 1024) throw new Error("Imagem acima do limite permitido de 20 MiB.");
      const session = await this.start();
      clearTimeout(session.idleTimer);
      let timer;
      try {
        return await new Promise((resolve, reject) => {
          const id = ++session.sequence;
          session.pending = { id, resolve, reject };
          timer = setTimeout(() => {
            session.stop();
            reject(new Error("Tempo excedido ao reconhecer a imagem."));
          }, this.timeout);
          session.child.stdin.write(JSON.stringify({ id, image: absolutePath }) + "\n", (error) => {
            if (error) {
              session.stop();
              reject(error);
            }
          });
        });
      } finally {
        clearTimeout(timer);
        session.pending = null;
        if (session.stopped) {
          this.session = null;
          await session.closed;
        }
        else this.scheduleIdleClose(session);
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  readCaptcha(imagePath) {
    return this.readImage(imagePath);
  }

  close() {
    const operation = this.queue.then(async () => {
      const opening = this.session;
      this.session = null;
      const session = await opening?.catch(() => null);
      if (session) {
        session.stop();
        await session.closed;
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

let sharedWorker;
function getEasyOcrWorker(options) {
  sharedWorker ||= new EasyOcrWorker(options);
  return sharedWorker;
}

async function readCaptcha(imagePath, options) {
  const text = await getEasyOcrWorker(options).readImage(imagePath);
  const normalized = text.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  if (!normalized) throw new Error("O EasyOCR não reconheceu texto na imagem.");
  return normalized;
}

async function closeEasyOcrWorker() {
  const worker = sharedWorker;
  sharedWorker = null;
  await worker?.close();
}

module.exports = { EasyOcrWorker, getEasyOcrWorker, readCaptcha, closeEasyOcrWorker };
