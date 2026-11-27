const express = require("express");
const path = require("path");
const { COOKIE_NAME } = require("./localAuth");
const PUBLIC_ASSETS = new Set(["/login", "/login.html", "/login.css", "/login.js", "/window-ui.css", "/window-ui.js", "/favicon.ico"]);

function installAuth(app) {
  const router = express.Router();
  // The application listens on loopback. Reject other hosts and cross-origin writes.
  app.use((req, res, next) => {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(req.hostname)) return res.status(403).json({ error: "Origem nao permitida." });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("origin")) {
      try {
        const origin = new URL(req.get("origin"));
        if (origin.protocol !== "http:" || origin.host !== req.get("host")) return res.status(403).json({ error: "Origem nao permitida." });
      }
      catch { return res.status(403).json({ error: "Origem nao permitida." }); }
    }
    next();
  });
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.get("/status", async (req, res, next) => {
    try { res.json({ configured: await app.locals.auth.isConfigured(), user: app.locals.auth.sessionForRequest(req) }); }
    catch (error) { next(error); }
  });
  function credentialsRoute(action) {
    return async (req, res) => {
      try {
        if (!req.is("application/json")) return res.status(415).json({ error: "Envie os dados em JSON." });
        let user;
        if (action === "setup") {
          await app.locals.auth.setup(req.body.username, req.body.password);
        }
        user = await app.locals.auth.login(req.body.username, req.body.password);
        res.cookie(COOKIE_NAME, user.token, { httpOnly: true, sameSite: "strict", path: "/" });
        res.json({ user: { username: user.username } });
      } catch (error) {
        res.status(error.status || 500).json({ error: error.status ? error.message : "Nao foi possivel validar o acesso local." });
      }
    };
  }
  router.post("/setup", credentialsRoute("setup"));
  router.post("/login", credentialsRoute("login"));
  router.post("/logout", (req, res) => {
    app.locals.auth.logout(req);
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "strict", path: "/" });
    res.json({ ok: true });
  });
  app.use("/api/auth", router);
  app.get(["/login", "/login.html"], (_req, res) => {
    res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "../public/login.html"));
  });
  app.use((req, res, next) => {
    if (PUBLIC_ASSETS.has(req.path) || req.path === "/api/health") return next();
    req.user = app.locals.auth.sessionForRequest(req);
    if (!req.user) {
      if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Entre no aplicativo para continuar.", code: "authentication_required" });
      return res.redirect("/login");
    }
    res.set("Cache-Control", "no-store");
    if (req.path === "/") return res.redirect("/menu");
    next();
  });
  app.get("/consultas", (_req, res) => res.sendFile(path.join(__dirname, "../public/index.html")));
  app.get("/menu", (_req, res) => res.sendFile(path.join(__dirname, "../public/menu.html")));
  app.get("/notas-automaticas", (_req, res) => res.sendFile(path.join(__dirname, "../public/automatic-notes.html")));
  app.get("/cadastro-empresa", (_req, res) => res.sendFile(path.join(__dirname, "../public/company-registration.html")));
  app.get("/planilhas-chaves", (_req, res) => res.sendFile(path.join(__dirname, "../public/key-sheets.html")));
}

module.exports = { installAuth };
