import { describe, expect, expectTypeOf, it } from "vitest";
import { defineSchema, type Infer } from "../src/index.ts";

const Product = defineSchema({
  name: { type: String, required: true, trim: true },
  sku: { type: String, match: /^[A-Z0-9-]+$/, uppercase: true },
  price: { type: Number, min: 0 },
  status: { type: String, enum: ["draft", "live"], default: "draft" },
  inStock: Boolean,
  releasedAt: Date,
  tags: [String],
  size: { width: Number, height: { type: Number, required: true } },
});

const validate = (schema: { "~standard": { validate: (v: unknown) => unknown } }, value: unknown) =>
  schema["~standard"].validate(value) as { value?: unknown; issues?: { path?: PropertyKey[] }[] };

describe("defineSchema", () => {
  it("validates, transforms, fills defaults and drops unknown fields", () => {
    expect(
      validate(Product, {
        name: "  Pen ",
        sku: "ab-1",
        price: 2,
        releasedAt: "2026-01-01",
        tags: ["x"],
        size: { height: 3 },
        extra: true,
      }).value,
    ).toEqual({
      name: "Pen",
      sku: "AB-1",
      price: 2,
      status: "draft",
      releasedAt: new Date("2026-01-01"),
      tags: ["x"],
      size: { height: 3 },
    });
  });

  it("reports every problem with its path", () => {
    const { issues } = validate(Product, {
      price: -1,
      status: "gone",
      tags: [1],
      size: {},
    });
    expect(issues?.map((i) => i.path?.join("."))).toEqual([
      "name",
      "price",
      "status",
      "tags.0",
      "size.height",
    ]);
  });

  it("has a partial version for PATCH: everything optional, no defaults", () => {
    const patch = Product.partial();
    expect(validate(patch, { price: 5 }).value).toEqual({ price: 5 });
    expect(validate(patch, { size: { width: 1 } }).value).toEqual({ size: { width: 1 } });
    expect(validate(patch, { price: -1 }).issues).toHaveLength(1);
  });

  it("infers the TypeScript type, Mongoose-style", () => {
    expectTypeOf<Infer<typeof Product>>().toEqualTypeOf<{
      name: string;
      sku?: string;
      price?: number;
      status: "draft" | "live";
      inStock?: boolean;
      releasedAt?: Date;
      tags?: string[];
      size: { width?: number; height: number };
    }>();
  });

  it("exposes the Zod schema", () => {
    expect(Product.zod.safeParse({ name: "x", size: { height: 1 } }).success).toBe(true);
  });
});
