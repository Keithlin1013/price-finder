import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { noul, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Offer } from "./stores";

// Why an offer did not qualify: the first check it failed.
export type Mismatch = "kind" | "brand" | "line" | "variant" | "form" | null;
export type Checks = { names_brand: number; brand: number; line: number; variant: number; form: number; kind: number };
export type Judged = Offer & { same: number; perUnit: number | null; checks: Checks; mismatch: Mismatch };

// exact: the same product (brand, line, variant, form); size may differ.
// similar: the same kind of product, held to the brand or variant only when the query names one.
export type Scope = "exact" | "similar";

// Facts about the query itself, asked once per query.
type Wanted = { specific: number; names_brand: number };

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
    "The named product line within the brand. Named sub-line words count even when only one title has them: Platinum, " +
    "Platinum Plus, Complete, Ultra, Ultra Concentrated, Oxi, PRO, Commercial, Advanced, Antibacterial, Simply, " +
    "Free & Clear are all different lines. Generic descriptive words do not make a different line when one title " +
    "simply leaves them out: Moisturizing, Liquid, Hand Soap, Laundry Detergent, Dishwasher Detergent, Kitchen and " +
    "Bathroom. Words about the package are not part of the line either: counts, sizes, pack counts, and container " +
    "words such as pods, pacs, ActionPacs, tabs, bottle, pump, refill, easy pour spout. Scents and design series " +
    "(Aquarium Series, Warm Vanilla) are variants, not lines. When the brand matches and neither title has a named " +
    "sub-line word, the line is the same.",
  variant:
    "Scent, flavor, color, formula or design series, such as Fresh, Lemon, Mountain, Original, Aloe Vera, Aquarium " +
    "Series, Warm Vanilla and Coconut Milk, or Free & Gentle. Two different named variants are not compatible. When " +
    "either title states no variant at all, treat the variant as compatible, not different.",
  form:
    "Physical form: liquid, powder, gel, pods (pods, pacs, ActionPacs and tabs are one form), bar, spray, sheets. " +
    "When `wanted` states no form, treat the form as compatible.",
  kind:
    "The kind of product and what it is used for: laundry detergent, dishwasher detergent, dish soap, hand soap, " +
    "shampoo, cheese slices, and so on. Brand, line, scent, form and size do not matter for the kind. Accessories, " +
    "refills of a different product, and bundles of different products are a different kind.",
  specific:
    "A query is specific when it names one product line: a brand plus a named line (\"Cascade Platinum\", \"Tide " +
    "Ultra Concentrated\"), a full product title, or a barcode. A brand alone (\"Tide detergent\") or a kind of product " +
    "(\"hand soap refill\") is not specific.",
};

const QUESTIONS = {
  names_brand: (i: number) => `Does \`offers[${i}].title\` name a maker's brand, as described in \`rules.names_brand\`?`,
  brand: (i: number) => `Is \`offers[${i}]\` the same brand as \`wanted\`, as defined in \`rules.brand\`?`,
  line: (i: number) => `Is \`offers[${i}]\` the same product line as \`wanted\`, as defined in \`rules.line\`?`,
  variant: (i: number) => `Is the variant of \`offers[${i}]\` compatible with \`wanted\`, as defined in \`rules.variant\`?`,
  form: (i: number) => `Is \`offers[${i}]\` the same physical form as \`wanted\`, as defined in \`rules.form\`?`,
  kind: (i: number) => `Is \`offers[${i}]\` the same kind of product as \`wanted\`, as defined in \`rules.kind\`?`,
};

const WANTED_QUESTIONS = {
  specific: noul("Is `wanted` a specific product, as defined in `rules.specific`?"),
  names_brand: noul("Does `wanted` name a maker's brand, as described in `rules.names_brand`?"),
};

const BATCH = 20;
const CONCURRENCY = 2;
const VERDICTS = path.join(process.cwd(), ".cache", "verdicts");

// Verdicts are kept per (wanted, title): the same listing gets the same answer on every run.
// The query's own facts are stored under WANTED_KEY in the same file.
const WANTED_KEY = "__wanted__";

async function loadVerdicts(wanted: string): Promise<Record<string, any>> {
  try {
    return JSON.parse(await readFile(verdictFile(wanted), "utf8"));
  } catch {
    return {};
  }
}

// Keyed by the rules and questions too, so changing a rule re-judges instead of reusing old answers.
const RULES_KEY = createHash("sha1")
  .update(JSON.stringify(RULES) + Object.values(QUESTIONS).map((q) => q(0)).join() + JSON.stringify(WANTED_QUESTIONS))
  .digest("hex")
  .slice(0, 8);

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
    kind: p(`kind_${i}`),
  }));
}

async function judgeWanted(wanted: string): Promise<Wanted> {
  const { answers } = await client.systemOne({ state: { wanted, rules: RULES }, questions: WANTED_QUESTIONS });
  const p = (id: keyof typeof WANTED_QUESTIONS) => {
    const a = answers[id];
    return a.type === "noul" ? a.noul : 0;
  };
  return { specific: p("specific"), names_brand: p("names_brand") };
}

// Combine one offer's checks under a scope; returns the score and the first failed check.
function verdict(c: Checks, scope: Scope, w: Wanted): { same: number; mismatch: Mismatch } {
  const parts: [Exclude<Mismatch, null>, number][] =
    scope === "exact"
      ? [["kind", c.kind], ["brand", c.brand], ["line", c.line], ["form", c.form], ["variant", c.variant]]
      : [
          ["kind", c.kind],
          // A query with no brand ("hand soap refill") accepts every brand.
          ["brand", w.names_brand >= 0.5 ? c.brand : 1],
          ["form", c.form],
          ["variant", c.variant],
        ];
  return { same: Math.min(...parts.map(([, v]) => v)), mismatch: parts.find(([, v]) => v < 0.5)?.[0] ?? null };
}

export async function judge(
  wanted: string,
  offers: Offer[],
  requested: Scope | "auto" = "auto",
  barcode = false,
): Promise<{ judged: Judged[]; scope: Scope }> {
  if (offers.length === 0) return { judged: [], scope: requested === "auto" ? "exact" : requested };
  const known = await loadVerdicts(wanted);
  const wantedFresh = !known[WANTED_KEY];
  if (wantedFresh) known[WANTED_KEY] = await judgeWanted(wanted);
  const w: Wanted = known[WANTED_KEY];
  // A barcode names one product; otherwise a broad query ("Tide detergent") is compared by kind.
  const scope: Scope = requested !== "auto" ? requested : barcode || w.specific >= 0.5 ? "exact" : "similar";
  // Only titles never judged for this query go to TypeSafe, sorted so a batch's content is stable.
  const fresh = [...new Set(offers.map((o) => o.title))].filter((t) => !known[t]).sort();
  const batches = Array.from({ length: Math.ceil(fresh.length / BATCH) }, (_, b) => fresh.slice(b * BATCH, (b + 1) * BATCH));
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const group = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(group.map((titles) => judgeBatch(wanted, titles)));
    group.forEach((titles, g) => titles.forEach((t, j) => (known[t] = results[g][j])));
  }
  if (fresh.length || wantedFresh) {
    await mkdir(VERDICTS, { recursive: true });
    await writeFile(verdictFile(wanted), JSON.stringify(known));
  }
  const judged = offers.map((o) => {
    const checks: Checks = known[o.title];
    return {
      ...o,
      checks,
      ...verdict(checks, scope, w),
      perUnit: o.price !== null ? Math.round((o.price / o.packCount) * 100) / 100 : null,
    };
  });
  return { judged, scope };
}
