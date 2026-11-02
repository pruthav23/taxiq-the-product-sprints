// Run with: node --test tests/
// Golden cases are worked examples published for FY 2026-27. Each one was
// re-derived by hand from the slabs before being added here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../prototype/tax-engine.js');

// Source: BasuNivesh, "New Tax Regime vs Old Regime: Who Wins in FY 2026-27"
// https://www.basunivesh.com/new-tax-regime-vs-old-regime-who-wins-in-fy-2026-27/
test('Rs 10 lakh salary, EPF only: new Rs 0, old Rs 75,400', () => {
  const r = E.compare({ gross: 1000000, inv80C: 150000 });
  assert.equal(r.new.tax.total, 0);
  assert.equal(r.old.tax.total, 75400);
  assert.equal(r.better, 'new');
});

test('Rs 15 lakh, 80C + NPS + health: new Rs 97,500, old Rs 1,87,200', () => {
  const r = E.compare({ gross: 1500000, inv80C: 150000, npsOwn: 50000, healthSelf: 25000 });
  assert.equal(r.new.tax.total, 97500);
  assert.equal(r.old.tax.total, 187200);
  assert.equal(r.saving, 89700);
});

test('New-regime tax from the break-even table (Rs 20, 25, 30 lakh)', () => {
  assert.equal(E.compare({ gross: 2000000 }).new.tax.total, 192400);
  assert.equal(E.compare({ gross: 2500000 }).new.tax.total, 319800);
  assert.equal(E.compare({ gross: 3000000 }).new.tax.total, 475800);
});

test('Old regime at Rs 22 lakh taxable: Rs 4,91,400', () => {
  assert.equal(E.oldRegimeTaxOnTaxable(2200000, 'below60').total, 491400);
});

test('Break-even deductions match the published table at Rs 12 and 15 lakh', () => {
  // Published: Rs 6.50 lakh at Rs 12 lakh, Rs 5.44 lakh at Rs 15 lakh
  assert.equal(E.compare({ gross: 1200000 }).breakEvenBeyondStandard, 650000);
  const be15 = E.compare({ gross: 1500000 }).breakEvenBeyondStandard;
  assert.ok(Math.abs(be15 - 544000) <= 2000, `got ${be15}`);
});

// Source: Indian Pay Calculator, income tax slabs page (marginal relief example)
// https://indianpaycalculator.in/income-tax-slabs
test('Marginal relief: Rs 12,05,000 taxable pays about Rs 5,200, not Rs 60,000+', () => {
  assert.equal(E.newRegimeTaxOnTaxable(1205000).total, 5200);
  assert.equal(E.newRegimeTaxOnTaxable(1200000).total, 0);
});

test('Salary of Rs 12.75 lakh is tax-free in the new regime', () => {
  assert.equal(E.compare({ gross: 1275000 }).new.tax.total, 0);
});

// PRD section 5 worked example (Rohit)
test('Rohit, Rs 22 lakh: old Rs 3,27,600, new Rs 2,40,500, saves Rs 87,100', () => {
  const rohit = { gross: 2200000, inv80C: 150000, homeLoanInterest: 200000,
    healthSelf: 25000, healthParents: 50000, parentsSenior: true, npsOwn: 50000 };
  const r = E.compare(rohit);
  assert.equal(r.old.taxable, 1675000);
  assert.equal(r.new.taxable, 2125000);
  assert.equal(r.old.tax.total, 327600);
  assert.equal(r.new.tax.total, 240500);
  assert.equal(r.saving, 87100);
  assert.ok(Math.abs(r.breakEvenBeyondStandard - 754000) <= 2000);
  const moves = E.topMoves(rohit, []);
  assert.equal(moves[0].id, 'declare-regime');
  assert.equal(moves[1].id, 'employer-nps');
  assert.ok(Math.abs(moves[1].impact - 32030) <= 20, `got ${moves[1].impact}`);
});

test('Senior citizens get a higher old-regime exemption', () => {
  const below60 = E.oldRegimeTaxOnTaxable(450000, 'below60').total;
  const at70 = E.oldRegimeTaxOnTaxable(600000, '60to79').total;
  assert.equal(below60, 0); // within the Rs 5 lakh rebate
  assert.equal(at70, round10((10000 + 20000) * 1.04)); // 3-5L at 5% + 5-6L at 20%
});

test('Surcharge with marginal relief just above Rs 50 lakh', () => {
  const at50 = E.newRegimeTaxOnTaxable(5000000).total;
  const above = E.newRegimeTaxOnTaxable(5010000).total;
  // Extra tax cannot exceed the extra Rs 10,000 of income (plus cess on it)
  assert.ok(above - at50 <= 10400 + 10, `jump ${above - at50}`);
});

test('Self-employed: no standard deduction', () => {
  const r = E.compare({ gross: 1400000, employment: 'self', inv80C: 150000, healthSelf: 25000 });
  assert.equal(r.new.taxable, 1400000);
  assert.equal(r.new.tax.total, 93600);
  assert.equal(r.old.tax.total, 187200);
});

test('Complex income puts assisted filing first', () => {
  const moves = E.topMoves({ gross: 1800000, complexIncome: true }, []);
  assert.equal(moves[0].id, 'assisted-filing');
});

test('Rupee formatting uses Indian grouping', () => {
  assert.equal(E.inr(8710000), 'Rs 87,10,000');
  assert.equal(E.inr(240500), 'Rs 2,40,500');
  assert.equal(E.inr(999), 'Rs 999');
});

function round10(x) { return Math.round(x / 10) * 10; }
