export function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’']/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Keeps display spelling intact except for a lowercase leading alphabetic character. */
export function normalizeCanonicalDisplayName(value: string): string {
  return value.replace(/\p{L}/u, (character) => character.toLocaleUpperCase("en-US"));
}

export function normalizeRelationshipType(value: string): string {
  return normalizeName(value);
}
