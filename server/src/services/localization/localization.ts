// Reusable {{variable}} template renderer. Unknown variables are left in
// place and reported so callers can decide (strict voice replies should fail
// loudly in logs, never to the customer).
export interface RenderResult {
  text: string;
  missing: string[];
}

export function renderTemplate(template: string, vars: Record<string, string | number>): RenderResult {
  const missing: string[] = [];
  const text = template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, key: string) => {
    if (vars[key] === undefined || vars[key] === null) {
      missing.push(key);
      return match;
    }
    return String(vars[key]);
  });
  return { text, missing };
}

export function formatINR(n: number): string {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}
