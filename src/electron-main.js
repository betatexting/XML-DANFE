const path = require("path");
const fs = require("fs/promises");
const { app, BrowserWindow, dialog, ipcMain, shell, safeStorage, screen } = require("electron");
const { startServer, app: serverApp } = require("../server");
const { storeCertificate } = require("./certificateSession");
const { COOKIE_NAME } = require("./localAuth");
const { createRememberedLogin } = require("./rememberedLogin");
const { getUserDataDir } = require("./runtimePaths");
const { RESIZE_EDGES, resizeBounds } = require("./windowResize");
const { randomUUID } = require("crypto");
const { MAX_CERTIFICATE_BYTES } = require("./companyCertificate");
const rememberedLogin = createRememberedLogin({
  filePath: () => path.join(getUserDataDir(), "remembered-login.bin"),
  encryption: safeStorage
});

let mainWindow = null;
let companyWindow = null;
let pendingCompanyCertificate = null;
function clearPendingCompanyCertificate() {
  pendingCompanyCertificate?.buffer.fill(0);
  pendingCompanyCertificate = null;
}
async function assertCompanyWindow(event) {
  await assertAuthenticatedWindow(event);
  if (event.sender !== companyWindow?.webContents || new URL(event.senderFrame.url).pathname !== "/cadastro-empresa") throw new Error("Janela nao autorizada.");
}
let serverInstance = null;
let isQuitting = false;
let resizeSession = null;
const savedWindowBounds = new Map();

function assertTrustedWindow(event, loginOnly = false) {
  const window = [mainWindow, companyWindow].find((candidate) => candidate && !candidate.isDestroyed() && event.sender === candidate.webContents);
  if (!window || event.senderFrame?.parent || (loginOnly && window !== mainWindow)) throw new Error("Janela nao autorizada.");
  const current = new URL(event.senderFrame?.url || "about:blank");
  const port = serverInstance?.address()?.port;
  if (current.origin !== `http://127.0.0.1:${port}` || (loginOnly && !["/login", "/login.html"].includes(current.pathname))) throw new Error("Origem nao autorizada.");
  return window;
}

async function assertAuthenticatedWindow(event) {
  assertTrustedWindow(event);
  const cookies = await event.sender.session.cookies.get({ url: `http://127.0.0.1:${serverInstance.address().port}` });
  const token = cookies.find((cookie) => cookie.name === COOKIE_NAME)?.value;
  if (!serverApp.locals.auth.sessionForToken(token)) throw new Error("Entre no aplicativo para continuar.");
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

function getPreloadPath() {
  return path.join(__dirname, "electron-preload.js");
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("window:state-changed", {
    isMaximized: mainWindow.isMaximized()
  });
}

function isLoginPage(url) {
  return ["/", "/login", "/login.html"].includes(new URL(url).pathname);
}

function getWindowView(url) {
  if (isLoginPage(url)) return "login";
  if (["/notas-automaticas", "/automatic-notes.html"].includes(new URL(url).pathname)) return "automaticNotes";
  if (["/planilhas-chaves", "/key-sheets.html"].includes(new URL(url).pathname)) return "keySheets";
  return ["/menu", "/menu.html"].includes(new URL(url).pathname) ? "menu" : "consultas";
}

function createMainWindow(url) {
  const view = getWindowView(url);
  const transparentView = view !== "consultas";
  const [width, height, minWidth, minHeight] = {
    login: [745, 460, 360, 400],
    menu: [603, 580, 360, 400],
    automaticNotes: [1052, 589, 480, 400],
    keySheets: [1120, 760, 480, 440],
    consultas: [1440, 960, 760, 640]
  }[view];
  const work = (mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay()).workAreaSize;
  const savedBounds = savedWindowBounds.get(view);
  const window = new BrowserWindow({
    width: Math.min(savedBounds?.width || width, work.width),
    height: Math.min(savedBounds?.height || height, work.height),
    minWidth,
    minHeight,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    transparent: transparentView,
    resizable: !transparentView,
    backgroundColor: transparentView ? "#00000000" : "#070912",
    hasShadow: !transparentView,
    thickFrame: !transparentView,
    title: "Consulta DANFE",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow = window;
  resizeSession = null;

  window.once("ready-to-show", () => {
    if (window.isDestroyed()) return;
    window.show();
    sendWindowState();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    if (resizeSession?.window === window) resizeSession = null;
  });
  window.on("maximize", sendWindowState);
  window.on("unmaximize", sendWindowState);
  window.on("enter-full-screen", sendWindowState);
  window.on("leave-full-screen", sendWindowState);

  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });
  function switchWindow(targetUrl) {
    if (getWindowView(targetUrl) === view || mainWindow !== window || window.isDestroyed()) return;
    // Transparency is fixed at construction. Keep the query window opaque/resizable.
    // Both windows share the default Electron session and its authenticated cookie.
    savedWindowBounds.set(view, window.getNormalBounds?.() || window.getBounds());
    createMainWindow(targetUrl);
    window.destroy();
  }
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (new URL(targetUrl).origin !== new URL(url).origin) { event.preventDefault(); return; }
    if (getWindowView(targetUrl) !== view) { event.preventDefault(); switchWindow(targetUrl); }
  });
  window.webContents.on("did-navigate", (_event, targetUrl) => {
    if (new URL(targetUrl).origin === new URL(url).origin) switchWindow(targetUrl);
  });
  window.loadURL(url);
}

function createCompanyWindow() {
  if (companyWindow && !companyWindow.isDestroyed()) {
    if (companyWindow.isMinimized()) companyWindow.restore();
    companyWindow.focus(); return;
  }
  const work = screen.getPrimaryDisplay().workAreaSize;
  const window = new BrowserWindow({ width: Math.min(780, work.width), height: Math.min(690, work.height), minWidth: 400, minHeight: 440, show: false, frame: false, autoHideMenuBar: true, transparent: true, resizable: false, backgroundColor: "#00000000", hasShadow: false, thickFrame: false, title: "Cadastrar empresa · Consulta DANFE", webPreferences: { preload: getPreloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  companyWindow = window;
  window.once("ready-to-show", () => { if (!window.isDestroyed()) window.show(); });
  window.on("closed", () => { if (companyWindow === window) { companyWindow = null; clearPendingCompanyCertificate(); } if (resizeSession?.window === window) resizeSession = null; });
  const url = `http://127.0.0.1:${serverInstance.address().port}/cadastro-empresa`;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => { if (target !== url) event.preventDefault(); });
  window.loadURL(url);
}

async function ensureServerStarted() {
  if (serverInstance) {
    return serverInstance;
  }

  serverInstance = await startServer();
  return serverInstance;
}

async function startDesktopApp() {
  serverApp.locals.companyCredentialEncryption = safeStorage;
  const server = await ensureServerStarted();
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 3000;
  const url = `http://127.0.0.1:${port}/login`;

  console.log(`Abrindo janela desktop em ${url}`);
  createMainWindow(url);
}

if (gotSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  ipcMain.handle("login:restore", async (event) => {
    assertTrustedWindow(event, true);
    try { return { available: safeStorage.isEncryptionAvailable(), credentials: await rememberedLogin.read() }; }
    catch { return { available: safeStorage.isEncryptionAvailable(), credentials: null, warning: "Nao foi possivel recuperar o acesso salvo. Digite login e senha novamente." }; }
  });
  ipcMain.handle("company-window:open", async (event) => {
    await assertAuthenticatedWindow(event);
    if (event.sender !== mainWindow?.webContents) throw new Error("Janela nao autorizada.");
    createCompanyWindow(); return { ok: true };
  });
  ipcMain.handle("company:create", async (event, input) => {
    await assertCompanyWindow(event);
    try {
      let certificate;
      if (input?.certificateToken) {
        if (input.certificateToken !== pendingCompanyCertificate?.token) return { ok: false, error: "Selecione novamente o certificado digital." };
        certificate = { pfx: Buffer.from(pendingCompanyCertificate.buffer), fileName: pendingCompanyCertificate.fileName, passphrase: input.certificatePassword };
      }
      let result;
      try { result = await serverApp.locals.companyCatalog.create(input, { encryption: safeStorage, certificate }); }
      finally { certificate?.pfx.fill(0); }
      clearPendingCompanyCertificate();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("company:registered");
      return { ok: true, companyId: result.companyId };
    } catch (error) { return { ok: false, error: error.status ? error.message : "Nao foi possivel salvar o cadastro com a protecao de senhas do Windows. Tente novamente." }; }
  });
  ipcMain.handle("company-certificate:select", async (event) => {
    await assertCompanyWindow(event);
    const owner = companyWindow;
    const result = await dialog.showOpenDialog(owner, { title: "Importar certificado digital A1", properties: ["openFile"], filters: [{ name: "Certificado A1", extensions: ["pfx", "p12"] }] });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    try {
      const filename = result.filePaths[0], stat = await fs.stat(filename);
      if (!stat.isFile() || !stat.size || stat.size > MAX_CERTIFICATE_BYTES || ![".pfx", ".p12"].includes(path.extname(filename).toLowerCase())) return { error: "Selecione um arquivo .pfx ou .p12 de até 5 MB." };
      const buffer = await fs.readFile(filename);
      if (owner !== companyWindow || owner.isDestroyed()) { buffer.fill(0); return { canceled: true }; }
      clearPendingCompanyCertificate();
      pendingCompanyCertificate = { token: randomUUID(), fileName: path.basename(filename), buffer };
      return { token: pendingCompanyCertificate.token, fileName: pendingCompanyCertificate.fileName };
    } catch { return { error: "Não foi possível ler o certificado selecionado." }; }
  });
  ipcMain.handle("company-certificate:clear", async (event) => {
    await assertCompanyWindow(event); clearPendingCompanyCertificate(); return { ok: true };
  });
  ipcMain.handle("login:save", async (event, credentials) => {
    assertTrustedWindow(event, true);
    await assertAuthenticatedWindow(event);
    await rememberedLogin.save(credentials);
    return { ok: true };
  });
  ipcMain.handle("login:forget", async (event) => {
    assertTrustedWindow(event, true);
    await rememberedLogin.clear();
    return { ok: true };
  });

  ipcMain.handle("downloads-dir:select", async (event) => {
    await assertAuthenticatedWindow(event);
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: "Selecione a pasta para salvar os XMLs",
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return {
        canceled: true,
        filePath: ""
      };
    }

    return {
      canceled: false,
      filePath: result.filePaths[0]
    };
  });

  ipcMain.handle("certificate:select", async (event) => {
    await assertAuthenticatedWindow(event);
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: "Selecione o certificado digital A1",
      properties: ["openFile"],
      filters: [
        {
          name: "Certificados digitais A1",
          extensions: ["pfx", "p12"]
        }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return {
        canceled: true
      };
    }

    const filePath = result.filePaths[0];
    const buffer = await fs.readFile(filePath);
    const session = storeCertificate({
      buffer,
      fileName: path.basename(filePath)
    });

    return {
      canceled: false,
      certificateId: session.id,
      fileName: session.fileName,
      expiresAt: session.expiresAt
    };
  });

  ipcMain.handle("window:minimize", (event) => {
    assertTrustedWindow(event).minimize();
  });

  ipcMain.handle("window:resize-start", (event, edge) => {
    const window = assertTrustedWindow(event);
    if (!RESIZE_EDGES.has(edge) || window.isMaximized() || (window === mainWindow && getWindowView(event.senderFrame.url) === "consultas")) return false;
    const display = screen.getDisplayMatching(window.getBounds());
    resizeSession = {
      window,
      sender: event.sender,
      edge,
      cursor: screen.getCursorScreenPoint(),
      bounds: window.getBounds(),
      minimum: window.getMinimumSize(),
      work: display.workArea
    };
    return true;
  });
  ipcMain.handle("window:resize", (event) => {
    const window = assertTrustedWindow(event);
    if (!resizeSession || resizeSession.window !== window || resizeSession.sender !== event.sender) return false;
    window.setBounds(resizeBounds(resizeSession, screen.getCursorScreenPoint(), resizeSession.edge, resizeSession.minimum, resizeSession.work));
    return true;
  });
  ipcMain.handle("window:resize-end", (event) => {
    assertTrustedWindow(event);
    if (resizeSession?.sender === event.sender) resizeSession = null;
    return true;
  });

  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) {
      return {
        isMaximized: false
      };
    }

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }

    const state = {
      isMaximized: mainWindow.isMaximized()
    };
    sendWindowState();
    return state;
  });

  ipcMain.handle("window:close", (event) => {
    assertTrustedWindow(event).close();
  });

  ipcMain.handle("window:get-state", () => ({
    isMaximized: Boolean(mainWindow?.isMaximized())
  }));

  app.whenReady().then(startDesktopApp).catch((error) => {
    console.error(`Falha ao iniciar o app desktop: ${error.message}`);
    app.quit();
  });

  app.on("activate", async () => {
    if (mainWindow) {
      mainWindow.focus();
      return;
    }

    try {
      await startDesktopApp();
    } catch (error) {
      console.error(`Falha ao reabrir a janela principal: ${error.message}`);
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("quit", () => {
    if (!serverInstance || isQuitting === false) {
      return;
    }

    serverInstance.close();
  });
}
