import { withStore } from '@/lib/stores/route';
import { withStoreData } from '@/lib/stores/context';
import prisma from "@/lib/prisma";
import { parseEBayCSV, calculateMetrics, extractMakeFromTitle, parseSalesRows, parseTransactionReport, parsePromotedListingReport, parseSnapshotDateFromFilename, salesSourceKey } from "@/lib/csv-parser";
import { parseInventoryExpensesPdf, parseEbayFeesPdf } from "@/lib/pdf-parser";
import { parseInventoryExpenseCsvRows } from "@/lib/expense-csv";
import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { RequestOriginError, verifySameOrigin } from '@/lib/http/request-guard';
import { createPrismaAdCampaignStore } from "@/lib/ebay/sync/prisma-ad-campaign-writer";

async function handlePOST(req: Request) {

  try {
    verifySameOrigin(req.headers);
  } catch (error) {
    if (error instanceof RequestOriginError) {
      return NextResponse.json({ error: 'Forbidden request origin.' }, { status: 403 });
    }
    throw error;
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const reportType = formData.get('type') as string;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const lowerName = file.name.toLowerCase();
    const isPdf = lowerName.endsWith('.pdf');
    const isSpreadsheet = lowerName.endsWith('.xlsx');
    if (lowerName.endsWith('.xls')) return NextResponse.json({ error: 'Legacy .xls files are not supported. Export as .xlsx or CSV.' }, { status: 400 });
    const allowedTypes = new Set(['sales', 'active', 'traffic', 'transactions', 'promoted-listings', 'inventory-expenses', 'ebay-fees']);
    if (!allowedTypes.has(reportType)) return NextResponse.json({ error: 'Choose a supported report type.' }, { status: 400 });
    if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'File is larger than the 25 MB upload limit.' }, { status: 413 });

    const readTabularText = async () => {
      if (!isSpreadsheet) return file.text();
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      // ExcelJS currently ships Buffer typings that lag Node's resizable Buffer type.
      await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error('The spreadsheet does not contain a worksheet.');
      const escapeCsv = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
      const lines: string[] = [];
      sheet.eachRow({ includeEmpty: true }, row => {
        const values: string[] = [];
        for (let column = 1; column <= sheet.columnCount; column++) values.push(escapeCsv(row.getCell(column).text));
        lines.push(values.join(','));
      });
      return lines.join('\n');
    };

    if (reportType === 'transactions' || reportType === 'promoted-listings') {
      if (isPdf) return NextResponse.json({ error: 'This eBay report must be uploaded as CSV.' }, { status: 400 });
      if (isSpreadsheet) return NextResponse.json({ error: 'Transaction and Promoted Listings reports must be CSV files.' }, { status: 400 });
      const csvText = await readTabularText();

      if (reportType === 'transactions') {
        const rows = parseTransactionReport(csvText);
        const operations = rows.map(row => {
          const transactionKey = createHash('sha256').update([
            row.transactionDate.toISOString(), row.type, row.orderNumber, row.itemId,
            row.transactionId, row.netAmount, row.description,
          ].join('|')).digest('hex');
          return prisma.ebayTransaction.upsert({
            where: { storeId_transactionKey: withStoreData({ transactionKey: transactionKey }) },
            update: row,
            create: withStoreData({ ...row, transactionKey }),
          });
        });
        await prisma.$transaction([...operations, prisma.uploadRecord.create({ data: withStoreData({ filename: file.name, type: reportType, rowCount: rows.length }) })]);
        const orders = rows.filter(row => row.type.toLowerCase() === 'order');
        const fees = rows.reduce((sum, row) => sum + Math.abs(row.finalValueFeeFixed + row.finalValueFeeVariable + row.regulatoryFee + row.veryHighInadFee + row.belowStandardFee + row.internationalFee + row.otherFee), 0);
        return NextResponse.json({ success: true, count: rows.length, metrics: {
          rows: rows.length,
          orderRevenue: orders.reduce((sum, row) => sum + row.itemSubtotal, 0),
          fees,
          net: rows.filter(row => row.type.toLowerCase() !== 'payout').reduce((sum, row) => sum + row.netAmount, 0),
        } });
      }

      const records = parsePromotedListingReport(csvText);
      if (records.length === 0) {
        return NextResponse.json(
          { error: 'No promoted-listings rows found — expected an eBay Seller Hub Promoted Listings report.' },
          { status: 400 },
        );
      }

      // Performance goes into the structured EbayAdReport table (Phase 6). The
      // funding model per row comes from the synced campaign roster, not the CSV.
      const fundingByCampaign = await createPrismaAdCampaignStore(prisma).fundingModelByCampaign();
      const adRows = records.map(record => {
        const fundingModel = fundingByCampaign.get(record.campaignId) ?? 'unknown';
        return {
          reportStart: record.reportStart,
          reportEnd: record.reportEnd,
          fundingModel,
          campaignId: record.campaignId,
          campaignName: record.campaignName,
          campaignStatus: record.campaignStatus,
          listingId: record.itemId,
          title: record.title,
          impressions: record.promotedImpressions,
          clicks: record.promotedClicks,
          adSpend: record.adFees,
          attributedSales: record.attributedSales,
          attributedUnits: record.promotedSoldQuantity,
          cpc: record.promotedClicks > 0 ? record.adFees / record.promotedClicks : 0,
          ctr: record.promotedImpressions > 0 ? record.promotedClicks / record.promotedImpressions : 0,
          roas: record.roas || (record.adFees > 0 ? record.attributedSales / record.adFees : 0),
          acos: record.attributedSales > 0 ? record.adFees / record.attributedSales : 0,
        };
      });
      // Collapse duplicate lines so a batch never upserts the same unique key twice.
      const uniqueAdRows = Array.from(new Map(adRows.map(row => [
        `${row.reportStart.toISOString()}|${row.reportEnd.toISOString()}|${row.fundingModel}|${row.campaignId}|${row.listingId}`,
        row,
      ])).values());
      // Batched like prisma-ad-campaign-writer: one SQLite sync per transaction,
      // not one per row.
      const BATCH_SIZE = 250;
      for (let i = 0; i < uniqueAdRows.length; i += BATCH_SIZE) {
        const batch = uniqueAdRows.slice(i, i + BATCH_SIZE);
        await prisma.$transaction(batch.map(row => prisma.ebayAdReport.upsert({
          where: {
            storeId_reportStart_reportEnd_fundingModel_campaignId_listingId: withStoreData({
              reportStart: row.reportStart,
              reportEnd: row.reportEnd,
              fundingModel: row.fundingModel,
              campaignId: row.campaignId,
              listingId: row.listingId,
            }),
          },
          update: row,
          create: withStoreData(row),
        })));
      }
      await prisma.uploadRecord.create({ data: withStoreData({ filename: file.name, type: reportType, rowCount: records.length }) });
      const sales = records.reduce((sum, row) => sum + row.attributedSales, 0);
      const fees = records.reduce((sum, row) => sum + row.adFees, 0);
      return NextResponse.json({ success: true, count: records.length, metrics: {
        rows: records.length,
        impressions: records.reduce((sum, row) => sum + row.promotedImpressions, 0),
        clicks: records.reduce((sum, row) => sum + row.promotedClicks, 0),
        sales,
        fees,
        roas: fees > 0 ? sales / fees : 0,
      } });
    }

    // Handle PDF uploads for inventory-expenses and ebay-fees
    if ((reportType === 'inventory-expenses' || reportType === 'ebay-fees') && isPdf) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      // Dynamic import of pdf-parse (avoids Next.js edge-runtime issues)
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      const pdfData = await parser.getText();
      await parser.destroy();
      const text = pdfData.text;

      if (reportType === 'inventory-expenses') {
        const rows = parseInventoryExpensesPdf(text);
        const operations = rows.map(row => {
          const importKey = createHash('sha256').update(`${row.date.toISOString()}|${row.vendor}|${row.amount}|${row.memo || ''}`).digest('hex');
          return prisma.inventoryExpense.upsert({ where: { storeId_importKey: withStoreData({ importKey: importKey }) }, update: { date: row.date, vendor: row.vendor, amount: row.amount, memo: row.memo }, create: withStoreData({ date: row.date, vendor: row.vendor, amount: row.amount, memo: row.memo, importKey }) });
        });
        await prisma.$transaction([...operations, prisma.uploadRecord.create({ data: withStoreData({ filename: file.name, type: 'inventory-expenses', rowCount: rows.length }) })]);
        const total = rows.reduce((s, r) => s + r.amount, 0);
        return NextResponse.json({ success: true, count: rows.length, metrics: { total, rows: rows.length } });
      }

      if (reportType === 'ebay-fees') {
        const rows = parseEbayFeesPdf(text);
        const operations = rows.map(row => {
          const importKey = createHash('sha256').update(`${row.month}|${row.feeType}|${row.amount}|${row.description || ''}`).digest('hex');
          return prisma.ebayFee.upsert({ where: { storeId_importKey: withStoreData({ importKey: importKey }) }, update: row, create: withStoreData({ ...row, importKey }) });
        });
        await prisma.$transaction([...operations, prisma.uploadRecord.create({ data: withStoreData({ filename: file.name, type: 'ebay-fees', rowCount: rows.length }) })]);
        const total = rows.reduce((s, r) => s + r.amount, 0);
        return NextResponse.json({ success: true, count: rows.length, metrics: { total, rows: rows.length } });
      }
    }

    // Handle CSV uploads for inventory-expenses and ebay-fees
    if ((reportType === 'inventory-expenses' || reportType === 'ebay-fees') && !isPdf) {
      const Papa = (await import('papaparse')).default;
      const csvText = await readTabularText();
      const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      const rows = parsed.data as Record<string, string>[];

      if (reportType === 'inventory-expenses') {
        // Handles both the per-line yard-receipt export (Unit Price + Qty, with
        // receipt-level Sales Tax / Fees repeated per line) and the flat
        // QuickBooks shape (Date / Vendor / Amount). See src/lib/expense-csv.ts.
        const { rows: expenseRows, skipped } = parseInventoryExpenseCsvRows(rows);
        if (expenseRows.length === 0) {
          return NextResponse.json(
            { error: 'No expense rows found. Expected columns like Date, Vendor, Unit Price (yard receipts) or Amount (QuickBooks export).' },
            { status: 400 },
          );
        }
        for (const expense of expenseRows) {
          const importKey = createHash('sha256').update(expense.dedupeKey).digest('hex');
          const data = { date: expense.date, vendor: expense.vendor, amount: expense.amount, memo: expense.memo };
          await prisma.inventoryExpense.upsert({ where: { storeId_importKey: withStoreData({ importKey: importKey }) }, update: data, create: withStoreData({ ...data, importKey }) });
        }
        await prisma.uploadRecord.create({ data: withStoreData({ filename: file.name, type: 'inventory-expenses', rowCount: expenseRows.length }) });
        const total = (await prisma.inventoryExpense.aggregate({ _sum: { amount: true } }))._sum.amount || 0;
        return NextResponse.json({ success: true, count: expenseRows.length, metrics: { total, rows: expenseRows.length, skipped } });
      }

      if (reportType === 'ebay-fees') {
        let count = 0;
        for (const row of rows) {
          const dateStr = row['Date'] || row['date'] || row['Transaction Date'] || '';
          const amountStr = row['Amount'] || row['amount'] || row['Total'] || '';
          const desc = row['Description'] || row['Memo'] || row['memo'] || '';
          if (!dateStr || !amountStr) continue;
          const date = new Date(dateStr);
          const amount = parseFloat(amountStr.replace(/[$,()-]/g, ''));
          if (isNaN(date.getTime()) || isNaN(amount) || amount <= 0) continue;
          const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          const feeType = desc.toLowerCase().includes('final') ? 'final-value' : desc.toLowerCase().includes('per-order') || desc.toLowerCase().includes('per order') ? 'per-order' : 'flat';
          const importKey = createHash('sha256').update(`${month}|${feeType}|${amount}|${desc}`).digest('hex');
          await prisma.ebayFee.upsert({ where: { storeId_importKey: withStoreData({ importKey: importKey }) }, update: { month, feeType, amount, description: desc }, create: withStoreData({ month, feeType, amount, description: desc, importKey }) });
          count++;
        }
        await prisma.uploadRecord.create({ data: withStoreData({ filename: file.name, type: 'ebay-fees', rowCount: count }) });
        const total = (await prisma.ebayFee.aggregate({ _sum: { amount: true } }))._sum.amount || 0;
        return NextResponse.json({ success: true, count, metrics: { total, rows: count } });
      }
    }

    if (isPdf) return NextResponse.json({ error: 'Sales, Active Listings, and Traffic reports must be CSV or Excel files.' }, { status: 400 });
    const csvContent = await readTabularText();
    // Pass user-selected type as a hint so the parser doesn't misidentify active/traffic
    const report = await parseEBayCSV(csvContent, reportType);

    if (report.type === 'sales') {
      const saleRecords = parseSalesRows(report.rows);

      const existingSales = await prisma.sale.findMany({
        where: { orderNumber: { not: null } },
        select: { id: true, orderNumber: true, itemNumber: true },
      });
      const existingByOrderItem = new Map(existingSales.map(s => [`${s.orderNumber}|${s.itemNumber || ''}`, s.id]));

      // The same eBay order line can arrive in overlapping Paid & Shipped exports.
      // Older imports used legacy source keys, so match eBay's stable order/item identity
      // before falling back to the current stable source key for new records.
      const operations = saleRecords.map(s => {
        const existingId = s.orderNumber ? existingByOrderItem.get(`${s.orderNumber}|${s.itemNumber || ''}`) : undefined;
        const data = {
          recordNumber: s.recordNumber,
          saleDate: s.saleDate,
          itemTitle: s.itemTitle,
          brand: s.brand,
          itemNumber: s.itemNumber,
          soldFor: s.soldFor,
          shipping: s.shipping,
          eBayTax: s.eBayTax,
          totalPrice: s.totalPrice,
          shipToState: s.shipToState,
          shipToCountry: s.shipToCountry,
          promoted: s.promoted,
          quantity: s.quantity,
        };
        if (existingId) return prisma.sale.update({ where: { id: existingId }, data });
        const sourceKey = salesSourceKey(s);
        return prisma.sale.upsert({
          where: { storeId_sourceKey: withStoreData({ sourceKey: sourceKey }) },
          update: data,
          create: withStoreData({ ...data, orderNumber: s.orderNumber, sourceKey }),
        });
      });
      const count = saleRecords.length;
      await prisma.$transaction([...operations, prisma.uploadRecord.create({
        data: withStoreData({
          filename: file.name,
          type: 'sales',
          rowCount: count,
        })
      })]);

      const aggregate = calculateMetrics(report.rows);
      return NextResponse.json({ success: true, count, metrics: aggregate });
    }

    if (report.type === 'active') {
      let inserted = 0;
      const operations = [];
      for (const row of report.rows) {
        // Skip rows with no itemId — can't upsert without a unique key
        if (!row.itemId) continue;
        // Normalize empty string SKU to null to avoid unique constraint conflicts
        const sku = row.sku && row.sku.trim() ? row.sku.trim() : null;
        const itemId = String(row.itemId).trim();

        operations.push(prisma.inventory.upsert({
          where: { storeId_itemId: withStoreData({ itemId: itemId }) },
          update: {
            title: row.title,
            sku,
            price: row.price || 0,
            quantity: row.quantity ?? 0,
            views: row.views || 0,
            watchers: row.watchers || 0,
          },
          create: withStoreData({
            itemId,
            title: row.title || 'Unknown',
            sku,
            price: row.price || 0,
            quantity: row.quantity ?? 0,
            views: row.views || 0,
            watchers: row.watchers || 0,
            brand: extractMakeFromTitle(row.title || ''),
          })
        }));
        inserted++;
      }
      const skipped = report.rows.length - inserted;

      await prisma.$transaction([...operations, prisma.uploadRecord.create({
        data: withStoreData({
          filename: file.name,
          type: 'active',
          rowCount: inserted,
        })
      })]);

      if (inserted === 0 && report.rows.length > 0) {
        return NextResponse.json({
          error: `No rows had a recognized 'Item number' column — is this really an Active Listings export?`,
        }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        count: inserted,
        metrics: { rows: inserted, skipped, parsed: report.rows.length },
      });
    }

    if (report.type === 'traffic') {
      let inserted = 0;
      const operations = [];
      const snapshotDate = parseSnapshotDateFromFilename(file.name) ?? new Date(new Date().setHours(0, 0, 0, 0));
      for (const row of report.rows) {
        if (!row.itemId) continue;
        operations.push(prisma.performanceMetric.upsert({
          where: {
            storeId_date_itemId: withStoreData({
              date: snapshotDate,
              itemId: row.itemId
            })
          },
          update: {
            impressions: row.impressions,
            pageViews: row.pageViews,
            ctr: row.ctr,
            salesConversionRate: row.salesConversionRate,
          },
          create: withStoreData({
            date: snapshotDate,
            itemId: row.itemId,
            impressions: row.impressions,
            pageViews: row.pageViews,
            ctr: row.ctr,
            salesConversionRate: row.salesConversionRate,
          })
        }));
        inserted++;
      }
      const skipped = report.rows.length - inserted;

      await prisma.$transaction([...operations, prisma.uploadRecord.create({
        data: withStoreData({
          filename: file.name,
          type: 'traffic',
          rowCount: inserted,
        })
      })]);

      if (inserted === 0 && report.rows.length > 0) {
        return NextResponse.json({
          error: `No rows had a recognized 'eBay item ID' column — is this really a Traffic report? Promoted Listings and Sold reports use different columns.`,
        }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        count: inserted,
        metrics: { rows: inserted, skipped, parsed: report.rows.length },
      });
    }

    return NextResponse.json({ error: "Unsupported report type" }, { status: 400 });

  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : 'Unknown import error';
    return NextResponse.json({ error: `Could not import this report: ${message}` }, { status: 500 });
  }
}

export const POST = withStore('admin', handlePOST);
