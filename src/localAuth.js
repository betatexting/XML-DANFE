const fs = require("fs/promises");
const path = require("path");
const { randomBytes, scrypt, timingSafeEqual, createHash } = require("crypto");
const { promisify } = require("util");
const { getUserDataDir } = require("./runtimePaths");
const derive = promisify(scrypt);
const COOKIE_NAME = "consulta_session";
const SESSION_MS = 8 * 60 * 60 * 1000;

function authError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function createLocalAuth({ filePath, now = Date.now } = {}) {
  const sessions = new Map();
  let setupQueue = Promise.resolve();
  let failures = [];
  const tokenHash = (value) => createHash("sha256").update(value).digest("hex");
  async function location() {
    return filePath || path.join(getUserDataDir(), "local-user.json");
  }
  async function readUser() {
    try {
      const record = JSON.parse(await fs.readFile(await location(), "utf8"));
      if (!record.username || !/^[a-f0-9]{32}$/.test(record.salt) || !/^[a-f0-9]{128}$/.test(record.passwordHash)) {
        throw new Error("Cadastro local invalido. Restaure o cadastro a partir de um backup.");
      }
      return record;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  function cookieToken(req) {
    const part = String(req.headers.cookie || "").split(";").map((s) => s.trim()).find((s) => s.startsWith(COOKIE_NAME + "="));
    return part?.slice(COOKIE_NAME.length + 1) || "";
  }
  function sessionForToken(token) {
    if (!/^[a-f0-9]{64}$/.test(token || "")) return null;
    const hash = tokenHash(token);
    const session = sessions.get(hash);
    if (!session || session.expiresAt <= now()) { sessions.delete(hash); return null; }
    return { username: session.username };
  }
  function createSession(username) {
    for (const [hash, session] of sessions) if (session.expiresAt <= now()) sessions.delete(hash);
    const token = randomBytes(32).toString("hex");
    sessions.set(tokenHash(token), { username, expiresAt: now() + SESSION_MS });
    return token;
  }
  async function setup(username, password) {
    const run = setupQueue.then(async () => {
      if (await readUser()) throw authError("O acesso local ja foi cadastrado.", 409);
      username = String(username || "").normalize("NFKC").trim();
      if (!/^[\p{L}\p{N}._@ -]{1,64}$/u.test(username)) throw authError("Informe um login valido, com ate 64 caracteres.");
      if (typeof password !== "string" || password.length < 8 || password.length > 256) throw authError("A senha deve ter entre 8 e 256 caracteres.");
      const salt = randomBytes(16).toString("hex");
      const passwordHash = (await derive(password, salt, 64)).toString("hex");
      const file = await location();
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ version: 1, username, salt, passwordHash }), { flag: "wx", mode: 0o600 });
      return { username };
    });
    setupQueue = run.catch(() => {});
    return run;
  }
  async function login(username, password) {
    failures = failures.filter((at) => at > now() - 15 * 60 * 1000);
    if (failures.length >= 8) throw authError("Muitas tentativas. Aguarde 15 minutos para tentar novamente.", 429);
    const user = await readUser();
    if (!user) throw authError("Cadastre o acesso local antes de entrar.", 409);
    if (typeof username !== "string" || typeof password !== "string" || password.length > 256) throw authError("Login ou senha incorretos.", 401);
    // Reserve before awaiting the derivation so concurrent failures also count.
    const reservation = now();
    failures.push(reservation);
    const expected = Buffer.from(user.passwordHash, "hex");
    const actual = await derive(password, user.salt, expected.length);
    if (!timingSafeEqual(actual, expected) || username.normalize("NFKC").trim().toLocaleLowerCase("pt-BR") !== user.username.toLocaleLowerCase("pt-BR")) {
      throw authError("Login ou senha incorretos.", 401);
    }
    failures = [];
    return { username: user.username, token: createSession(user.username) };
  }
  return {
    setup, login, createSession, sessionForToken,
    isConfigured: async () => Boolean(await readUser()),
    sessionForRequest: (req) => sessionForToken(cookieToken(req)),
    logout: (req) => sessions.delete(tokenHash(cookieToken(req)))
  };
}

const localAuth = createLocalAuth();
module.exports = { createLocalAuth, localAuth, COOKIE_NAME };
