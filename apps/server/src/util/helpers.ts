import { createHash, randomUUID } from "node:crypto";

export const newId = (): string => randomUUID();

export const nowIso = (): string => new Date().toISOString();

export const sha256 = (input: string | Buffer): string =>
  createHash("sha256").update(input).digest("hex");

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Whole-year age at a reference date. */
export function ageYears(dobIso: string, at = new Date()): number {
  const dob = new Date(dobIso);
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < dob.getUTCMonth() ||
    (at.getUTCMonth() === dob.getUTCMonth() && at.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
