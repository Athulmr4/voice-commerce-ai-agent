export type Intent = 'product_search' | 'product_details' | 'inventory_check' | 'price_check' | 'order_status' | 'place_order' | 'chitchat' | 'unclear';

export interface SessionContext {
  category?: string;
  maxPrice?: number;
  minPrice?: number;
  color?: string;
  brand?: string;
  size?: string;
  productId?: string;
  /** Top product ids from the last successful search/details call. Enables "tell me more" follow-ups. */
  lastProductIds?: string[];
  /** Unconfirmed order awaiting an explicit yes. Never executed without confirmation. */
  pendingOrder?: { productId: string; size?: string; quantity: number; discountCode?: string; total?: number };
  history?: { role: 'user' | 'assistant'; text: string }[];
}

export interface LLMExtraction {
  intent: Intent;
  entities: {
    category?: string | null;
    maxPrice?: number | null;
    minPrice?: number | null;
    color?: string | null;
    brand?: string | null;
    size?: string | null;
    productId?: string | null;
    orderId?: string | null;
    quantity?: number | null;
  };
}

export interface LLMProvider {
  readonly name: string;
  extract(text: string, context: SessionContext): Promise<LLMExtraction>;
  reply(args: {
    text: string;
    extraction: LLMExtraction;
    context: SessionContext;
    toolSummary: string;
  }): Promise<string>;
  /** True function-calling: model picks tool + args. Only implemented by cloud providers. */
  decideTool?(text: string, context: SessionContext): Promise<{ name: string; args: Record<string, unknown> }>;
}
