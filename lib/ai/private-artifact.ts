import { closeSync, fsyncSync, openSync, renameSync, writeSync } from "node:fs";

/** fsync before returning; exclusive creation prevents a concurrent redispatch. */
export function writeDurableArtifact(path: string, value: unknown, exclusive = true) {
  const temporary = exclusive ? path : `${path}.tmp`;
  const fd = openSync(temporary, "wx");
  try {
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  if (!exclusive) renameSync(temporary, path);
}
