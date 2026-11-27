const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDocument, validateDocument } = require('../public/document-validation');

// Fixed reference vectors: RFB's alphanumeric example, SERPRO's CAEPF/CEI
// example and numeric documents. None of these tests checks registry existence.
const valid = {
  cnpj: ['14.078.646/0001-04', '14.078.646/0003-68', '14.078.646/0004-49', '00.000.000/0001-91', '12.ABC.345/01DE-35', '12.abc.345/01de-35'],
  cpf: ['529.982.247-25', '111.444.777-35', '00000002569'],
  cei: ['800000001302'],
  caepf: ['000.000.025/001-71', '293.118.610/001-84', '00000001100102', '00000002200110']
};
test('document check digits accept numeric and alphanumeric reference examples with formatting', () => {
  for (const [type, values] of Object.entries(valid)) for (const value of values) {
    assert.equal(validateDocument(type, value).valid, true, `${type}: ${value}`);
    assert.equal(validateDocument(type, `  ${value}  `).valid, true);
  }
  assert.equal(normalizeDocument('12.abc.345/01de-35'), '12ABC34501DE35');
});
test('a wrong check digit is rejected for each document type', () => {
  for (const [type, values] of Object.entries(valid)) for (const value of values) {
    const number = normalizeDocument(value), digits = type === 'cei' ? 1 : 2;
    for (let index = number.length - digits; index < number.length; index++) {
      for (let digit = 0; digit <= 9; digit++) {
        if (digit === Number(number[index])) continue;
        const changed = number.slice(0, index) + digit + number.slice(index + 1);
        assert.equal(validateDocument(type, changed).valid, false, `${type}: ${changed}`);
      }
    }
  }
});
test('invalid lengths, characters, repeated numbers and unsupported types cannot bypass validation', () => {
  for (const type of Object.keys(valid)) {
    for (const value of ['', null, undefined, 14078646000104, '123', '140786460001040', '5299822472x', '<script>', '１２３４５６７８９０１２３４']) assert.equal(validateDocument(type, value).valid, false);
    const length = { cnpj: 14, cpf: 11, cei: 12, caepf: 14 }[type];
    for (let digit = 0; digit <= 9; digit++) assert.equal(validateDocument(type, String(digit).repeat(length)).valid, false);
  }
  for (const type of ['unknown', '__proto__', 'constructor', 'toString', null]) assert.equal(validateDocument(type, '00000002500171').valid, false);
  assert.equal(validateDocument('cnpj', '14.078.646/0001-04!').valid, false);
  assert.equal(validateDocument('cnpj', '14ß78646000104').valid, false);
  assert.equal(validateDocument('cei', '000000000019').valid, false);
  assert.equal(validateDocument('caepf', '00000000000012').valid, false);
  // CAEPF has its own DV adjustment; a CNPJ-style pair is not interchangeable.
  assert.equal(validateDocument('caepf', '00000002500159').valid, false);
});
