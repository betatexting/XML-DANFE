const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const rootDir = path.join(__dirname, "..");
const packageJson = require(path.join(rootDir, "package.json"));
const builderCliPath = path.join(rootDir, "node_modules", "electron-builder", "cli.js");
const outputDir = path.join(rootDir, "dist-electron");
const localAppDataDir = path.join(rootDir, ".localappdata");
const roamingAppDataDir = path.join(rootDir, ".appdata");

function runElectronBuilder(artifactName) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        builderCliPath,
        "--win",
        "portable",
        "-c.directories.output=dist-electron",
        `-c.artifactName=${artifactName}`
      ],
      {
        cwd: rootDir,
        stdio: "inherit",
        env: {
          ...process.env,
          npm_config_cache: process.env.npm_config_cache || path.join(rootDir, ".npm-cache"),
          ELECTRON_CACHE: process.env.ELECTRON_CACHE || path.join(rootDir, ".electron-cache"),
          ELECTRON_BUILDER_CACHE:
            process.env.ELECTRON_BUILDER_CACHE || path.join(rootDir, ".electron-builder-cache"),
          LOCALAPPDATA: localAppDataDir,
          APPDATA: roamingAppDataDir
        }
      }
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`electron-builder encerrou com codigo ${code}.`));
    });
  });
}

async function buildDesktopExecutable() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(localAppDataDir, { recursive: true });
  await fs.mkdir(roamingAppDataDir, { recursive: true });

  const primaryArtifact = `consulta-danfe-${packageJson.version}.exe`;
  const fallbackArtifact = `consulta-danfe-${packageJson.version}-next.exe`;
  let builtArtifact = primaryArtifact;

  try {
    await runElectronBuilder(primaryArtifact);
  } catch (error) {
    const message = error?.message || String(error);

    if (!message.includes("code 1") && !message.includes("codigo 1")) {
      throw error;
    }

    builtArtifact = fallbackArtifact;
    console.warn(
      `Nao foi possivel gerar ${primaryArtifact} diretamente. Tentando ${fallbackArtifact}.`
    );
    await runElectronBuilder(fallbackArtifact);
  }

  console.log(`App desktop gerado em: ${path.join(outputDir, builtArtifact)}`);
  console.log(`Versao do app: ${packageJson.version}`);
}

buildDesktopExecutable().catch((error) => {
  console.error("Erro ao gerar o app desktop:", error.message || error);
  process.exit(1);
});
