const path = require("node:path");
const { createLocalAuth, COOKIE_NAME } = require("../../src/localAuth");

async function authenticateTestApp(app, directory) {
  app.locals.auth = createLocalAuth({ filePath: path.join(directory, "test-user.json") });
  await app.locals.auth.setup("fixture", "fixture-password");
  const { token } = await app.locals.auth.login("fixture", "fixture-password");
  return `${COOKIE_NAME}=${token}`;
}

module.exports = { authenticateTestApp };
