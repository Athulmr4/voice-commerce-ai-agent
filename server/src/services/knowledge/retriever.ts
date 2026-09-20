import { POLICIES_MD } from './policies.js';

// Lexical retrieval (BM25-style TF-IDF) over merchant knowledge chunks.
// No vector DB: at this catalog scale, scored term overlap is cheaper, faster,
// and fully deterministic. The retriever interface allows swapping in
// embeddings later without touching tools or the pipeline.
export interface KnowledgeHit {
  title: string;
  text: string;
  score: number;
}

const STOP = new Set('a,an,the,and,or,of,to,in,is,are,what,how,when,do,does,me,my,i,it,for,on,with,by,please,tell,about,ka,ki,ke,hai,hain,mein,ko,kaun,kya'.split(','));

// Commerce synonyms so "delivery charges" finds the Shipping section.
const SYNONYMS: Record<string, string[]> = {
  delivery: ['ship', 'shipping'],
  shipping: ['ship', 'delivery'],
  charges: ['charge', 'cost', 'fee', 'price'],
  charge: ['charges', 'cost', 'fee', 'price'],
  return: ['returns', 'refund', 'refunds', 'exchange'],
  returns: ['return', 'refund', 'exchange'],
  refund: ['refunds', 'return', 'returns'],
  policy: ['policies', 'rule'],
};

function stem(t: string): string {
  return t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t;
}

function tokens(s: string): string[] {
  const base = s.toLowerCase().split(/[^a-z0-9₹]+/).filter(t => t && !STOP.has(t)).map(stem);
  const expanded = [...base];
  for (const t of base) {
    for (const syn of SYNONYMS[t] ?? []) {
      if (!STOP.has(syn)) expanded.push(stem(syn));
    }
  }
  return expanded;
}

interface Chunk {
  title: string;
  text: string;
  terms: Map<string, number>;
}

let chunks: Chunk[] | null = null;
let idf: Map<string, number> = new Map();

function loadChunks(): Chunk[] {
  if (chunks) return chunks;
  const raw = POLICIES_MD;
  const parts = raw.split(/^## /m).slice(1);
  chunks = parts.map(p => {
    const [title, ...rest] = p.split('\n');
    const text = rest.join(' ').replace(/\s+/g, ' ').trim();
    const terms = new Map<string, number>();
    for (const t of tokens(`${title} ${text}`)) terms.set(t, (terms.get(t) ?? 0) + 1);
    return { title: title.trim(), text, terms };
  });
  const df = new Map<string, number>();
  for (const c of chunks) {
    for (const t of c.terms.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  idf = new Map([...df.entries()].map(([t, d]) => [t, Math.log(1 + chunks!.length / d)]));
  return chunks;
}

export function searchKnowledge(query: string, limit = 2): KnowledgeHit[] {
  const docs = loadChunks();
  const scored = docs.map(c => {
    let score = 0;
    for (const t of tokens(query)) {
      const tf = c.terms.get(t) ?? 0;
      if (tf > 0) score += (1 + Math.log(tf)) * (idf.get(t) ?? 0);
    }
    return { title: c.title, text: c.text, score: Math.round(score * 100) / 100 };
  });
  return scored.filter(h => h.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
