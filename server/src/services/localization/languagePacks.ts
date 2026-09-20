import type { MerchantLanguage } from '../merchants/merchants.js';
import { renderTemplate } from './localization.js';

// Reusable reply templates per language — the prompt-hygiene lever for call
// quality. The merchant profile selects the pack; callers never branch on
// language inline. English is the default pack.
type Pack = Record<string, string>;

const en: Pack = {
  greeting: "Hi! I'm your shopping assistant. What are you looking for today?",
  noResults: 'Sorry, I found nothing in that budget. Want to raise it a bit?',
  searchSummary: 'I found {{count}} option{{plural}}. Cheapest is {{cheapest}}. Want details?',
  orderStatus: 'Your order {{order_id}} is {{order_status}}, worth {{order_total}}. Expected {{estimated_delivery}}.',
  orderNotFound: "Sorry, I couldn't find that order. Could you check the id?",
  invAvailable: "Yes, it's available — {{quantity}} in stock. Want to order?",
  invOutOfStock: 'Sorry, that size is currently out of stock. Want to try another size?',
  invUnknown: "Sorry, I couldn't check stock for that. Which product did you mean?",
  priceBadDiscount: 'Sorry, that discount code is not valid. Want the total without it?',
  priceError: "Sorry, I couldn't calculate the price. Which product did you mean?",
  priceTotal: 'Your total is {{total}} — {{quantity}} items, discount {{discount}}, shipping {{shipping}}. Shall I place the order?',
  detailsMissing: "Sorry, I couldn't pull up those details.",
  orderStage: 'I can place the order for {{quantity}} x {{product}} totalling {{total}}. Say yes to confirm, or no to cancel.',
  orderCancelled: 'No problem, I cancelled that order. Anything else?',
  orderPlaced: 'Done! Your order {{order_id}} is confirmed, worth {{total}}. Expected in 3 days.',
  orderFailed: "Sorry, I couldn't place that order. Want to try again?",
  orderStockout: 'Sorry, it just went out of stock. Want me to find an alternative?',
  knowledgeLead: 'Based on our policy',
  knowledgeMissing: "I don't have that information. Want help with products or orders?",
};

const hinglish: Pack = {
  greeting: 'Namaste! Main aapka shopping assistant hoon. Aap kya dhoondh rahe hain?',
  noResults: 'Sorry, is budget mein kuch nahi mila. Budget thoda badha kar dekhein?',
  searchSummary: 'Haan, {{count}} option{{plural}} mile hain. Sabse affordable {{cheapest}} ka hai. Kya main uske details bataun?',
  orderStatus: 'Aapka order {{order_id}} {{order_status}} hai, {{order_total}} ka. {{estimated_delivery}} tak pahunchna chahiye.',
  orderNotFound: 'Sorry, is order id ka koi order nahi mila. Id check karke dobara batayein?',
  invAvailable: 'Haan, available hai — {{quantity}} piece stock mein hain. Order karna chahenge?',
  invOutOfStock: 'Sorry, ye size abhi out of stock hai. Koi aur size dekhun?',
  invUnknown: 'Sorry, us product ka stock check nahi ho paya. Product ka naam batayein?',
  priceBadDiscount: 'Sorry, ye discount code valid nahi hai. Bina discount ke total bataun?',
  priceError: 'Sorry, price calculate nahi ho paya. Product confirm karein?',
  priceTotal: 'Total {{total}} hoga — {{quantity}} piece, discount {{discount}}, delivery {{shipping}}. Order karun?',
  detailsMissing: 'Sorry, us product ki details nahi mil payi.',
  orderStage: '{{quantity}} x {{product}}, kul {{total}} ka order place kar dun? Haan ya na mein jawab dein.',
  orderCancelled: 'Koi baat nahi, order cancel kar diya. Aur kuch chahiye?',
  orderPlaced: 'Ho gaya! Aapka order {{order_id}} confirm ho gaya, kul {{total}}. 3 din mein pahunch jayega.',
  orderFailed: 'Sorry, order place nahi ho paya. Dobara try karein?',
  orderStockout: 'Sorry, ye abhi stock se bahar ho gaya. Koi aur option dekhun?',
  knowledgeLead: 'Hamari policy ke anusaar',
  knowledgeMissing: 'Ye jaankari mere paas nahi hai. Products ya orders mein madad karun?',
};

const PACKS: Record<MerchantLanguage, Pack> = { en, hinglish };

export function say(lang: MerchantLanguage, key: string, vars: Record<string, string | number> = {}): string {
  const pack = PACKS[lang] ?? PACKS.en;
  return renderTemplate(pack[key] ?? PACKS.en[key] ?? key, vars).text;
}
