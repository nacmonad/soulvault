import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { analyzePatterns } from "../src/analyzer.ts";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/demo-referral.txt"),
  "utf8",
);

describe("demo referral fixture (presidio-web patterns)", () => {
  it("flags email, phone, IBAN, and card on the recording note", () => {
    const hits = analyzePatterns(fixture);
    const types = [...new Set(hits.map((h) => h.entityType))].sort();
    expect(types).toEqual(["CREDIT_CARD", "EMAIL_ADDRESS", "IBAN_CODE", "PHONE_NUMBER"]);
    // Pattern engine has no PERSON recognizer — names are GLiNER/author.
  });
});
