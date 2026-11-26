import { describe, expect, it } from 'vitest';
import { generateSuggestedTasks, type ListingTrafficSummary } from './task-generator';

// A listing that is healthy on every axis, so a single overridden field is what
// drives any suggestion. Rates are percentages, matching aggregateListings.
const listing = (o: Partial<ListingTrafficSummary> = {}): ListingTrafficSummary => ({
  itemId: '100000000020',
  impressions: 5000,
  pageViews: 120,
  ctr: 2.4,
  conversionRate: 3.1,
  ...o,
});

describe('generateSuggestedTasks', () => {
  it('flags a visuals update when CTR is below 0.5%', () => {
    const tasks = generateSuggestedTasks([listing({ ctr: 0.3 })]);
    expect(tasks.map((t) => t.type)).toContain('visuals');
  });

  it('leaves CTR alone at a healthy percentage', () => {
    const tasks = generateSuggestedTasks([listing({ ctr: 2.4 })]);
    expect(tasks.map((t) => t.type)).not.toContain('visuals');
  });

  it('flags SEO work when 30-day impressions are below 100', () => {
    const tasks = generateSuggestedTasks([listing({ impressions: 40 })]);
    expect(tasks.map((t) => t.type)).toContain('seo');
  });

  it('does not flag SEO for a listing with real impression volume', () => {
    const tasks = generateSuggestedTasks([listing({ impressions: 5000 })]);
    expect(tasks.map((t) => t.type)).not.toContain('seo');
  });

  it('flags a price/offer review when conversion is weak despite views', () => {
    const tasks = generateSuggestedTasks([listing({ conversionRate: 0.4, pageViews: 40 })]);
    expect(tasks.map((t) => t.type)).toContain('sales');
  });

  it('does not flag conversion on a listing with almost no views', () => {
    const tasks = generateSuggestedTasks([listing({ conversionRate: 0, pageViews: 3 })]);
    expect(tasks.map((t) => t.type)).not.toContain('sales');
  });

  it('names the listing it is talking about', () => {
    const [task] = generateSuggestedTasks([listing({ itemId: '999', ctr: 0.1 })]);
    expect(task.itemId).toBe('999');
    expect(task.title).toContain('999');
  });

  it('deduplicates identical suggestions and caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => listing({ itemId: `id-${i}`, ctr: 0.1 }));
    const tasks = generateSuggestedTasks([...many, ...many]);
    expect(tasks.length).toBeLessThanOrEqual(20);
  });
});
