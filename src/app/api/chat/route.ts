import { withStore } from '@/lib/stores/route';
import { AIError, generateReply, getProviderSettings, parseMessages, resolveProvider } from "@/lib/ai/providers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { searchAllYards } from "@/lib/yard-parser";
import { normalizeBrand } from "@/lib/brand-normalizer";
import { demoChatResponse } from '@/lib/demo/chat';
import { guardDemoRoute } from '@/lib/demo/guard';
import { isDemoMode } from '@/lib/demo/server';

const BASE_SYSTEM_PROMPT = `🔧 eBay Auto Parts Specialist Agent — System Prompt (v2)

You are an elite eBay specialist with deep expertise in the used auto parts industry. You operate as a full-service eBay store manager, strategist, and consultant for a used auto parts business that sources inventory primarily from U-Pull salvage yards. You handle everything end-to-end — from sourcing decisions at the yard to listing creation, customer disputes, and ad campaigns — with the precision of a seasoned professional who knows eBay's platform, algorithm, policies, and the auto parts market inside and out.

🏪 STORE CONTEXT
Store type: Used auto parts (OEM & salvage pull-out parts)
Sourcing model: U-Pull salvage yards. Use the configured public yard integrations when relevant; ask the user about preferred locations and trip costs rather than assuming them.
Inventory type: Self-pulled OEM parts, tested/untested components, core returns
Platform: eBay (primary)
Competitor awareness: Amazon, RockAuto, LKQ, PartsGeek, Car-Part.com, Facebook Marketplace
Audience: DIY mechanics, independent repair shops, dealerships, flippers, restorers

🎯 CORE RESPONSIBILITIES

1. 🔍 SALVAGE YARD SOURCING & INVENTORY RESEARCH (Top Priority)
Before every yard trip, help identify what to pull based on real profit potential.
Supported Public Yard Integrations:
- Pick-A-Part VA (Stafford & Fredericksburg, VA): AJAX search.
- Rupert's U-Pull It (rupertsupullit.com): GET search, standard inventory table.

Pre-Trip Research Workflow:
- Query yard inventory search endpoints for high-demand vehicles.
- Research eBay demand for parts from those vehicles.
- Calculate pull ROI: (eBay avg sold price) − (yard cost) − (eBay fees ~13%) − (shipping) = NET PROFIT.
- Deliver a ranked pull list with estimated profit per part.

2. 📊 PERFORMANCE-TO-TASK MATRIX (AI Insights)
Automatically suggest strategic tasks based on performance metrics:
- CTR < 0.5% -> Suggest "Visuals: Update Primary Photo".
- Impressions < 100 -> Suggest "SEO: Optimize Keywords".
- Conversion < 1% -> Suggest "Sales: Add Best Offer / Price Drop".
- Stock Out -> Suggest "Sourcing: Restock high-performing brands".

3. 📊 TERAPEAK & MARKET RESEARCH
Interpret copy-pasted or uploaded Terapeak data (sell-through rate, avg price, competition level).
Identify Seasonal Trends (Winter: 4WD/Heater Cores; Spring: AC/Suspension; Summer: Cooling/Body Panels).

3. 📋 LISTING CREATION & OPTIMIZATION
Write SEO titles (80 chars): Year + Make + Model + Part Name + OEM Part # + Condition.
Draft structured descriptions with fitment, condition, and interchange info.

4. 💰 PRICING STRATEGY
Calculate minimum floor prices and recommend Best Offer thresholds.
Advise on repricing strategies for inventory older than 30 days.

5. 📦 SHIPPING & FULFILLMENT
Carrier selection (USPS for small, UPS/FedEx for standard, Freight for engines).
Hazmat flags for airbags, batteries, and refrigerants.

6. 🛠️ CUSTOMER SERVICE
Draft professional, firm responses for inquiries, returns, and disputes.
Handle core return communications.

7. 🚗 EXPANDED SOURCING STRATEGY
Car-Part.com for B2B sales, Copart/IAAI for auction harvests, and Facebook Marketplace for local heavy items.

🗣️ COMMUNICATION STYLE & FORMAT
- ALWAYS respond in structured, report-like format using markdown.
- Use ## headers for major sections, ### for sub-sections.
- Use bullet lists (-) for items, numbered lists for ranked/ordered content.
- Use **bold** to highlight key figures, part names, prices, and action items.
- Use --- horizontal rules to separate major report sections.
- For pull lists: use a numbered list with Part | Est. Sell Price | Est. Profit per line.
- For pricing: state floor price, recommended price, and Best Offer threshold clearly.
- For market insights: lead with a 1-line summary, then bullet supporting data.
- Keep answers scannable — avoid long unbroken paragraphs.
- End every substantive response with a **→ Next Action** line recommending what to do next.

⚠️ ALWAYS CONSIDER
ROI on every pull — time at the yard is money.
Seller protection first — protect account health.
Compliance — hazmat, emissions parts, and core charge rules.

🔌 LIVE DATA ACCESS — CRITICAL RULES
You have REAL-TIME access to the following data, injected into your context at the start of every message:
- [Active eBay Inventory]: Your full live eBay inventory with prices, quantities, views, watchers per listing. This is REAL data — never say you don't have inventory access.
- [Current Performance Snapshot]: Real revenue, sales, CTR, and top brand metrics from the database.
- [Current Task Matrix]: Active tasks from the task board.
- [Live Yard Inventory]: When the user asks about yard availability for a specific make/model, real results from Pick-A-Part VA and Rupert's U-Pull It are fetched and injected here. If this block is present in your context, it is LIVE data — never say you're simulating or that you don't have API access. If it is absent, you can note that the search didn't return results for that query.
NEVER say "I'll simulate", "I don't have live access", or "hypothetically" about ANY of the above data sources.`;

const INTENT_KEYWORDS = ['yard', 'inventory', 'search', 'pull', 'in stock', 'available', 'have any', 'do you have'];

const KNOWN_MAKES: Record<string, string> = {
  VOLVO: 'VOLVO', BMW: 'BMW', AUDI: 'AUDI',
  MERCEDES: 'MERCEDES-BENZ', 'MERCEDES-BENZ': 'MERCEDES-BENZ',
  HONDA: 'HONDA', TOYOTA: 'TOYOTA', FORD: 'FORD',
  CHEVY: 'CHEVROLET', CHEVROLET: 'CHEVROLET',
  CADILLAC: 'CADILLAC', LINCOLN: 'LINCOLN',
  DODGE: 'DODGE', CHRYSLER: 'CHRYSLER', JEEP: 'JEEP', RAM: 'RAM',
  NISSAN: 'NISSAN', HYUNDAI: 'HYUNDAI', KIA: 'KIA',
  SUBARU: 'SUBARU', MAZDA: 'MAZDA', LEXUS: 'LEXUS', ACURA: 'ACURA',
  INFINITI: 'INFINITI', GMC: 'GMC', BUICK: 'BUICK', PONTIAC: 'PONTIAC',
  SATURN: 'SATURN', OLDSMOBILE: 'OLDSMOBILE',
};

// Models that uniquely identify a make — used when the make is not stated explicitly
const MODEL_TO_MAKE: Record<string, string> = {
  XC90: 'VOLVO', XC60: 'VOLVO', XC40: 'VOLVO',
  S60: 'VOLVO', S80: 'VOLVO', S40: 'VOLVO',
  V70: 'VOLVO', V60: 'VOLVO', V40: 'VOLVO',
  C30: 'VOLVO', C70: 'VOLVO',
};

function detectYardIntent(message: string): [string, string] | null {
  const lower = message.toLowerCase();
  if (!INTENT_KEYWORDS.some(kw => lower.includes(kw))) return null;

  const upper = message.toUpperCase();
  let detectedMake: string | null = null;
  for (const [key, val] of Object.entries(KNOWN_MAKES)) {
    if (upper.includes(key)) { detectedMake = val; break; }
  }

  const STOP_WORDS = new Set([
    // grammar words
    'ANY', 'DO', 'YOU', 'HAVE', 'IN', 'THE', 'FOR', 'MY', 'A', 'AN', 'AT', 'OF',
    'IS', 'IT', 'THIS', 'THAT', 'ARE', 'WHAT', 'HOW', 'GET',
    // intent keywords (from INTENT_KEYWORDS array)
    'YARD', 'SEARCH', 'PULL', 'STOCK', 'PARTS', 'PART',
  ]);
  const makeKeys = new Set(Object.keys(KNOWN_MAKES));
  const tokens = upper.match(/\b[A-Z0-9]{2,6}\b/g) || [];

  if (!detectedMake) {
    // Try to infer make from a known model token
    const inferredMakeToken = tokens.find(t => MODEL_TO_MAKE[t]);
    if (inferredMakeToken) {
      detectedMake = MODEL_TO_MAKE[inferredMakeToken];
    }
  }

  if (!detectedMake) return null;

  // Prefer a known model token; fall back to any non-make non-stop-word token; allow empty for make-only search
  const knownModelToken = tokens.find(t => MODEL_TO_MAKE[t] !== undefined);
  const fallbackModelToken = tokens.find(t => !makeKeys.has(t) && !STOP_WORDS.has(t));
  const resolvedModel = knownModelToken || fallbackModelToken || '';

  return [detectedMake, resolvedModel];
}

async function handleGET() {
  try {
    return NextResponse.json(getProviderSettings(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return chatErrorResponse(error);
  }
}

function chatErrorResponse(error: unknown) {
  return NextResponse.json(
    { error: 'AI unavailable', detail: error instanceof AIError ? error.message : 'Unable to prepare the AI response. Please try again.' },
    { status: error instanceof AIError ? error.status : 500 }
  );
}

async function handlePOST(req: Request) {
  try {
    const body = await req.json().catch(() => { throw new AIError('Send a valid JSON request.', 400); });
    const messages = parseMessages(body?.messages);
    const provider = resolveProvider(body?.provider);

    const [activeTasks, metricsAgg, topBrandsRaw, inventoryByBrandRaw, topWatched] = await Promise.all([
      prisma.task.findMany({
        where: { status: { in: ['todo', 'in-progress'] } },
        orderBy: { priority: 'desc' }
      }),
      prisma.performanceMetric.aggregate({
        _sum: { revenue: true, salesCount: true, cost: true },
        _avg: { ctr: true },
      }),
      prisma.performanceMetric.groupBy({
        by: ['topBrand'],
        _sum: { revenue: true, salesCount: true },
        where: { topBrand: { not: null } },
        orderBy: { _sum: { revenue: 'desc' } },
      }),
      prisma.inventory.groupBy({
        by: ['brand'],
        _count: { id: true },
        _sum: { price: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      prisma.inventory.findMany({
        select: { title: true, price: true, quantity: true, views: true, watchers: true, brand: true, itemId: true },
        orderBy: [{ brand: 'asc' }, { watchers: 'desc' }],
      }),
    ]);

    const taskContext = activeTasks.length > 0
      ? "\n\n[Current Task Matrix]:\n" + activeTasks.map(t => `- ${t.title} (${t.priority}) - ${t.status}`).join("\n")
      : "";

    const revenue = metricsAgg._sum.revenue || 0;
    const salesCount = metricsAgg._sum.salesCount || 0;
    const ctr = metricsAgg._avg.ctr || 0;
    const topBrandMap: Record<string, { revenue: number; salesCount: number }> = {};
    topBrandsRaw.forEach(b => {
      const brand = normalizeBrand(b.topBrand);
      if (!topBrandMap[brand]) topBrandMap[brand] = { revenue: 0, salesCount: 0 };
      topBrandMap[brand].revenue += b._sum.revenue || 0;
      topBrandMap[brand].salesCount += b._sum.salesCount || 0;
    });
    const topBrands = Object.entries(topBrandMap)
      .map(([brand, v]) => ({ brand, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 3);
    const brandsStr = topBrands
      .map(b => `${b.brand} ($${b.revenue.toLocaleString()}, ${b.salesCount} sales)`)
      .join(', ');

    const metricsContext = revenue > 0
      ? `\n\n[Current Performance Snapshot]:\n- Total Revenue: $${revenue.toLocaleString()} | Sales: ${salesCount} | Avg CTR: ${ctr.toFixed(2)}%\n- Top Brands: ${brandsStr || 'No data'}`
      : '';

    const totalInventory = topWatched.length; // topWatched is now all items
    const totalInventoryValue = inventoryByBrandRaw.reduce((s, b) => s + (b._sum.price || 0), 0);
    const inventoryBrandMap: Record<string, number> = {};
    inventoryByBrandRaw.forEach(b => {
      const brand = normalizeBrand(b.brand);
      inventoryBrandMap[brand] = (inventoryBrandMap[brand] || 0) + b._count.id;
    });
    const inventoryBrandsStr = Object.entries(inventoryBrandMap)
      .sort((a, b) => b[1] - a[1])
      .map(([brand, count]) => `${brand} (${count})`)
      .join(', ');

    // Cross-reference: top-selling brands vs what's in inventory — restocking gap
    const topSoldBrands = topBrands.map(b => b.brand.toUpperCase());
    const inStockBrands = new Set(Object.keys(inventoryBrandMap).map(b => b.toUpperCase()));
    const stockGaps = topSoldBrands.filter(b => !inStockBrands.has(b));

    // Full inventory list — compact one-liner per item
    const fullListingLines = topWatched
      .map(i => `  - [${normalizeBrand(i.brand)}] ${i.title} | $${i.price.toFixed(0)} | qty:${i.quantity ?? 0} | ${i.watchers}w ${i.views}v${i.itemId ? ` | ID:${i.itemId}` : ''}`)
      .join('\n');

    const zeroQty = topWatched.filter(i => (i.quantity ?? 0) === 0);
    const zeroQtyStr = zeroQty.length > 0
      ? `\n- ⚠ OUT OF STOCK (qty=0, needs restocking, ${zeroQty.length} listings): ${zeroQty.map(i => `"${i.title}"`).join('; ')}`
      : '';

    const deadStock = topWatched.filter(i => i.views === 0 && i.watchers === 0 && (i.quantity ?? 0) > 0);
    const deadStockStr = deadStock.length > 0
      ? `\n- Dead stock (has qty but 0 views/watchers, ${deadStock.length} items): ${deadStock.map(i => `"${i.title}"`).join('; ')}`
      : '';

    const inventoryContext = totalInventory > 0
      ? `\n\n[Active eBay Inventory — Full Listing (${totalInventory} items, $${totalInventoryValue.toFixed(0)} total listed value)]:\n- By brand count: ${inventoryBrandsStr}${stockGaps.length > 0 ? `\n- ⚠ Restocking gaps (top sellers not in stock): ${stockGaps.join(', ')}` : ''}${zeroQtyStr}${deadStockStr}\n- All listings (format: [brand] title | price | qty | watchers/views):\n${fullListingLines}`
      : '';

    const lastMessage = messages[messages.length - 1].content as string;
    const yardIntent = detectYardIntent(lastMessage);

    // Detect restock intent: user wants yard search across multiple out-of-stock brands
    const RESTOCK_KEYWORDS = ['restock', 'out of stock', 'zero qty', 'refill', 'replenish', 'my inventory', 'my out-of-stock', 'my listings'];
    const lowerMsg = lastMessage.toLowerCase();
    const hasRestockIntent = RESTOCK_KEYWORDS.some(kw => lowerMsg.includes(kw)) &&
      (lowerMsg.includes('yard') || lowerMsg.includes('search') || lowerMsg.includes('pull') || lowerMsg.includes('find') || lowerMsg.includes('source'));

    let yardContext = '';
    if (hasRestockIntent && !yardIntent && zeroQty.length > 0) {
      // Auto-search yards for top unique brands from out-of-stock inventory
      const outOfStockBrands = [...new Set(zeroQty.map(i => normalizeBrand(i.brand).toUpperCase()))]
        .filter(b => b !== 'UNKNOWN');
      const topBrandsToSearch = outOfStockBrands.slice(0, 3);
      try {
        const allSearches = await Promise.all(
          topBrandsToSearch.map(brand => searchAllYards(brand, '').then(results => ({ brand, results })))
        );
        const yardBlocks = allSearches
          .filter(s => s.results.length > 0)
          .map(s => `  ${s.brand} (${s.results.length} found): ${s.results.slice(0, 5).map(r => `${r.year} ${r.model} (${r.yard}, ${r.rowOrStock})`).join('; ')}`);
        if (yardBlocks.length > 0) {
          yardContext = `\n\n[Live Yard Inventory — REAL DATA from Pick-A-Part VA & Rupert's U-Pull It] - Auto-searched top out-of-stock brands:\n` + yardBlocks.join('\n');
        } else {
          yardContext = `\n\n[Live Yard Inventory] - Auto-searched ${topBrandsToSearch.join(', ')} — No vehicles found at either yard currently.`;
        }
      } catch {
        // non-fatal
      }
    } else if (yardIntent) {
      try {
        const [intentMake, intentModel] = yardIntent;
        const yardResults = await searchAllYards(intentMake, intentModel);
        if (yardResults.length > 0) {
          const top10 = yardResults.slice(0, 10);
          yardContext = `\n\n[Live Yard Inventory — REAL DATA from Pick-A-Part VA & Rupert's U-Pull It] - Search: ${intentMake}${intentModel ? ' ' + intentModel : ''} (${yardResults.length} total results, showing top ${top10.length}):\n`
            + top10.map(r => `- ${r.yard}: ${r.year} ${r.make} ${r.model} ${r.color} (${r.rowOrStock})`).join('\n');
        } else {
          yardContext = `\n\n[Live Yard Inventory] - Search: ${intentMake}${intentModel ? ' ' + intentModel : ''} — No vehicles found at Pick-A-Part VA or Rupert's U-Pull It.`;
        }
      } catch {
        // yard search failure is non-fatal — agent proceeds without inventory data
      }
    }

    const text = await generateReply(
      provider,
      BASE_SYSTEM_PROMPT + taskContext + metricsContext + inventoryContext + yardContext,
      messages,
      req.signal
    );

    return NextResponse.json({ content: text, provider });
  } catch (error) {
    return chatErrorResponse(error);
  }
}

export const GET = withStore('view', handleGET);

const cachedChat = withStore('view', demoChatResponse);
const liveChat = withStore('edit', handlePOST);

export async function POST(request: Request) {
  const blocked = guardDemoRoute('/api/chat', 'POST');
  if (blocked) return blocked;
  return isDemoMode() ? cachedChat(request) : liveChat(request);
}
