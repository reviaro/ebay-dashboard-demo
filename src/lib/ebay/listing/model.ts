export type Specific = { name: string; value: string };
export type Fitment = { year: string; make: string; model: string; trim: string; engine: string; notes: string };
export type ListingInput = {
  title: string; description: string; sku: string; price: string; quantity: number;
  categoryId: string; conditionId: string; conditionDescription: string; postalCode: string;
  paymentPolicyId: string; returnPolicyId: string; fulfillmentPolicyId: string;
  specifics: Specific[]; compatibility: Fitment[]; assetIds: string[]; pictureUrls: string[];
};
export const emptyListing = (description = ''): ListingInput => ({
  title: '', description, sku: '', price: '', quantity: 1, categoryId: '', conditionId: '3000', conditionDescription: '', postalCode: '',
  paymentPolicyId: '', returnPolicyId: '', fulfillmentPolicyId: '', specifics: [{ name: 'Brand', value: '' }, { name: 'Manufacturer Part Number', value: '' }], compatibility: [], assetIds: [], pictureUrls: [],
});
export class ListingInputError extends Error {}

/** Whitelist scalar fields; never accept XML, remote IDs, or arbitrary API bodies. */
/**
 * `published` marks a draft that already has a live listing. Zero available is
 * then legitimate: a sold-out listing kept active by eBay's out-of-stock
 * control refreshes as 0, and must stay editable without inventing stock.
 */
export function parseListing(input: unknown, complete = false, published = false): ListingInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ListingInputError('Invalid listing.');
  const source = input as Record<string, unknown>;
  const result = emptyListing();
  for (const key of ['title', 'description', 'sku', 'price', 'categoryId', 'conditionId', 'conditionDescription', 'postalCode', 'paymentPolicyId', 'returnPolicyId', 'fulfillmentPolicyId'] as const) {
    const value = source[key];
    const max = key === 'description' ? 20000 : key === 'conditionDescription' ? 1000 : key === 'title' ? 80 : 100;
    if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)) throw new ListingInputError(`Invalid ${key}.`);
    result[key] = value.trim();
  }
  if (!Number.isInteger(source.quantity) || Number(source.quantity) < 0 || Number(source.quantity) > 10000) throw new ListingInputError('Quantity must be 0–10,000.');
  result.quantity = Number(source.quantity);
  for (const key of ['assetIds', 'pictureUrls'] as const) {
    const values = source[key];
    if (!Array.isArray(values) || values.length > 24 || values.some(v => typeof v !== 'string' || v.length > 500)) throw new ListingInputError('Invalid pictures.');
    result[key] = [...new Set(values)] as string[];
  }
  for (const value of result.pictureUrls) {
    try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); }
    catch { throw new ListingInputError('Picture URLs must use HTTPS.'); }
  }
  if (!Array.isArray(source.specifics) || source.specifics.length > 45) throw new ListingInputError('Use up to 45 item specifics.');
  result.specifics = source.specifics.map(s => {
    if (!s || typeof s.name !== 'string' || typeof s.value !== 'string' || s.name.length > 65 || s.value.length > 4000) throw new ListingInputError('Invalid item specific.');
    const max = s.name.trim() === 'California Prop 65 Warning' ? 800 : 65;
    const values = specificValues(s.value);
    if (values.some(value => value.length > max)) throw new ListingInputError(`Each ${s.name || 'item specific'} value must be at most ${max} characters. Use a separate line for each value.`);
    return { name: s.name.trim(), value: values.join('\n') };
  });
  const names = result.specifics.filter(s => s.value).map(s => s.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new ListingInputError('Each item specific name must be unique.');
  if (!Array.isArray(source.compatibility) || source.compatibility.length > 300) throw new ListingInputError('Use up to 300 compatible vehicles per listing.');
  result.compatibility = source.compatibility.map(row => {
    const item = {} as Fitment;
    for (const key of ['year', 'make', 'model', 'trim', 'engine', 'notes'] as const) {
      if (typeof row?.[key] !== 'string' || row[key].length > 500) throw new ListingInputError('Invalid vehicle compatibility.');
      item[key] = row[key].trim();
    }
    if (!/^\d{4}$/.test(item.year) || !item.make || !item.model) throw new ListingInputError('Each compatible vehicle needs a year, make, and model.');
    return item;
  });
  if (complete) {
    if (result.quantity < 1 && !published) throw new ListingInputError('A new listing needs an available quantity of at least 1.');
    if (!result.title || !result.description || !result.sku || result.sku.length > 50) throw new ListingInputError('Add a title, description, and SKU (up to 50 characters).');
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(result.price) || Number(result.price) <= 0) throw new ListingInputError('Enter a positive USD price with at most two decimal places.');
    for (const key of ['categoryId', 'conditionId', 'paymentPolicyId', 'returnPolicyId', 'fulfillmentPolicyId'] as const) if (!/^\d+$/.test(result[key])) throw new ListingInputError(`Choose ${key}.`);
    if (!/^\d{5}(-\d{4})?$/.test(result.postalCode)) throw new ListingInputError('Enter the item’s US ZIP code.');
    if (result.assetIds.length + result.pictureUrls.length < 1 || result.assetIds.length + result.pictureUrls.length > 24) throw new ListingInputError('Add 1–24 photos.');
    if (!result.conditionDescription) throw new ListingInputError('Describe the used part’s condition.');
  }
  return result;
}

export const xml = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const tag = (name: string, value: unknown) => `<${name}>${xml(value)}</${name}>`;
export const specificValues = (value: string): string[] => value.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
export const descriptionHtml = (text: string) => `<p>${xml(text).replace(/\n/g, '<br>')}</p>`;
export function itemXml(item: ListingInput, photos: string[], options: { uuid?: string; listingId?: string; soldQuantity?: number } = {}): string {
  const revise = !!options.listingId;
  return '<Item>' + (revise ? tag('ItemID', options.listingId) : tag('UUID', options.uuid)) +
    tag('Title', item.title) + tag('Description', descriptionHtml(item.description)) +
    tag('SKU', item.sku) + tag('InventoryTrackingMethod', 'SKU') + tag('StartPrice', item.price) + tag('Quantity', item.quantity + (options.soldQuantity ?? 0)) +
    (!revise ? '<ListingType>FixedPriceItem</ListingType><ListingDuration>GTC</ListingDuration><Country>US</Country><Currency>USD</Currency><Site>US</Site>' : '') +
    '<PrimaryCategory>' + tag('CategoryID', item.categoryId) + '</PrimaryCategory>' + tag('ConditionID', item.conditionId) + tag('ConditionDescription', item.conditionDescription) + tag('PostalCode', item.postalCode) +
    '<SellerProfiles><SellerPaymentProfile>' + tag('PaymentProfileID', item.paymentPolicyId) + '</SellerPaymentProfile><SellerReturnProfile>' + tag('ReturnProfileID', item.returnPolicyId) + '</SellerReturnProfile><SellerShippingProfile>' + tag('ShippingProfileID', item.fulfillmentPolicyId) + '</SellerShippingProfile></SellerProfiles>' +
    '<PictureDetails>' + photos.map(p => tag('PictureURL', p)).join('') + '</PictureDetails>' +
    '<ItemSpecifics>' + item.specifics.filter(s => s.name && s.value).map(s => '<NameValueList>' + tag('Name', s.name) + specificValues(s.value).map(v => tag('Value', v)).join('') + '</NameValueList>').join('') + '</ItemSpecifics>' +
    (item.compatibility.length ? '<ItemCompatibilityList>' + (revise ? '<ReplaceAll>true</ReplaceAll>' : '') + item.compatibility.map(v => '<Compatibility>' + (v.notes ? tag('CompatibilityNotes', v.notes) : '') + Object.entries(v).filter(([k, value]) => k !== 'notes' && value).map(([key, value]) => '<NameValueList>' + tag('Name', key[0].toUpperCase() + key.slice(1)) + tag('Value', value) + '</NameValueList>').join('') + '</Compatibility>').join('') + '</ItemCompatibilityList>' : '') + '</Item>';
}
