const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { reorganizeXml, classifyXml } = require('../src/reorganizeXml');
const cnpj = '11111111000111';
const xml = (emit, dest, date = '2025-03-12') => `<NFe><infNFe><ide><dEmi>${date}</dEmi></ide><emit><CNPJ>${emit}</CNPJ></emit><dest><CNPJ>${dest}</CNPJ></dest></infNFe></NFe>`;
test('moves nested XMLs by issue year and company role, preserves conflicts and invalid files, supports reruns', async (t) => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reorganize-'));
 t.after(() => fs.rm(dir, {recursive:true, force:true}));
 await fs.mkdir(path.join(dir, 'old'));
 const incoming = xml('22222222000122', cnpj);
 const outgoing = xml(cnpj, '22222222000122', '2026-01-01');
 await fs.writeFile(path.join(dir, 'old', 'entrada.XML'), incoming);
 await fs.writeFile(path.join(dir, 'saida.xml'), outgoing);
 await fs.writeFile(path.join(dir, 'broken.xml'), '<NFe>');
 await fs.writeFile(path.join(dir, 'other.xml'), xml('22222222000122', '33333333000133'));
 await fs.mkdir(path.join(dir, '2026-01', 'saidas'), {recursive:true});
 await fs.writeFile(path.join(dir, '2026-01', 'saidas', 'saida.xml'), 'existing');
 const result = await reorganizeXml({directory:dir, cnpj});
 assert.equal(result.moved, 2);
 assert.equal(result.skipped, 3);
 assert.equal(await fs.readFile(path.join(dir, '2025-03', 'entradas', 'entrada.XML'), 'utf8'), incoming);
 await assert.rejects(fs.stat(path.join(dir, 'old', 'entrada.XML')), {code:'ENOENT'});
 await assert.rejects(fs.stat(path.join(dir, 'saida.xml')), {code:'ENOENT'});
 assert.equal(result.versions, 1);
 assert.equal(await fs.readFile(path.join(dir, '2026-01', 'saidas', 'saida.xml'), 'utf8'), 'existing');
 const again = await reorganizeXml({directory:dir, cnpj});
 assert.equal(again.moved, 0);
 assert.equal(again.unchanged, 2);
});
test('validates XML and dates and supports namespaces', () => {
 assert.throws(() => classifyXml(xml(cnpj, '', '2025-02-30'), cnpj));
 assert.throws(() => classifyXml('<!DOCTYPE NFe>'+xml(cnpj, ''), cnpj));
 assert.deepEqual(classifyXml(xml(cnpj, '').replace('<NFe>', '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">'), cnpj), {period:'2025-03', type:'saidas', key:''});
});

test('migrates old annual folders and checks duplicates across names and access keys', async (t) => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reorganize-duplicates-'));
 t.after(() => fs.rm(dir, {recursive:true, force:true}));
 await fs.mkdir(path.join(dir, '2025', 'entradas'), {recursive:true});
 await fs.mkdir(path.join(dir, '2025-03', 'entradas'), {recursive:true});
 const data = xml('22222222000122', cnpj);
 await fs.writeFile(path.join(dir, '2025-03', 'entradas', 'canonical.xml'), data);
 await fs.writeFile(path.join(dir, '2025', 'entradas', 'copy.xml'), data);
 const key = '35260444823938000187551090000002691092067649';
 const keyed = xml(cnpj, '22222222000122', '2025-07-01').replace('<infNFe>', `<infNFe Id="NFe${key}">`);
 await fs.writeFile(path.join(dir, '2025', 'a.xml'), keyed);
 await fs.writeFile(path.join(dir, '2025', 'b.xml'), keyed.replace('</infNFe>', '<extra>different</extra></infNFe>'));
 const result = await reorganizeXml({directory:dir, cnpj});
 assert.equal(result.moved, 2);
 assert.equal(result.duplicates, 1);
 assert.equal(result.conflicts, 0);
 assert.equal(result.versions, 1);
 assert.equal(result.unchanged, 1);
 assert.equal(await fs.readFile(path.join(dir, '2025-07', 'saidas', 'a.xml'), 'utf8'), keyed);
 assert.equal(await fs.readFile(path.join(dir, '2025', 'entradas', 'copy.xml'), 'utf8'), data);
});

test('reports denied deletion and preserves both verified copy and original', async (t) => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reorganize-permission-'));
 t.after(() => fs.rm(dir, {recursive:true, force:true}));
 const data = xml(cnpj, '22222222000122');
 const source = path.join(dir, 'source.xml');
 await fs.writeFile(source, data);
 t.mock.method(fs, 'unlink', async () => { throw Object.assign(new Error('denied'), {code:'EPERM'}); });
 const result = await reorganizeXml({directory:dir, cnpj});
 assert.equal(result.moved, 0);
 assert.equal(result.results[0].code, 'EPERM');
 assert.match(result.results[0].message, /Sem permissao/);
 assert.equal(await fs.readFile(source, 'utf8'), data);
 assert.equal(await fs.readFile(path.join(dir, '2025-03', 'saidas', 'source.xml'), 'utf8'), data);
});

test('reuses company month folders with accented types and moves unescaped ampersands byte for byte', async (t) => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reorganize-existing-'));
 t.after(() => fs.rm(dir, {recursive:true, force:true}));
 const destination = path.join(dir, '11.111.1110001-11', '2025-03', 'Sa\u00eddas');
 await fs.mkdir(destination, {recursive:true});
 const source = path.join(dir, '2025', 'saidas', 'original.xml');
 await fs.mkdir(path.dirname(source), {recursive:true});
 const data = xml(cnpj, '22222222000122').replace('</infNFe>', '<infAdic><infCpl>A & B</infCpl></infAdic></infNFe>');
 await fs.writeFile(source, data);
 const originalMkdir = fs.mkdir.bind(fs);
 let mkdirCalls = 0;
 t.mock.method(fs, 'mkdir', async (...args) => { mkdirCalls++; return originalMkdir(...args); });
 const result = await reorganizeXml({directory:dir, cnpj});
 assert.equal(result.moved, 1);
 assert.equal(result.warnings, 1);
 assert.equal(mkdirCalls, 0);
 assert.equal(await fs.readFile(path.join(destination, 'original.xml'), 'utf8'), data);
 await assert.rejects(fs.stat(source), {code:'ENOENT'});
 assert.equal((await reorganizeXml({directory:dir, cnpj})).unchanged, 1);
});

test('keeps malformed XML and refuses ambiguous destinations', async (t) => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reorganize-ambiguous-'));
 t.after(() => fs.rm(dir, {recursive:true, force:true}));
 for (const part of ['a','b']) await fs.mkdir(path.join(dir, part, '2025-03', 'entradas'), {recursive:true});
 await fs.writeFile(path.join(dir, 'note.xml'), xml('22222222000122', cnpj));
 await fs.writeFile(path.join(dir, 'broken.xml'), xml(cnpj, '').replace('</infNFe>', '<broken>A & B</wrong></infNFe>'));
 const result = await reorganizeXml({directory:dir, cnpj});
 assert.equal(result.moved, 0);
 assert.equal(result.skipped, 2);
 assert.ok(result.results.some(item => /ambiguo/.test(item.message)));
 assert.ok(await fs.stat(path.join(dir, 'note.xml')));
});
