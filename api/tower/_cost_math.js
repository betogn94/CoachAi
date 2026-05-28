// Amortization helpers shared by Tower endpoints.
//
// Tower always thinks in "monthly contribution": how much does THIS cost
// add to a given calendar month? This lets the dashboard show real monthly
// burn even when invoices come yearly or one purchase is split across
// 18 installments.

/**
 * @typedef {object} Cost
 * @property {number} amount_usd      Total amount (not per-month).
 * @property {'monthly'|'yearly'|'one-time'} billing_period
 * @property {number} installments    >=1. Only meaningful for one-time.
 * @property {string} period_start    'YYYY-MM-DD'
 * @property {string|null} period_end 'YYYY-MM-DD' or null (open-ended)
 */

function parseYMD(s) {
  // 'YYYY-MM-DD' → { year, month } (1-12)
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: +m[1], month: +m[2] };
}

function ymBefore(a, b) {
  // true if a.year-a.month strictly before b.year-b.month
  return a.year < b.year || (a.year === b.year && a.month < b.month);
}
function ymEqual(a, b) {
  return a.year === b.year && a.month === b.month;
}
function ymDiff(a, b) {
  // months from a to b (positive if b >= a)
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/**
 * How much does this cost contribute to month {year, month}?
 * Returns USD (number).
 */
export function monthlyContribution(cost, year, month) {
  const target = { year, month };
  const start = parseYMD(cost.period_start);
  if (!start) return 0;
  const end = parseYMD(cost.period_end);
  const amount = Number(cost.amount_usd || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  // Hasn't started yet?
  if (ymBefore(target, start)) return 0;

  const period = cost.billing_period || 'monthly';

  if (period === 'monthly') {
    if (end && ymBefore(end, target)) return 0;
    return amount;
  }

  if (period === 'yearly') {
    if (end && ymBefore(end, target)) return 0;
    return amount / 12;
  }

  if (period === 'one-time') {
    const n = Math.max(1, Number(cost.installments || 1));
    const diff = ymDiff(start, target);
    if (diff < 0 || diff >= n) return 0;
    return amount / n;
  }

  return 0;
}

/**
 * Sum monthly contributions for an array of costs at a given month.
 */
export function sumMonthly(costs, year, month) {
  let total = 0;
  for (const c of costs) total += monthlyContribution(c, year, month);
  return Math.round(total * 100) / 100;
}

/**
 * For a one-time installment plan, how many cuotas have been paid up to
 * (and including) `target`, out of total?
 *   Returns { paid, total, remaining, isActiveThisMonth }
 */
export function installmentsProgress(cost, year, month) {
  if (cost.billing_period !== 'one-time') return null;
  const n = Math.max(1, Number(cost.installments || 1));
  if (n === 1) return null;
  const start = parseYMD(cost.period_start);
  if (!start) return null;
  const target = { year, month };
  const diff = ymDiff(start, target);
  const paid = Math.max(0, Math.min(n, diff + 1));
  return {
    paid,
    total: n,
    remaining: Math.max(0, n - paid),
    isActiveThisMonth: diff >= 0 && diff < n,
  };
}

/**
 * Get current calendar month in UTC (year, month 1-12).
 */
export function currentMonthUtc() {
  const d = new Date();
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}
