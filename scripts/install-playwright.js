const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const cliPath = path.join(projectRoot, "node_modules", "playwright", "cli.js");
const browsersPath = path.join(projectRoot, ".playwright-browsers");

const result = spawnSync(process.execPath, [cliPath, "install", "chromium"], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browsersPath
  }
});

process.exit(result.status ?? 1);
