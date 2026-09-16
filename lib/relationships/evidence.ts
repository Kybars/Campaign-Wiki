function sentences(text: string): string[] {
  return text.trim().match(/[^.!?]+(?:[.!?]+|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
}

function contains(text: string, anchor: string) {
  return anchor.trim().length > 0 && text.toLocaleLowerCase("en-US").includes(anchor.trim().toLocaleLowerCase("en-US"));
}

function capExcerpt(text: string, maximum: number) {
  if (text.length <= maximum) return text;
  const slice = text.slice(0, maximum - 1);
  const boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary > maximum * 0.7 ? boundary : slice.length).trimEnd()}…`;
}

export function conciseRelationshipExcerpt(text: string, endpointNames: readonly string[], relationshipLabel: string, maximum = 400): string {
  const parts = sentences(text);
  if (!parts.length) return capExcerpt(text.trim(), maximum);
  const names = endpointNames.filter(Boolean);
  const bothEndpoints = parts.find((sentence) => names.length >= 2 && names.every((name) => contains(sentence, name)));
  if (bothEndpoints) return capExcerpt(bothEndpoints, maximum);

  const relationshipWords = relationshipLabel.split(/\s+/).filter((word) => word.length > 3);
  let best = parts[0];
  let bestScore = -1;
  for (let index = 0; index < parts.length; index += 1) {
    const window = parts.slice(index, index + 2).join(" ");
    const score = names.filter((name) => contains(window, name)).length * 3
      + relationshipWords.filter((word) => contains(window, word)).length;
    if (score > bestScore) { best = window; bestScore = score; }
  }
  return capExcerpt(best, maximum);
}
