/*
 * TaxIQ tax engine — FY 2026-27 (AY 2027-28), resident individuals.
 *
 * Rules (unchanged by Budget 2026, so the FY 2025-26 rules carry over):
 *   New regime (default): slabs 0-4L nil, 4-8L 5%, 8-12L 10%, 12-16L 15%,
 *     16-20L 20%, 20-24L 25%, above 24L 30%; standard deduction Rs 75,000;
 *     Section 87A rebate makes taxable income up to Rs 12 lakh tax-free, with
 *     marginal relief just above it; employer NPS deductible up to 14% of basic.
 *   Old regime: slabs 0-2.5L nil (3L at 60-79, 5L at 80+), 2.5-5L 5%,
 *     5-10L 20%, above 10L 30%; standard deduction Rs 50,000; 87A rebate up to
 *     Rs 12,500 for taxable income up to Rs 5 lakh; HRA, 80C, 80CCD(1B), 80D
 *     and home-loan interest (self-occupied) allowed; employer NPS up to 10%.
 *   Both: surcharge above Rs 50 lakh (with marginal relief; new regime capped
 *     at 25%), 4% health and education cess, tax rounded to the nearest Rs 10.
 *
 * Prototype assumptions (shown to users in the UI):
 *   - Basic salary is 40% of gross; HRA received is 50% of basic in a metro,
 *     40% elsewhere; EPF is 12% of basic.
 *   - Special-rate income (capital gains, F&O, crypto) is not computed; the
 *     quiz routes those users to assisted filing.
 *
 * Section numbers follow the familiar 1961-Act names; the Income-tax Act,
 * 2025 renumbers them from 1 April 2026 but keeps the same deductions.
 *
 * Works in the browser (window.TaxIQEngine) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var LAKH = 100000;
  var CESS = 0.04;

  var RULES = {
    taxYear: 'FY 2026-27',
    basicShare: 0.4,
    epfShare: 0.12,
    new: {
      standardDeduction: 75000,
      slabs: [
        [4 * LAKH, 0], [8 * LAKH, 0.05], [12 * LAKH, 0.10], [16 * LAKH, 0.15],
        [20 * LAKH, 0.20], [24 * LAKH, 0.25], [Infinity, 0.30]
      ],
      rebateLimit: 12 * LAKH,
      employerNpsShare: 0.14,
      surchargeCap: 0.25
    },
    old: {
      standardDeduction: 50000,
      exemption: { below60: 2.5 * LAKH, '60to79': 3 * LAKH, '80plus': 5 * LAKH },
      rebateLimit: 5 * LAKH,
      rebateMax: 12500,
      employerNpsShare: 0.10,
      cap80C: 150000,
      cap80CCD1B: 50000,
      cap80DSelf: { below60: 25000, senior: 50000 },
      cap80DParents: { below60: 25000, senior: 50000 },
      capHomeLoan: 200000
    },
    surcharge: [[50 * LAKH, 0.10], [100 * LAKH, 0.15], [200 * LAKH, 0.25], [500 * LAKH, 0.37]]
  };

  function round10(x) { return Math.round(x / 10) * 10; }
  function nonNeg(x) { return x > 0 ? x : 0; }
  function num(x) { var n = Number(x); return isFinite(n) && n > 0 ? n : 0; }

  function slabTax(income, slabs) {
    var tax = 0, lower = 0;
    for (var i = 0; i < slabs.length; i++) {
      var upper = slabs[i][0], rate = slabs[i][1];
      if (income > lower) tax += (Math.min(income, upper) - lower) * rate;
      lower = upper;
    }
    return tax;
  }

  function oldSlabs(ageBand) {
    var ex = RULES.old.exemption[ageBand] || RULES.old.exemption.below60;
    return [[ex, 0], [5 * LAKH, 0.05], [10 * LAKH, 0.20], [Infinity, 0.30]];
  }

  // Surcharge with marginal relief: tax + surcharge never rises by more than
  // the income above the threshold that triggered the higher rate.
  function withSurcharge(income, baseTaxFn, cap) {
    var tax = baseTaxFn(income);
    var rate = 0, threshold = 0, prevRate = 0;
    for (var i = 0; i < RULES.surcharge.length; i++) {
      if (income > RULES.surcharge[i][0]) {
        prevRate = rate;
        threshold = RULES.surcharge[i][0];
        rate = Math.min(RULES.surcharge[i][1], cap);
      }
    }
    if (rate === 0) return { tax: tax, surcharge: 0 };
    var full = tax * (1 + rate);
    var atThreshold = baseTaxFn(threshold) * (1 + prevRate);
    var relieved = Math.min(full, atThreshold + (income - threshold));
    return { tax: tax, surcharge: nonNeg(relieved - tax) };
  }

  function newRegimeTaxOnTaxable(taxable) {
    var cfg = RULES.new;
    var base = function (ti) {
      var t = slabTax(ti, cfg.slabs);
      if (ti <= cfg.rebateLimit) return 0;               // Section 87A rebate
      return Math.min(t, ti - cfg.rebateLimit);           // marginal relief
    };
    var s = withSurcharge(taxable, base, cfg.surchargeCap);
    var beforeCess = s.tax + s.surcharge;
    return { slabTax: s.tax, surcharge: s.surcharge, cess: beforeCess * CESS, total: round10(beforeCess * (1 + CESS)) };
  }

  function oldRegimeTaxOnTaxable(taxable, ageBand) {
    var slabs = oldSlabs(ageBand);
    var base = function (ti) {
      var t = slabTax(ti, slabs);
      if (ti <= RULES.old.rebateLimit) t = nonNeg(t - RULES.old.rebateMax);
      return t;
    };
    var s = withSurcharge(taxable, base, 1);
    var beforeCess = s.tax + s.surcharge;
    return { slabTax: s.tax, surcharge: s.surcharge, cess: beforeCess * CESS, total: round10(beforeCess * (1 + CESS)) };
  }

  function normalise(p) {
    var gross = num(p.gross);
    var salaried = p.employment !== 'self';
    var basic = salaried ? gross * RULES.basicShare : 0;
    var epfEstimate = salaried ? Math.round(basic * RULES.epfShare) : 0;
    return {
      gross: gross,
      salaried: salaried,
      ageBand: p.ageBand || 'below60',
      metro: p.metro !== false,
      basic: basic,
      epfEstimate: epfEstimate,
      rentMonthly: num(p.rentMonthly),
      inv80C: p.inv80C == null ? epfEstimate : num(p.inv80C),
      healthSelf: num(p.healthSelf),
      healthParents: num(p.healthParents),
      parentsSenior: !!p.parentsSenior,
      homeLoanInterest: num(p.homeLoanInterest),
      npsOwn: num(p.npsOwn),
      employerNps: num(p.employerNps)
    };
  }

  function oldDeductions(n) {
    var c = RULES.old;
    var senior = n.ageBand !== 'below60';
    var hra = 0;
    if (n.salaried && n.rentMonthly > 0) {
      var hraReceived = n.basic * (n.metro ? 0.5 : 0.4);
      hra = nonNeg(Math.min(hraReceived, n.rentMonthly * 12 - 0.1 * n.basic));
    }
    var items = {
      standard: n.salaried ? c.standardDeduction : 0,
      hra: hra,
      sec80C: Math.min(n.inv80C, c.cap80C),
      sec80CCD1B: Math.min(n.npsOwn, c.cap80CCD1B),
      sec80D: Math.min(n.healthSelf, senior ? c.cap80DSelf.senior : c.cap80DSelf.below60) +
              Math.min(n.healthParents, n.parentsSenior ? c.cap80DParents.senior : c.cap80DParents.below60),
      homeLoan: Math.min(n.homeLoanInterest, c.capHomeLoan),
      employerNps: Math.min(n.employerNps, n.basic * c.employerNpsShare)
    };
    var total = 0;
    for (var k in items) total += items[k];
    return { items: items, total: total };
  }

  function newDeductions(n) {
    var items = {
      standard: n.salaried ? RULES.new.standardDeduction : 0,
      employerNps: Math.min(n.employerNps, n.basic * RULES.new.employerNpsShare)
    };
    return { items: items, total: items.standard + items.employerNps };
  }

  // Smallest total of old-regime deductions beyond the standard deduction at
  // which the old regime costs no more than the new one.
  function breakEven(n, newTotal) {
    var std = n.salaried ? RULES.old.standardDeduction : 0;
    var oldAt = function (d) { return oldRegimeTaxOnTaxable(round10(nonNeg(n.gross - std - d)), n.ageBand).total; };
    if (oldAt(0) <= newTotal) return 0;
    var lo = 0, hi = n.gross;
    if (oldAt(hi) > newTotal) return null;
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (oldAt(mid) <= newTotal) hi = mid; else lo = mid;
    }
    return Math.ceil(hi / 1000) * 1000;
  }

  function compare(profile) {
    var n = normalise(profile);
    var od = oldDeductions(n);
    var nd = newDeductions(n);
    var oldTaxable = round10(nonNeg(n.gross - od.total));
    var newTaxable = round10(nonNeg(n.gross - nd.total));
    var oldTax = oldRegimeTaxOnTaxable(oldTaxable, n.ageBand);
    var newTax = newRegimeTaxOnTaxable(newTaxable);
    var better = newTax.total <= oldTax.total ? 'new' : 'old';
    return {
      profile: n,
      old: { deductions: od, taxable: oldTaxable, tax: oldTax },
      new: { deductions: nd, taxable: newTaxable, tax: newTax },
      better: better,
      saving: Math.abs(oldTax.total - newTax.total),
      breakEvenBeyondStandard: breakEven(n, newTax.total),
      claimedBeyondStandard: od.total - od.items.standard
    };
  }

  // Tax saved under a regime if the profile changed as `patch` describes.
  function savingFrom(profile, patch, regime) {
    var before = compare(profile);
    var after = compare(Object.assign({}, profile, patch));
    return before[regime].tax.total - after[regime].tax.total;
  }

  /*
   * Top 3 moves: tax moves ranked by rupee impact, then protection and
   * convenience moves ranked by the user's stated goals. Educational only:
   * moves name product categories, never specific products.
   */
  function topMoves(profile, goals) {
    goals = goals || [];
    var r = compare(profile);
    var n = r.profile;
    var regime = r.better;
    var moves = [];

    if (profile.complexIncome) {
      moves.push({ id: 'assisted-filing', kind: 'route', impact: null,
        title: 'Get your capital gains checked by an expert',
        why: 'Gains, F&O or crypto are taxed at special rates this quiz does not compute. An assisted filing covers them.',
        works: 'Both regimes', offer: 'filing' });
    }

    var otherRegime = regime === 'new' ? 'old' : 'new';
    if (r.saving > 0) {
      moves.push({ id: 'declare-regime', kind: 'tax', impact: r.saving,
        title: n.salaried ? 'Declare the ' + regime + ' regime to HR' : 'Choose the ' + regime + ' regime when you file',
        why: 'It costs you ' + inr(r.saving) + ' less than the ' + otherRegime + ' regime for this year.',
        works: regime === 'new' ? 'New regime' : 'Old regime' });
    } else if (r.new.tax.total === 0) {
      moves.push({ id: 'zero-tax', kind: 'tax', impact: 0,
        title: 'Stay on the new regime: you owe no tax',
        why: 'Your taxable income is within the Rs 12 lakh rebate limit, so nothing extra needs to be invested for tax.',
        works: 'New regime' });
    }

    var taxMoves = [];
    if (n.salaried && regime === 'new' && r.new.tax.total > 0) {
      var room = n.basic * RULES.new.employerNpsShare - n.employerNps;
      if (room > 5000) {
        var s = savingFrom(profile, { employerNps: n.employerNps + room }, 'new');
        if (s > 1000) taxMoves.push({ id: 'employer-nps', kind: 'tax', impact: s,
          title: 'Ask HR to move part of your CTC into employer NPS',
          why: 'Up to 14% of basic (' + inr(Math.round(room)) + ' more) is deductible even in the new regime.',
          works: 'Both regimes', offer: 'nps' });
      }
    }
    if (regime === 'old') {
      var gap80C = RULES.old.cap80C - Math.min(n.inv80C, RULES.old.cap80C);
      if (gap80C > 5000) {
        var s80 = savingFrom(profile, { inv80C: n.inv80C + gap80C }, 'old');
        if (s80 > 500) taxMoves.push({ id: 'top-up-80c', kind: 'tax', impact: s80,
          title: 'Top up 80C by ' + inr(gap80C) + ' before 31 March',
          why: goals.indexOf('grow') >= 0 ? 'ELSS funds fill the limit with the shortest lock-in (3 years).' : 'PPF, ELSS or extra EPF all count toward the Rs 1.5 lakh limit.',
          works: 'Old regime only', offer: 'elss' });
      }
      var gapNps = RULES.old.cap80CCD1B - Math.min(n.npsOwn, RULES.old.cap80CCD1B);
      if (gapNps > 5000) {
        var sn = savingFrom(profile, { npsOwn: n.npsOwn + gapNps }, 'old');
        if (sn > 500) taxMoves.push({ id: 'nps-1b', kind: 'tax', impact: sn,
          title: 'Add ' + inr(gapNps) + ' to your own NPS',
          why: 'Section 80CCD(1B) gives an extra Rs 50,000 deduction on top of 80C.',
          works: 'Old regime only', offer: 'nps' });
      }
      if (n.healthParents === 0) {
        var cap = n.parentsSenior ? 50000 : 25000;
        var sp = savingFrom(profile, { healthParents: cap }, 'old');
        if (sp > 500) taxMoves.push({ id: 'parents-80d', kind: 'tax', impact: sp,
          title: "Cover your parents' health",
          why: 'Premiums up to ' + inr(cap) + ' are deductible under 80D, and it protects their savings.',
          works: 'Old regime only', offer: 'health' });
      }
    }
    taxMoves.sort(function (a, b) { return b.impact - a.impact; });

    var softMoves = [];
    if (n.healthSelf === 0) softMoves.push({ id: 'health-self', kind: 'protect', impact: null, weight: goals.indexOf('protect') >= 0 ? 3 : 2,
      title: 'Get health cover for yourself',
      why: regime === 'new' ? 'It no longer saves tax in the new regime, but one hospital stay can cost more than a year of tax.' : 'It protects your savings and is deductible under 80D.',
      works: 'Both regimes', offer: 'health' });
    if (n.healthSelf > 0 && regime === 'new') softMoves.push({ id: 'keep-self', kind: 'protect', impact: null, weight: 0,
      title: 'Keep your own health cover',
      why: 'The premium no longer cuts tax in the new regime, but the cover still matters.',
      works: 'Both regimes' });
    if (n.healthParents > 0 && regime === 'new') softMoves.push({ id: 'keep-parents', kind: 'protect', impact: null, weight: goals.indexOf('protect') >= 0 ? 3 : 1,
      title: "Keep your parents' health cover",
      why: 'It no longer saves tax in the new regime, but it still protects them.',
      works: 'Both regimes' });
    if (goals.indexOf('protect') >= 0) softMoves.push({ id: 'term', kind: 'protect', impact: null, weight: 2,
      title: 'Check if your family needs term life cover',
      why: 'A common rule of thumb is cover of 10 to 15 times annual income if others depend on you.',
      works: 'Both regimes', offer: 'term' });
    if (goals.indexOf('grow') >= 0 && regime === 'new') softMoves.push({ id: 'skip-lockin', kind: 'grow', impact: null, weight: 2,
      title: 'Invest for growth, not for tax',
      why: 'On the new regime, lock-in tax products give you no deduction, so pick investments on returns and liquidity.',
      works: 'New regime' });
    if (goals.indexOf('file') >= 0 || !n.salaried) softMoves.push({ id: 'file-expert', kind: 'file', impact: null, weight: goals.indexOf('file') >= 0 ? 3 : 1,
      title: n.salaried ? 'File by 31 July with expert help' : 'Pay advance tax by 15 Dec and 15 Mar',
      why: n.salaried ? 'A reviewed return avoids notices and catches refunds.' : 'Missing instalments adds interest at 1% a month.',
      works: 'Both regimes', offer: 'filing' });
    softMoves.sort(function (a, b) { return b.weight - a.weight; });

    var all = moves.concat(taxMoves, softMoves);
    var seen = {}, out = [];
    for (var i = 0; i < all.length && out.length < 3; i++) {
      if (!seen[all[i].id]) { seen[all[i].id] = true; out.push(all[i]); }
    }
    return out;
  }

  function inr(x) {
    var v = Math.round(x);
    var s = String(Math.abs(v));
    var last3 = s.slice(-3), rest = s.slice(0, -3);
    if (rest) last3 = ',' + last3;
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return (v < 0 ? '-' : '') + 'Rs ' + rest + last3;
  }

  var api = {
    RULES: RULES,
    compare: compare,
    topMoves: topMoves,
    newRegimeTaxOnTaxable: newRegimeTaxOnTaxable,
    oldRegimeTaxOnTaxable: oldRegimeTaxOnTaxable,
    inr: inr
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TaxIQEngine = api;
})(typeof window !== 'undefined' ? window : this);
