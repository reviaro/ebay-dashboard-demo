// PDF parsing for QuickBooks expense exports

export interface InventoryExpenseRow {
  date: Date;
  vendor: string;
  amount: number;
  memo?: string;
}

export interface EbayFeeRow {
  month: string; // YYYY-MM
  feeType: string;
  amount: number;
  description?: string;
}

export function normalizeVendor(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('rupert')) return "Rupert's U-Pull It";
  if (lower.includes('harry') || lower.includes('harri')) return 'Harrys U Pull It';
  if (lower.includes('pick') || lower.includes('par')) return 'Pick a Part';
  return raw.trim();
}

// Parse date strings in various formats: MM/DD/YY, MM/DD/YYYY, Jan 1, 2025, etc.
function parseDate(s: string): Date | null {
  // MM/DD/YYYY or MM/DD/YY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    let year = parseInt(mdy[3]);
    if (year < 100) year += 2000;
    return new Date(year, parseInt(mdy[1]) - 1, parseInt(mdy[2]));
  }
  // Month DD, YYYY
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return null;
}

/**
 * Parse QuickBooks Inventory expense PDF text.
 * Expected format has lines with date, vendor, and dollar amounts.
 */
export function parseInventoryExpensesPdf(text: string): InventoryExpenseRow[] {
  const rows: InventoryExpenseRow[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Pattern: a line containing a date + amount, with vendor nearby
  // QuickBooks format often: DATE  VENDOR  MEMO  AMOUNT
  // Also tries to match lines like "01/15/2024   Demo Yard    $120.50"
  const dateAmountRe = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.*?)\s+\$?([\d,]+\.\d{2})\s*$/;
  const simpleAmountRe = /\$?([\d,]+\.\d{2})$/;
  const dateRe = /^\d{1,2}\/\d{1,2}\/\d{2,4}/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try full match: date + content + amount
    const m = line.match(dateAmountRe);
    if (m) {
      const date = parseDate(m[1]);
      if (!date) continue;
      const vendorRaw = m[2];
      const amount = parseFloat(m[3].replace(/,/g, ''));
      if (amount <= 0 || amount > 5000) continue; // sanity check
      rows.push({
        date,
        vendor: normalizeVendor(vendorRaw),
        amount,
      });
      continue;
    }

    // Try: line starts with date, next lines have vendor and amount
    if (dateRe.test(line)) {
      const date = parseDate(line.match(dateRe)![0]);
      if (!date) continue;

      // Look at this line and next 3 for vendor + amount clues
      const context = lines.slice(i, i + 4).join(' ');
      const amtMatch = context.match(simpleAmountRe);
      if (!amtMatch) continue;
      const amount = parseFloat(amtMatch[1].replace(/,/g, ''));
      if (amount <= 0 || amount > 5000) continue;

      // Find vendor in context
      let vendor = 'Pick a Part'; // default
      if (/rupert/i.test(context)) vendor = "Rupert's U-Pull It";
      else if (/harry|harri/i.test(context)) vendor = 'Harrys U Pull It';
      else if (/pick.*part/i.test(context)) vendor = 'Pick a Part';

      rows.push({ date, vendor, amount });
    }
  }

  // Deduplicate by date+amount+vendor (QuickBooks sometimes repeats header rows)
  const seen = new Set<string>();
  return rows.filter(r => {
    const key = `${r.date.toISOString()}-${r.vendor}-${r.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Parse QuickBooks eBay Fees PDF text.
 * Each sale generates two fee entries: fee-1 (FVF ~13.25%) and fee-2 (per-order ~$0.30).
 * Format: transaction-ID  date  amount
 */
export function parseEbayFeesPdf(text: string): EbayFeeRow[] {
  const monthlyTotals: Record<string, { finalValue: number; perOrder: number; flat: number }> = {};

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Pattern for fee lines: "21-12345-67890-fee-1  01/15/2025  $15.42"
  const feeLineRe = /(\d{2}-\d{5}-\d{5}-fee-[12])\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+\$?([\d,]+\.\d{2})/;
  // Also catch flat $2.00 fees
  const flatFeeRe = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+.*?\s+\$?2\.00\s*$/;

  for (const line of lines) {
    const fm = line.match(feeLineRe);
    if (fm) {
      const txId = fm[1];
      const date = parseDate(fm[2]);
      if (!date) continue;
      const amount = parseFloat(fm[3].replace(/,/g, ''));
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyTotals[monthKey]) monthlyTotals[monthKey] = { finalValue: 0, perOrder: 0, flat: 0 };

      if (txId.endsWith('-fee-1')) {
        monthlyTotals[monthKey].finalValue += amount;
      } else {
        monthlyTotals[monthKey].perOrder += amount;
      }
      continue;
    }

    // Flat fees
    const ff = line.match(flatFeeRe);
    if (ff) {
      const date = parseDate(ff[1]);
      if (!date) continue;
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyTotals[monthKey]) monthlyTotals[monthKey] = { finalValue: 0, perOrder: 0, flat: 0 };
      monthlyTotals[monthKey].flat += 2.0;
    }
  }

  const rows: EbayFeeRow[] = [];
  for (const [month, totals] of Object.entries(monthlyTotals)) {
    if (totals.finalValue > 0) {
      rows.push({ month, feeType: 'final-value', amount: totals.finalValue });
    }
    if (totals.perOrder > 0) {
      rows.push({ month, feeType: 'per-order', amount: totals.perOrder });
    }
    if (totals.flat > 0) {
      rows.push({ month, feeType: 'flat', amount: totals.flat });
    }
  }

  return rows;
}
