export interface SuggestedTask {
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  type: "visuals" | "seo" | "sales" | "sourcing";
  itemId?: string;
}

/**
 * Per-listing traffic over the last 30 days, summed from `EbayTrafficListing`.
 *
 * `ctr` and `conversionRate` are percentages (as `aggregateListings` returns
 * them), so the thresholds below read the way their comments do. The previous
 * input was the uploaded CSV's `PerformanceMetric`, whose `impressions` is a
 * lifetime-to-date total and whose rates are fractions -- so "impressions < 100"
 * never fired and "ctr < 0.5" fired for every listing.
 */
export interface ListingTrafficSummary {
  itemId: string;
  impressions: number;
  pageViews: number;
  ctr: number;
  conversionRate: number;
}

export function generateSuggestedTasks(metrics: ListingTrafficSummary[]): SuggestedTask[] {
  const suggestions: SuggestedTask[] = [];

  for (const metric of metrics) {
    // CTR < 0.5% -> Visuals update
    if (metric.ctr < 0.5) {
      suggestions.push({
        title: `Visuals: Update Primary Photo for ${metric.itemId}`,
        description: `CTR is currently ${metric.ctr.toFixed(2)}%. A stronger first photo can improve click-through rate.`,
        priority: "high",
        type: "visuals",
        itemId: metric.itemId,
      });
    }

    // Impressions < 100 over 30 days -> SEO optimization
    if (metric.impressions < 100) {
      suggestions.push({
        title: `SEO: Optimize Keywords for ${metric.itemId}`,
        description: `Impressions are low (${metric.impressions}). Consider adding more specific keywords to the title or filling out Item Specifics.`,
        priority: "medium",
        type: "seo",
        itemId: metric.itemId,
      });
    }

    // Conversion < 1% on a listing that is actually getting views -> price/offer
    if (metric.conversionRate < 1 && metric.pageViews > 10) {
      suggestions.push({
        title: `Sales: Add Best Offer / Lower Price for ${metric.itemId}`,
        description: `Conversion rate is ${metric.conversionRate.toFixed(2)}%. Review price and Best Offer settings.`,
        priority: "high",
        type: "sales",
        itemId: metric.itemId,
      });
    }
  }

  // Deduplicate by title
  const uniqueSuggestions = Array.from(new Map(suggestions.map(s => [s.title, s])).values());

  return uniqueSuggestions.slice(0, 20);
}
