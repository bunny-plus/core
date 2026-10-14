export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = boolean | JsonObject | JsonValue[] | null | number | string;

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

export function isStringList(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

export function isInteger(value: JsonValue | undefined): value is number {
  return Number.isInteger(value);
}
