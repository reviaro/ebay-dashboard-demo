import { DEMO_STORE_ID, DEMO_STORE_NAME } from './config';

export const DEMO_STORE = {
  id: DEMO_STORE_ID,
  name: DEMO_STORE_NAME,
  role: 'viewer',
  marketplaceId: 'EBAY_US',
  writeEnabled: false,
  descriptionTemplate: '',
} as const;
