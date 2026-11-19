/*
 * Standard Schema v1 (standardschema.dev), copied as types so Zod, Valibot and ArkType work without
 * this package depending on them. The spec allows copying; names are flattened, no namespace.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1Props<Input, Output>;
}

export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (
    value: unknown,
  ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
  readonly types?: StandardSchemaV1Types<Input, Output> | undefined;
}

export type StandardSchemaV1Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaV1Issue> };

export interface StandardSchemaV1Issue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

export interface StandardSchemaV1Types<Input = unknown, Output = Input> {
  readonly input: Input;
  readonly output: Output;
}

export type InferInput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["input"];
export type InferOutput<S extends StandardSchemaV1> = NonNullable<
  S["~standard"]["types"]
>["output"];
