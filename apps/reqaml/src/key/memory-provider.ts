import type { KeyProvider } from "./provider.js";

const PREFIX = "reqaml-mem:";

/** In-process KeyProvider fake (Transit wrap/unwrap semantics without OpenBao). */
export function createMemoryKeyProvider(): KeyProvider {
  return {
    async ensureReady() {},
    async wrapSecret(plaintext, purpose) {
      return `${PREFIX}${purpose}:${plaintext.toString("base64url")}`;
    },
    async unwrapSecret(ciphertext, purpose) {
      const expected = `${PREFIX}${purpose}:`;
      if (!ciphertext.startsWith(expected)) {
        throw new Error("memory KeyProvider ciphertext mismatch");
      }
      return Buffer.from(ciphertext.slice(expected.length), "base64url");
    },
  };
}
