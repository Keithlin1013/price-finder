import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { noul, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Offer } from "./stores";

// Why an offer is not the same product: the first check it failed.
export type Mismatch = "brand" | "line" | "variant" | "form" | null;
export type Checks = { names_brand: number; brand: number; line: number; variant: number; form: number };
export type Judged = Offer & { same: number; perUnit: number | null; checks: Checks; mismatch: Mismatch };

const client = new TypeSafeClient({
  timeout: 60000,
  retry: { maxRetries: 4, backoffInitialMs: 1000, backoffMaxMs: 10000 },
});

// Four narrow checks instead of one broad "is this the same product" question: a broad question
// swung between runs, and a narrow one also says which part failed. Package size and pack count
// are deliberately not checked, because the page compares prices per unit.
const RULES = {
  brand: "The maker's brand name, such as Cascade, Tide, Softsoap or Kirkland Signature.",
  names_brand:
    "Some store titles leave the maker's name out, e.g. \"Platinum Pods Dishwasher Detergent - Fresh\". A product line " +
    "name alone (Platinum, Ultra) is not a brand name.",
  line:
    "The named product line within the brand, with every qualifier word: Platinum, Platinum Plus, Complete, Ultra, " +
    "Ultra Oxi, PRO, Commercial, Advanced, Free & Clear are all different lines. Words about the package are not part " +
    "of the line: counts, sizes, pack counts, and container words such as pods, pacs, ActionPacs, tabs, bottle, refill.",
  variant:
    "Scent, flavor, color or formula variant, such as Fresh, Lemon, Mountain, Original, Aloe Vera or Free & Gentle. " +
    "When either title states no variant, treat the variant as compatible, not different.",
  form: "Physical form: liquid, powder, gel, pods (pods, pacs, ActionPacs and tabs are one form), bar, spray, sheets.",
};

const QUESTIONS = {
  names_brand: (i: number) => `Does \`offers[${i}].title\` name a maker's brand, as described in \`rules.names_brand\`?`,
  brand: (i: number) => `Is \`offers[${i}]\` the same brand as \`wanted\`, as defined in \`rules.brand\`?`,
  line: (i: number) => `Is \`offers[${i}]\` the same product line as \`wanted\`, as defined in \`rules.line\`?`,
  variant: (i: number) => `Is the variant of \`offers[${i}]\` compatible with \`wanted\`, as defined in \`rules.variant\`?`,
  form: (i: number) => `Is \`offers[${i}]\` the same physical form as \`wanted\`, as defined in \`rules.form\`?`,
};

const BATCH = 20;
const CONCURRENCY = 2;
const VERDICTS = path.join(process.cwd(), ".cache", "verdicts");

// Verdicts are kept per (wanted, title): the same listing gets the same answer on every run.
async function loadVerdicts(wanted: string): Promise<Record<string, Checks>> {
  try {
    return JSON.parse(await readFile(verdictFile(wanted), "utf8"));
  } catch {
    return {};
  }
}

// Keyed by the rules and questions too, so changing a rule re-judges instead of reusing old answers.
const RULES_KEY = createHash("sha1").update(JSON.stringify(RULES) + Object.values(QUESTIONS).map((q) => q(0)).join()).digest("hex").slice(0, 8);

function verdictFile(wanted: string) {
  const id = createHash("sha1").update(`${RULES_KEY}:${wanted.trim().toLowerCase()}`).digest("hex").slice(0, 16);
  return path.join(VERDICTS, `${id}.json`);
}

async function judgeBatch(wanted: string, titles: string[]): Promise<Checks[]> {
  const questions: Record<string, ReturnType<typeof noul>> = {};
  titles.forEach((_, i) => {
    for (const k of Object.keys(QUESTIONS) as (keyof Checks)[]) questions[`${k}_${i}`] = noul(QUESTIONS[k](i));
  });
  const { answers } = await client.systemOne({
    state: { wanted, rules: RULES, offers: titles.map((title) => ({ title })) },
    questions,
  });
  const p = (id: string) => {
    const a = answers[id];
    return a.type === "noul" ? a.noul : 0;
  };
  return titles.map((_, i) => ({
    names_brand: p(`names_brand_${i}`),
    // A title that names no brand cannot contradict the wanted one; the line check decides it.
    brand: p(`names_brand_${i}`) < 0.5 ? 1 : p(`brand_${i}`),
    line: p(`line_${i}`),
    variant: p(`variant_${i}`),
    form: p(`form_${i}`),
  }));
}

export async function judge(wanted: string, offers: Offer[]): Promise<Judged[]> {
  if (offers.length === 0) return [];
  const known = await loadVerdicts(wanted);
  // Only titles never judged for this query go to TypeSafe, sorted so a batch's content is stable.
  const fresh = [...new Set(offers.map((o) => o.title))].filter((t) => !known[t]).sort();
  const batches = Array.from({ length: Math.ceil(fresh.length / BATCH) }, (_, b) => fresh.slice(b * BATCH, (b + 1) * BATCH));
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const group = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(group.map((titles) => judgeBatch(wanted, titles)));
    group.forEach((titles, g) => titles.forEach((t, j) => (known[t] = results[g][j])));
  }
  if (fresh.length) {
    await mkdir(VERDICTS, { recursive: true });
    await writeFile(verdictFile(wanted), JSON.stringify(known));
  }
  return offers.map((o) => {
    const checks = known[o.title];
    const order = ["brand", "line", "form", "variant"] as const;
    const mismatch = (order.find((k) => checks[k] < 0.5) as Mismatch) ?? null;
    return {
      ...o,
      checks,
      mismatch,
      same: Math.min(checks.brand, checks.line, checks.variant, checks.form),
      perUnit: o.price !== null ? Math.round((o.price / o.packCount) * 100) / 100 : null,
    };
  });
}
