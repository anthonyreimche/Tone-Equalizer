// The fake stands in for the host in every UI test, so its values must be the
// host's: a token that is a hex colour here and a var() there lets code pass
// that fails in the app.

import { describe, expect, it } from "vitest";
import { fakeApi } from "./support/fake-api";

describe("fakeApi", () => {
  it("hands out the host's CSS-variable tokens, not literal colours", () => {
    expect(fakeApi().ui.tokens).toEqual({
      surface0: "var(--color-surface-0)",
      surface2: "var(--color-surface-2)",
      border: "var(--color-border)",
      textPrimary: "var(--color-text-primary)",
      textSecondary: "var(--color-text-secondary)",
      textMuted: "var(--color-text-muted)",
      accent: "var(--color-accent)",
    });
  });
});
