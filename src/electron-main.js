const path = require("path");
const fs = require("fs/promises");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { startServer } = require("../server");
const { storeCertificate } = require("./certificateSession");

let mainWindow = null;
let serverInstance = null;
let isQuitting = false;

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

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 760,
    minHeight: 640,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#070912",
    thickFrame: true,
    title: "Consulta DANFE",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    sendWindowState();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("maximize", sendWindowState);
  mainWindow.on("unmaximize", sendWindowState);
  mainWindow.on("enter-full-screen", sendWindowState);
  mainWindow.on("leave-full-screen", sendWindowState);

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.loadURL(url);
}

async function ensureServerStarted() {
  if (serverInstance) {
    return serverInstance;
  }

  serverInstance = await startServer();
  return serverInstance;
}

async function startDesktopApp() {
  const server = await ensureServerStarted();
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 3000;
  const url = `http://127.0.0.1:${port}`;

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

  ipcMain.handle("downloads-dir:select", async () => {
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

  ipcMain.handle("certificate:select", async () => {
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

  ipcMain.handle("window:minimize", () => {
    if (mainWindow) {
      mainWindow.minimize();
    }
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

  ipcMain.handle("window:close", () => {
    if (mainWindow) {
      mainWindow.close();
    }
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
