const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EasyOcrWorker } = require("../src/easyOcrWorker");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "easyocr-test-"));
  const script = path.join(root, "worker.js");
  const image = path.join(root, "imagem ação.png");
  const slow = path.join(root, "slow.png");
  await Promise.all([
    fs.writeFile(image, "fixture"),
    fs.writeFile(slow, "fixture"),
    fs.writeFile(script, `
      const path = require("node:path");
      const readline = require("node:readline");
      console.log(JSON.stringify({type: "ready", success: true}));
      readline.createInterface({input: process.stdin}).on("line", (line) => {
        const {id, image} = JSON.parse(line);
        if (path.basename(image) !== "slow.png") {
          console.log(JSON.stringify({id, success: true, text: path.basename(image)}));
        }
      });
    `)
  ]);
  const worker = new EasyOcrWorker({
    workerPath: script,
    pythonCandidates: [
      { command: process.execPath, args: ["-e", "process.exit(1)"] },
      { command: process.execPath, args: [] }
    ],
    timeout: 300,
    idleTimeout: 100
  });
  t.after(async () => {
    await worker.close();
    await Promise.all([script, image, slow].map((file) => fs.unlink(file)));
    await fs.rmdir(root);
  });
  return { worker, image, slow };
}

test("waits for readiness, tries another interpreter and preserves UTF-8 paths", async (t) => {
  const { worker, image } = await fixture(t);
  const expected = path.basename(image);
  assert.deepEqual(await Promise.all([worker.readImage(image), worker.readImage(image)]), [expected, expected]);
  const session = await worker.start();
  await session.closed;
  assert.equal(worker.session, null);
});

test("discards a timed-out worker and processes the next image", async (t) => {
  const { worker, image, slow } = await fixture(t);
  await assert.rejects(worker.readImage(slow), /Tempo excedido ao reconhecer/);
  assert.equal(await worker.readImage(image), path.basename(image));
  const session = await worker.start();
  await worker.close();
  assert.notEqual(session.child.signalCode ?? session.child.exitCode, null);
});
