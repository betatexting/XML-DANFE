const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { EventEmitter } = require("node:events");

test("transparent login switches to an opaque resizable query window and keeps the new window alive", async (t) => {
  const windows = [], handlers = new Map();
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.webContents = new EventEmitter(); this.messages = [];
      this.webContents.send = (...args) => this.messages.push(args);
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.session = { cookies: { get: async () => [{ name: require('../src/localAuth').COOKIE_NAME, value: 'test-token' }] } };
      windows.push(this);
    }
    getBounds() { return this.bounds || { width: this.options.width, height: this.options.height, x: 0, y: 0 }; }
    getMinimumSize() { return [this.options.minWidth, this.options.minHeight]; }
    setBounds(bounds) { this.bounds = bounds; }
    loadURL(url) { this.url = url; }
    isDestroyed() { return Boolean(this.destroyed); }
    isMaximized() { return false; }
    show() { this.shown = true; }
    isMinimized() { return false; }
    focus() { this.focused = true; }
    minimize() { this.minimized = true; }
    close() { this.destroy(); }
    destroy() { this.destroyed = true; this.emit("closed"); }
  }
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => new Promise(() => {});
  let cursor = { x: 500, y: 300 };
  const display = () => ({ workAreaSize: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } });
  let selectedFile = { canceled: true, filePaths: [] }, savedCertificate = null, certificateBuffer = null;
  const electron = { app, BrowserWindow: Window, dialog: { showOpenDialog: async () => selectedFile }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, safeStorage: {}, screen: { getPrimaryDisplay: display, getDisplayMatching: display, getCursorScreenPoint: () => cursor } };
  const serverStub = { app: { locals: { auth: { sessionForToken: (token) => token === 'test-token' ? {} : null }, companyCatalog: { create: async (_input, options) => { certificateBuffer = options.certificate?.pfx; savedCertificate = { fileName: options.certificate?.fileName, passphrase: options.certificate?.passphrase, pfx: certificateBuffer?.toString('base64') }; return { companyId: 'saved' }; } } } } };
  const source = path.resolve("src/electron-main.js");
  const realRequire = createRequire(source);
  const context = vm.createContext({ URL, Buffer, console, __dirname: path.dirname(source), process,
    require: (name) => name === "electron" ? electron : name === "../server" ? serverStub : realRequire(name) });
  vm.runInContext(fs.readFileSync(source, "utf8"), context);
  assert.equal(context.getWindowView('http://127.0.0.1:3000/planilhas-chaves'), 'keySheets');
  context.createMainWindow("http://127.0.0.1:3000/login");
  assert.equal(windows[0].options.transparent, true);
  assert.equal(windows[0].options.resizable, false);
  vm.runInContext("serverInstance = { address: () => ({ port: 3000 }) }", context);
  const resizeEvent = { sender: windows[0].webContents, senderFrame: { url: "http://127.0.0.1:3000/login" } };
  assert.equal(handlers.get("window:resize-start")(resizeEvent, "invalid"), false);
  assert.equal(handlers.get("window:resize-start")(resizeEvent, "se"), true);
  cursor = { x: 600, y: 350 };
  assert.equal(handlers.get("window:resize")(resizeEvent), true);
  assert.equal(windows[0].getBounds().width, 845);
  assert.equal(windows[0].getBounds().height, 510);
  handlers.get("window:resize-end")(resizeEvent);
  assert.equal(handlers.get("window:resize")(resizeEvent), false);
  assert.throws(() => handlers.get("window:resize-start")({ sender: {}, senderFrame: resizeEvent.senderFrame }, "se"), /autorizada/);
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };
  windows[0].webContents.emit("will-navigate", event, "https://untrusted.example/login");
  assert.equal(prevented, true);
  assert.equal(windows.length, 1);
  windows[0].webContents.emit("will-navigate", event, "http://127.0.0.1:3000/menu");
  assert.equal(windows.length, 2);
  assert.equal(windows[0].isDestroyed(), true);
  assert.equal(windows[1].options.transparent, true);
  assert.equal(windows[1].options.resizable, false);
  assert.equal(windows[1].options.width, 603);
  assert.equal(windows[1].options.height, 580);
  windows[1].emit("ready-to-show");
  assert.equal(windows[1].shown, true);
  assert.equal(windows[1].messages[0][0], "window:state-changed");
  windows[1].webContents.emit("will-navigate", event, "http://127.0.0.1:3000/notas-automaticas");
  assert.equal(windows.length, 3);
  assert.equal(windows[2].options.transparent, true);
  assert.equal(windows[2].options.width, 1052);
  assert.equal(windows[2].options.height, 589);
  windows[2].emit("ready-to-show");
  assert.equal(windows[2].messages.length, 1);
  windows[2].webContents.emit("will-navigate", event, "http://127.0.0.1:3000/consultas");
  assert.equal(windows[3].options.transparent, false);
  assert.equal(windows[3].options.resizable, true);
  windows[3].webContents.emit("will-navigate", event, "http://127.0.0.1:3000/login");
  assert.equal(windows[4].options.transparent, true);
  assert.equal(windows[4].options.width, 845, "returning restores the resized login dimensions");
  const mainEvent = { sender: windows[4].webContents, senderFrame: { url: 'http://127.0.0.1:3000/login' } };
  await handlers.get('company-window:open')(mainEvent);
  const registration = windows[5];
  assert.equal(registration.options.parent, undefined, 'registration is an independent non-modal window');
  assert.equal(registration.options.transparent, true);
  assert.ok(registration.url.endsWith('/cadastro-empresa'));
  await handlers.get('company-window:open')(mainEvent);
  assert.equal(windows.length, 6, 'reopening focuses the existing registration');
  assert.equal(registration.focused, true);
  const registrationEvent = { sender: registration.webContents, senderFrame: { url: registration.url } };
  await assert.rejects(handlers.get('company-certificate:select')(mainEvent));
  assert.equal((await handlers.get('company-certificate:select')(registrationEvent)).canceled, true);
  const temporary = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'certificate-picker-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const fixtures = require('./fixtures/company-certificate.json'), fixturePath = path.join(temporary, 'fixture.pfx');
  fs.writeFileSync(fixturePath, Buffer.from(fixtures.valid, 'base64'));
  selectedFile = { canceled: false, filePaths: [fixturePath] };
  const imported = await handlers.get('company-certificate:select')(registrationEvent);
  assert.equal(imported.fileName, 'fixture.pfx');
  assert.equal(Object.keys(imported).sort().join(','), 'fileName,token');
  const pendingBuffer = vm.runInContext('pendingCompanyCertificate.buffer', context);
  const stale = await handlers.get('company:create')(registrationEvent, { certificateToken: 'unknown' });
  assert.equal(stale.ok, false);
  assert.equal(savedCertificate, null);
  const saved = await handlers.get('company:create')(registrationEvent, { certificateToken: imported.token, certificatePassword: fixtures.password });
  assert.equal(saved.ok, true);
  assert.equal(savedCertificate.pfx, fixtures.valid);
  assert.equal(savedCertificate.passphrase, fixtures.password);
  assert.equal(pendingBuffer.every((byte) => byte === 0), true);
  assert.equal(certificateBuffer.every((byte) => byte === 0), true);
  assert.equal(vm.runInContext('pendingCompanyCertificate', context), null);
  assert.ok(windows[4].messages.some(([name]) => name === 'company:registered'));
  await handlers.get('company-certificate:select')(registrationEvent);
  const closingBuffer = vm.runInContext('pendingCompanyCertificate.buffer', context);
  assert.equal(handlers.get('window:resize-start')(registrationEvent, 'se'), true);
  cursor = { x: 650, y: 400 }; handlers.get('window:resize')(registrationEvent);
  assert.ok(registration.getBounds().width > registration.options.width);
  handlers.get('window:minimize')(registrationEvent);
  assert.equal(registration.minimized, true);
  assert.equal(windows[4].minimized, undefined);
  handlers.get('window:close')(registrationEvent);
  assert.equal(registration.isDestroyed(), true);
  assert.equal(closingBuffer.every((byte) => byte === 0), true);
  assert.equal(windows[4].isDestroyed(), false, 'closing registration preserves the main window');
  await handlers.get('company-window:open')(mainEvent);
  assert.equal(windows.length, 7);
  windows[4].destroy();
  assert.equal(windows[6].isDestroyed(), false, 'closing the main window does not destroy registration');
  await assert.rejects(handlers.get('company-window:open')({ sender: {}, senderFrame: mainEvent.senderFrame }));
});
