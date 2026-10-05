import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyAcceptanceBundle, sha256, frozenHashes } from "../lib/ai/claims-offline-replay";

describe("offline acceptance manifest boundary", () => {
  it("verifies all bytes before consumption and refuses corrupted or unlisted inputs", () => {
    const dir = mkdtempSync(join(tmpdir(), "claims-replay-"));
    writeFileSync(join(dir, "input.json"), "{}");
    writeFileSync(join(dir, "MANIFEST.json"), JSON.stringify({ artifacts: [{ path: "input.json", bytes: 2, sha256: sha256("{}") }] }));
    const hash = sha256(readFileSync(join(dir, "MANIFEST.json")));
    const bundle = verifyAcceptanceBundle(dir, hash);
    expect(bundle.read("input.json")).toEqual({});
    expect(() => bundle.read("unknown.json")).toThrow("Unverified");
    expect(() => verifyAcceptanceBundle(dir, "wrong")).toThrow("manifest hash mismatch");
    writeFileSync(join(dir, "input.json"), "[]");
    expect(() => verifyAcceptanceBundle(dir, hash)).toThrow("Artifact hash mismatch");
  });
  it("rejects manifest path traversal", () => {
    const dir = mkdtempSync(join(tmpdir(), "claims-replay-"));
    writeFileSync(join(dir, "MANIFEST.json"), JSON.stringify({ artifacts: [{ path: "../outside", bytes: 0, sha256: "" }] }));
    expect(() => verifyAcceptanceBundle(dir, sha256(readFileSync(join(dir, "MANIFEST.json"))))).toThrow("Invalid manifest path");
  });
  it("locks only the frozen extraction contracts", () => {
    expect(frozenHashes()).toEqual({ prompt: "d631d2234fbaf5517a7543f46d053b9f837a6c2589a4471fd3fbfeb05eca5b58",
      schema: "16b4e1a54d39a6c76b06af42369602de49b3da4b2c3b12bb08d8d4e49f182ebb" });
  });
});
