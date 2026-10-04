// Factored from production span extraction; offsets address DocumentPage.text.
export function normalizedRawWithMap(raw: string) {
  let text = ""; const indexes: number[] = []; let pendingSpace: number | null = null;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === "-") {
      const wrap = raw.slice(index + 1).match(/^(?:\r?\n|[ \t]+\r?\n)[ \t]*(\p{Ll})/u);
      if (wrap) { index += wrap[0].length; text += wrap[1]; indexes.push(index); continue; }
    }
    if (/\s/u.test(raw[index])) { if (text) pendingSpace = index; continue; }
    if (pendingSpace !== null) { text += " "; indexes.push(pendingSpace); pendingSpace = null; }
    text += raw[index]; indexes.push(index);
  }
  return { text, indexes };
}

export function rawSliceForSemantic(raw: string, semantic: string, searchFrom: number) {
  const mapped = normalizedRawWithMap(raw);
  const needle = semantic.replace(/\s+/gu, " ").trim();
  const start = mapped.text.indexOf(needle, searchFrom);
  if (start < 0) throw new Error(`Semantic evidence could not be mapped to raw source: ${needle.slice(0, 80)}`);
  const rawStart = mapped.indexes[start]; const rawEnd = mapped.indexes[start + needle.length - 1];
  if (rawStart === undefined || rawEnd === undefined) throw new Error("Semantic-to-raw mapping lost source indexes");
  return { rawSlice: raw.slice(rawStart, rawEnd + 1), rawStart, rawEnd: rawEnd + 1, nextSearch: start + needle.length };
}
