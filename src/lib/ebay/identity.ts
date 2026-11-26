import { assertLiveIntegrationAllowed } from '../demo/server';
import type { EbayConfig } from './config';
import { OAuthFlowError } from './oauth-service';
import { tradingRead } from './listing/trading';

export async function identifySeller(config: EbayConfig, accessToken: string): Promise<{ sellerId: string; username: string }> {
  assertLiveIntegrationAllowed();
  const response = await fetch(`${config.financeApiBaseUrl}/commerce/identity/v1/user/`, {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000), cache: 'no-store', redirect: 'error',
  });
  if (!response.ok) throw new OAuthFlowError('Unable to verify the eBay seller identity. Reconnect and grant the identity permission.');
  const body = await response.json();
  if (typeof body.userId !== 'string' || typeof body.username !== 'string') throw new OAuthFlowError('eBay did not return a seller identity.');
  return { sellerId: body.userId, username: body.username };
}

export async function legacySellerUsername(config: EbayConfig, token: string): Promise<string> {
  assertLiveIntegrationAllowed();
  const result = await tradingRead(config, token, 'GetUser', '<DetailLevel>ReturnAll</DetailLevel>');
  const username = result.User?.UserID;
  if (typeof username !== 'string' || !username) throw new OAuthFlowError('The original seller could not be verified. The existing store connection was preserved.');
  return username;
}
