/** Public, non-sensitive constants. Never infer authorization from client state. */
export const DEMO_DATE = '2026-09-30';
export const DEMO_AS_OF = '2026-09-30T23:59:59.999Z';
export const DEMO_STORE_NAME = 'Northstar Sample Parts';
export const DEMO_STORE_ID = 'northstar';
export const DEMO_QUESTIONS = [
  'Which brands made the most profit last quarter?',
  'Where is ad spend not paying off?',
  'Which listings get views but no sales?',
  'What should I relist or reprice this week?',
  'How did eBay fees change over the year?',
] as const;
