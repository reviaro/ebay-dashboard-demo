import { assertLiveIntegrationAllowed } from '../../demo/server';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { EbayConfig } from '../config';
import { redactString } from '../redact';
import { assertListingWrite } from './write-access';

export class TradingError extends Error {
  uncertain: boolean;
  /** False when eBay gave no usable answer (network failure, unverifiable or incomplete response). */
  answered: boolean;
  constructor(message: string, uncertain = false, answered = true) { super(message); this.name = 'TradingError'; this.uncertain = uncertain; this.answered = answered; }
}
export const asArray = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
export const xmlValue = (value: any): string => String(value?.['#text'] ?? value ?? '');
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: true });
const READ_CALLS = new Set(['GetUser', 'GetItem', 'VerifyAddFixedPriceItem']);
const WRITE_CALLS = new Set(['AddFixedPriceItem', 'ReviseFixedPriceItem']);

async function call(config: EbayConfig, token: string, method: string, body: string, write: boolean): Promise<Record<string, any>> {
  assertLiveIntegrationAllowed();
  if (!(write ? WRITE_CALLS : READ_CALLS).has(method)) throw new Error('Unsupported Trading API operation.');
  if (config.marketplaceId !== 'EBAY_US') throw new Error('The listing composer currently supports eBay US only.');
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}/ws/api.dll`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000), cache: 'no-store',
      headers: { 'Content-Type': 'text/xml', 'X-EBAY-API-CALL-NAME': method, 'X-EBAY-API-SITEID': '0', 'X-EBAY-API-COMPATIBILITY-LEVEL': '1489', 'X-EBAY-API-IAF-TOKEN': token },
      body: `<?xml version="1.0" encoding="utf-8"?><${method}Request xmlns="urn:ebay:apis:eBLBaseComponents"><ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel>${body}</${method}Request>`,
    });
    const text = await response.text();
    if (!response.ok || text.length > 4_000_000 || /<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new TradingError(`eBay response could not be verified (${response.status}).`, write, false);
    const result = parser.parse(text)?.[`${method}Response`];
    if (!result?.Ack) throw new TradingError('eBay returned an incomplete response.', write, false);
    if (!['Success', 'Warning'].includes(result.Ack)) {
      const message = asArray<any>(result.Errors).map(e => `${e.ErrorCode ?? ''}: ${xmlValue(e.LongMessage || e.ShortMessage)}`).join('; ');
      throw new TradingError(redactString(message.split(token).join('[REDACTED]')).slice(0, 2000) || 'eBay rejected the listing.', write && (result.Ack === 'PartialFailure' || asArray<any>(result.Errors).some(e => e.ErrorClassification === 'SystemError' || /duplicate/i.test(xmlValue(e.LongMessage)))));
    }
    return result;
  } catch (error) {
    if (error instanceof TradingError) throw error;
    throw new TradingError('The connection to eBay was interrupted. Check the operation status before trying again.', write, false);
  }
}
export function tradingRead(config: EbayConfig, token: string, method: 'GetUser' | 'GetItem' | 'VerifyAddFixedPriceItem', body: string) {
  assertLiveIntegrationAllowed();
  return call(config, token, method, body, false);
}
export async function tradingWrite(config: EbayConfig, token: string, method: 'AddFixedPriceItem' | 'ReviseFixedPriceItem', body: string, accountId: string) {
  assertLiveIntegrationAllowed();
  // Refused before anything is sent, so the outcome is certain: nothing reached eBay.
  try { await assertListingWrite(accountId); }
  catch (error) { throw new TradingError(error instanceof Error ? error.message : 'Listing writes are not permitted.', false); }
  return call(config, token, method, body, true);
}
