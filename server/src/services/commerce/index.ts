import type { CommerceProvider } from './CommerceProvider.js';
import { MockCommerceProvider } from './MockCommerceProvider.js';
import { ShopifyProvider } from './ShopifyProvider.js';
import { CommerceError } from './CommerceProvider.js';

// Shopify when credentials are present, mock otherwise. Never throws for a
// missing store — the mock keeps the app (and tests) runnable offline.
export function getCommerceProvider(): CommerceProvider {
  if (process.env.SHOPIFY_STORE_URL && process.env.SHOPIFY_ACCESS_TOKEN) {
    try {
      return new ShopifyProvider();
    } catch (e) {
      if (!(e instanceof CommerceError)) throw e;
    }
  }
  return new MockCommerceProvider();
}

export function getCommerceProviderName(): string {
  return getCommerceProvider().name;
}
