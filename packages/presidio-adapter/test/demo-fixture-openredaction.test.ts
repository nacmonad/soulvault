import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenRedaction } from "openredaction";
import { describe, expect, it } from "vitest";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/demo-referral.txt"),
  "utf8",
);

describe("demo referral fixture (OpenRedaction)", () => {
  it("snapshots entity types on the recording note", async () => {
    // Regex-only: do not enable NER / hosted AI (no model download).
    const redactor = new OpenRedaction({ enableNER: false });
    // Fail closed: a throw from detect() fails this test.
    const result = await redactor.detect(fixture);
    const types = [...new Set(result.detections.map((d) => d.type))].sort();
    expect(types).toMatchInlineSnapshot(`
      [
        "CREDIT_CARD",
        "DATE",
        "IBAN",
        "INSTAGRAM_USERNAME",
      ]
    `);

    const has = (re: RegExp) => types.some((t) => re.test(t));
    // email/phone/iban/card are the structured targets; PERSON/NAME may miss.
    expect({
      email: has(/EMAIL/),
      phone: has(/PHONE/),
      iban: has(/IBAN/),
      card: has(/CREDIT_CARD|CARD/),
      person: has(/^(NAME|PERSON)$/),
    }).toMatchInlineSnapshot(`
      {
        "card": true,
        "email": false,
        "iban": true,
        "person": false,
        "phone": false,
      }
    `);
  });
});
