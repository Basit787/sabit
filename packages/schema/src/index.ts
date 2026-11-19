import { z } from "zod";

type Constructor = StringConstructor | NumberConstructor | BooleanConstructor | DateConstructor;

// Every field: `required` (must be present in POST and PUT bodies) and `default` (used when it's missing).
interface Common<T> {
  readonly required?: boolean;
  readonly default?: T;
}

/*
 * A string field: enum, minLength, maxLength, `match` (a pattern, e.g. /^[a-z0-9-]+$/), trim, lowercase,
 * uppercase.
 */
export interface StringField extends Common<string> {
  readonly type: StringConstructor;
  readonly enum?: readonly string[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly match?: RegExp;
  readonly trim?: boolean;
  readonly lowercase?: boolean;
  readonly uppercase?: boolean;
}

export interface NumberField extends Common<number> {
  readonly type: NumberConstructor;
  readonly min?: number;
  readonly max?: number;
  readonly enum?: readonly number[];
}

export interface BooleanField extends Common<boolean> {
  readonly type: BooleanConstructor;
}

export interface DateField extends Common<Date> {
  readonly type: DateConstructor;
  readonly min?: Date;
  readonly max?: Date;
}

/*
 * A field, Mongoose-style: `String` · `{ type: Number, min: 0 }` · `[String]`
 * (a list) · `{ street: String }` (a nested object).
 */
export type FieldDefinition =
  | Constructor
  | StringField
  | NumberField
  | BooleanField
  | DateField
  | readonly [FieldDefinition]
  | SchemaDefinition;

export interface SchemaDefinition {
  readonly [field: string]: FieldDefinition;
}

type ValueOf<C> = C extends StringConstructor
  ? string
  : C extends NumberConstructor
    ? number
    : C extends BooleanConstructor
      ? boolean
      : C extends DateConstructor
        ? Date
        : never;

type FieldValue<F> = F extends Constructor
  ? ValueOf<F>
  : F extends { readonly type: infer C; readonly enum: readonly (infer E)[] }
    ? C extends Constructor
      ? E
      : never
    : F extends { readonly type: infer C extends Constructor }
      ? ValueOf<C>
      : F extends readonly [infer Item]
        ? FieldValue<Item>[]
        : F extends SchemaDefinition
          ? InferDefinition<F>
          : never;

type IsRequired<F> = F extends { readonly required: true }
  ? true
  : F extends { readonly default: unknown }
    ? true
    : F extends Constructor | { readonly type: Constructor } | readonly unknown[]
      ? false
      : true; // nested objects are always present
type RequiredKeys<D> = { [K in keyof D]: IsRequired<D[K]> extends true ? K : never }[keyof D];
type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type InferDefinition<D extends SchemaDefinition> = Simplify<
  { -readonly [K in RequiredKeys<D>]: FieldValue<D[K]> } & {
    -readonly [K in Exclude<keyof D, RequiredKeys<D>>]?: FieldValue<D[K]>;
  }
>;

/*
 * A schema made with defineSchema; also a Standard Schema. `partial()` gives the PATCH version (every field
 * optional, no defaults); `zod` is the underlying Zod schema.
 */
export interface Schema<D extends SchemaDefinition = SchemaDefinition> {
  readonly "~standard": z.ZodType<InferDefinition<D>>["~standard"];
  partial(): z.ZodType<Partial<InferDefinition<D>>>;
  readonly zod: z.ZodType<InferDefinition<D>>;
  readonly definition: D;
}

// The type a schema accepts: `type Product = Infer<typeof schema>`.
export type Infer<S> = S extends Schema<infer D> ? InferDefinition<D> : never;

/*
 * A request body described like a Mongoose model: `defineSchema({ name: { type: String, required: true },
 * tags: [String], address: { city: String } })`. Fields are optional unless required; unknown ones are
 * dropped. Validation uses Zod (`schema.zod`).
 */
export function defineSchema<const D extends SchemaDefinition>(definition: D): Schema<D> {
  const full = toObject(definition, false) as z.ZodType<InferDefinition<D>>;
  const patch = toObject(definition, true) as z.ZodType<Partial<InferDefinition<D>>>;
  return { "~standard": full["~standard"], partial: () => patch, zod: full, definition };
}

function toObject(definition: SchemaDefinition, partial: boolean): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(definition)) shape[key] = toField(field, partial);
  return z.object(shape);
}

function isConstructor(value: unknown): value is Constructor {
  return value === String || value === Number || value === Boolean || value === Date;
}

function toField(field: FieldDefinition, partial: boolean): z.ZodType {
  if (Array.isArray(field)) {
    return z.array(toField(field[0] as FieldDefinition, false)).optional();
  }
  if (isConstructor(field)) return base(field).optional();
  if ("type" in field && isConstructor(field.type)) {
    const options = field as StringField | NumberField | BooleanField | DateField;
    const schema = withOptions(options);
    if (partial || !(options.required || options.default !== undefined)) {
      return schema.optional();
    }
    return options.default !== undefined
      ? (schema as z.ZodType<unknown>).default(options.default)
      : schema;
  }
  const nested = toObject(field as SchemaDefinition, partial);
  return partial ? nested.partial().optional() : nested;
}

function base(type: Constructor): z.ZodType {
  if (type === String) return z.string();
  if (type === Number) return z.number();
  if (type === Boolean) return z.boolean();
  return z.coerce.date();
}

function withOptions(field: StringField | NumberField | BooleanField | DateField): z.ZodType {
  if (field.type === String) {
    const f = field as StringField;
    if (f.enum) return z.enum(f.enum as [string, ...string[]]);
    let s = z.string();
    if (f.trim) s = s.trim();
    if (f.lowercase) s = s.toLowerCase();
    if (f.uppercase) s = s.toUpperCase();
    if (f.minLength !== undefined) s = s.min(f.minLength);
    if (f.maxLength !== undefined) s = s.max(f.maxLength);
    if (f.match) s = s.regex(f.match);
    return s;
  }
  if (field.type === Number) {
    const f = field as NumberField;
    let n = z.number();
    if (f.min !== undefined) n = n.min(f.min);
    if (f.max !== undefined) n = n.max(f.max);
    const allowed = f.enum;
    return allowed
      ? n.refine((v) => allowed.includes(v), `expected one of ${allowed.join(", ")}`)
      : n;
  }
  if (field.type === Date) {
    const f = field as DateField;
    let d = z.coerce.date();
    if (f.min) d = d.min(f.min);
    if (f.max) d = d.max(f.max);
    return d;
  }
  return z.boolean();
}
