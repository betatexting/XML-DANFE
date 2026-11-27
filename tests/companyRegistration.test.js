const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const express = require('express');
const { chromium } = require('playwright-core');
const { createCompanyCatalog, installCompanyRoutes } = require('../src/companyCatalog');
const { installAuth } = require('../src/authRoutes');
const certificateFixtures = require('./fixtures/company-certificate.json');
function encryption() {
  const key = randomBytes(32);
  return { isEncryptionAvailable: () => true, encryptString(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]);
  }, decryptString(buffer) {
    const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
    decipher.setAuthTag(buffer.subarray(12, 28));
    return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
  } };
}
const input = { legalName: 'Empresa cadastrada', code: '', documentType: 'cnpj', document: '14.078.646/0001-04', stateRegistration: '', portalLogin: 'acesso-portal-teste', portalPassword: 'senha-portal-teste' };
test('company registration requires fields, prevents duplicates and encrypts portal credentials without exposing them', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'company-registration-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'companies.json'), catalog = createCompanyCatalog({ filePath }), cipher = encryption();
  for (const field of ['legalName', 'document', 'portalLogin', 'portalPassword']) await assert.rejects(catalog.create({ ...input, [field]: '' }, { encryption: cipher }));
  await assert.rejects(catalog.create(input, { encryption: { isEncryptionAvailable: () => false } }));
  assert.deepEqual((await catalog.list()).companies, []);
  const result = await catalog.create(input, { encryption: cipher });
  assert.equal(result.selectedCompanyId, result.companyId);
  assert.equal(result.companies[0].cnpj, '14078646000104');
  const persisted = await fs.readFile(filePath, 'utf8');
  assert.doesNotMatch(persisted, /senha-portal-teste|acesso-portal-teste/);
  assert.doesNotMatch(JSON.stringify(result), /portalCredentials|portalPassword|portalLogin/);
  const secret = Buffer.from(JSON.parse(persisted).companies[0].portalCredentials, 'base64');
  assert.deepEqual(JSON.parse(cipher.decryptString(secret)), { login: input.portalLogin, password: input.portalPassword });
  assert.deepEqual(await createCompanyCatalog({ filePath }).loadPortalCredentials(result.companyId, { encryption: cipher }), { login: input.portalLogin, password: input.portalPassword });
  await assert.rejects(catalog.loadPortalCredentials(result.companyId, { encryption: { isEncryptionAvailable: () => false } }), { code: 'credentials_unavailable' });
  await assert.rejects(catalog.create(input, { encryption: cipher }), (error) => error.status === 409);
  for (const [documentType, document] of [['cnpj', '14078646000105'], ['cpf', '52998224724'], ['cei', '800000001303'], ['caepf', '00000002500172']]) {
    await assert.rejects(catalog.create({ ...input, documentType, document }, { encryption: cipher }), (error) => error.status === 400 && /verificadores/.test(error.message));
  }
  assert.equal((await catalog.list()).companies.length, 1);
  for (const [documentType, document] of [['cpf', '52998224725'], ['cei', '800000001302'], ['caepf', '00000002500171']]) {
    const created = await catalog.create({ ...input, documentType, document }, { encryption: cipher });
    assert.equal(created.companies.at(-1).documentType, documentType);
    assert.equal(created.companies.at(-1).cnpj, undefined);
  }
  assert.equal((await createCompanyCatalog({ filePath }).list()).companies.length, 4);
});

test('company certificate persists encrypted across catalog instances and rejects invalid PFX, password and dates', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'company-certificate-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'companies.json'), catalog = createCompanyCatalog({ filePath }), cipher = encryption();
  const certificate = { pfx: Buffer.from(certificateFixtures.valid, 'base64'), passphrase: certificateFixtures.password, fileName: 'fixture.pfx' };
  for (const invalid of [
    { ...certificate, passphrase: 'incorrect-password' },
    { ...certificate, pfx: Buffer.from('invalid') },
    ...['expired', 'future', 'withoutKey'].map((key) => ({ ...certificate, pfx: Buffer.from(certificateFixtures[key], 'base64') })),
    { ...certificate, fileName: 'wrong.txt' },
    { ...certificate, pfx: Buffer.alloc(5 * 1024 * 1024 + 1) }
  ]) await assert.rejects(catalog.create(input, { encryption: cipher, certificate: invalid }), (error) => error.status === 400);
  assert.deepEqual((await catalog.list()).companies, []);
  const result = await catalog.create(input, { encryption: cipher, certificate });
  const raw = await fs.readFile(filePath, 'utf8');
  assert.ok(!raw.includes(certificateFixtures.valid));
  assert.ok(!raw.includes(certificateFixtures.password));
  assert.doesNotMatch(JSON.stringify(result), /encryptedPayload|passphrase|portalCredentials/);
  assert.equal(result.companies[0].certificate.fileName, 'fixture.pfx');
  const restored = await createCompanyCatalog({ filePath }).loadCertificate(result.companyId, { encryption: cipher });
  assert.deepEqual(restored.pfx, certificate.pfx);
  assert.equal(restored.passphrase, certificateFixtures.password);
  assert.equal(restored.cnpj, input.document.replace(/\D/g, ''));
  restored.pfx.fill(0);
  await assert.rejects(catalog.loadCertificate(result.companyId, { encryption: { isEncryptionAvailable: () => false } }));
});

test('registration form opens separately, validates, saves and adapts to small windows', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'registration-ui-'));
  const app = express(); app.use(express.json());
  const cookie = await require('./helpers/auth').authenticateTestApp(app, directory);
  installAuth(app); app.locals.companyCatalog = createCompanyCatalog({ filePath: path.join(directory, 'companies.json') }); installCompanyRoutes(app);
  app.use(express.static(path.resolve('public')));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const browser = await chromium.launch({ executablePath: path.resolve('.playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'), headless: true });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const base = `http://127.0.0.1:${server.address().port}`, context = await browser.newContext({ viewport: { width: 780, height: 690 } });
  await context.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: base }]);
  const page = await context.newPage(); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.exposeFunction('saveCompanyFixture', async (data) => {
    try { const result = await app.locals.companyCatalog.create(data, { encryption: encryption(), certificate: data.certificateToken ? { pfx: Buffer.from(certificateFixtures.valid, 'base64'), passphrase: data.certificatePassword, fileName: 'fixture.pfx' } : undefined }); return { ok: true, companyId: result.companyId }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  await page.addInitScript(() => { window.consultaDanfeDesktop = {
    isDesktop: true, createCompany: (data) => window.saveCompanyFixture(data), closeWindow: () => window.close(), minimizeWindow() {},
    async selectCompanyCertificate() { window.selections = (window.selections || 0) + 1; return window.selections === 1 ? { canceled: true } : { token: 'fixture-token', fileName: 'fixture.pfx' }; },
    async clearCompanyCertificate() { window.clears = (window.clears || 0) + 1; return { ok: true }; }
  }; });
  await page.goto(base + '/cadastro-empresa');
  assert.equal(await page.locator('#companyPortalPassword').getAttribute('type'), 'password');
  assert.equal(await page.locator('input[required]').count(), 4);
  await page.locator('#registrationSave').click();
  assert.equal((await app.locals.companyCatalog.list()).companies.length, 0);
  await page.locator('#companyLegalName').fill(input.legalName);
  await page.locator('#companyDocument').fill('14.078.646/0001-05');
  await page.locator('#companyPortalLogin').fill(input.portalLogin);
  await page.locator('#companyPortalPassword').fill(input.portalPassword);
  assert.match(await page.locator('#documentValidationMessage').textContent(), /CNPJ inválido/);
  await page.locator('#registrationSave').click();
  assert.equal((await app.locals.companyCatalog.list()).companies.length, 0);
  await page.locator('#companyDocument').fill(input.document);
  await page.locator('#companyDocument').blur();
  assert.equal(await page.locator('#documentValidationMessage').textContent(), '');
  await page.locator('#companyDocumentType').selectOption('cpf');
  assert.match(await page.locator('#documentValidationMessage').textContent(), /CPF/);
  await page.locator('#companyDocumentType').selectOption('cnpj');
  await page.locator('#registrationImportCertificate').click();
  assert.equal(await page.locator('#companyCertificatePassword').isDisabled(), true);
  await page.locator('#registrationImportCertificate').click();
  await page.waitForFunction(() => !document.querySelector('#companyCertificatePassword').disabled);
  assert.match(await page.locator('#registrationCertificateFile').textContent(), /fixture.pfx/);
  assert.equal(await page.locator('#companyCertificatePassword').getAttribute('type'), 'password');
  await page.locator('#companyCertificatePassword').fill('incorrect-password');
  await page.locator('#registrationSave').click();
  await page.waitForFunction(() => document.querySelector('#registrationMessage').textContent.includes('Verifique a senha'));
  assert.equal((await app.locals.companyCatalog.list()).companies.length, 0);
  await page.locator('#registrationRemoveCertificate').click();
  assert.equal(await page.locator('#companyCertificatePassword').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.clears), 1);
  await page.locator('#registrationImportCertificate').click();
  await page.locator('#companyCertificatePassword').fill(certificateFixtures.password);
  const artifacts = path.resolve('tmp-company-registration'); await fs.mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, 'registration.png'), omitBackground: true });
  await page.locator('#registrationSave').click();
  await page.waitForFunction(() => document.querySelector('#registrationMessage').textContent.includes('sucesso'));
  assert.equal((await app.locals.companyCatalog.list()).companies.length, 1);
  assert.equal(await page.locator('#companyPortalPassword').inputValue(), '');
  assert.equal(await page.locator('#companyCertificatePassword').inputValue(), '');
  assert.equal(await page.locator('#companyCertificatePassword').isDisabled(), true);
  assert.equal((await app.locals.companyCatalog.list()).companies[0].certificate.fileName, 'fixture.pfx');
  await page.setViewportSize({ width: 400, height: 440 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#registrationSave').scrollIntoViewIfNeeded();
  const button = await page.locator('#registrationSave').boundingBox();
  assert.ok(button.y >= 0 && button.y + button.height <= 440);
  await page.screenshot({ path: path.join(artifacts, 'registration-small.png'), omitBackground: true });
  assert.deepEqual(errors, []);
});
