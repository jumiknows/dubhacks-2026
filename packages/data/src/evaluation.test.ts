import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { sha256 } from "./hash";
import frozen from "../../../data/evaluation/frozen-cases.json";
describe("frozen briefing review set", () => {
  it("has 12 valid cases with explicit real/synthetic and development/holdout separation", () => {
    const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync("data/schemas/briefing-case.schema.json", "utf8")));
    expect(frozen.cases).toHaveLength(12);
    expect(frozen.cases.filter((entry) => entry.synthetic)).toHaveLength(6);
    expect(frozen.cases.filter((entry) => entry.split === "held-out")).toHaveLength(4);
    for (const entry of frozen.cases) {
      const bytes = readFileSync(entry.path); const value = JSON.parse(bytes.toString());
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
      expect(sha256(bytes)).toBe(entry.sha256);
      expect(value.synthetic).toBe(entry.synthetic);
      expect(value.reviews).toEqual([]);
    }
  });
});
