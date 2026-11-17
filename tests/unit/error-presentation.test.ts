import { describe, it, expect } from "vitest";
import { presentError } from "../../src/shared/error-presentation";
import { errorMessages } from "../../src/shared/errors";
describe("fixed structured error presentation", () => {
  it("covers every public code with fixed messages/actions and never forwards raw debug or stack", () => {
    for (const code of Object.keys(errorMessages)) {
      const value = presentError(
        new Error("Error invoking remote method: Error: " + code),
        {
          confirmedPhase: "finalizing",
          affectedTarget: "/home/<script>plain</script>",
        },
      );
      expect(value.code).toBe(code);
      expect(value.userMessage).toBe(
        errorMessages[code as keyof typeof errorMessages],
      );
      expect(value.actions.length).toBeGreaterThan(0);
      expect(value.technicalDetails).toEqual({ code, rawDebugIncluded: false });
      expect(value.affectedTarget).toBe("/home/<script>plain</script>");
    }
    const unknown = presentError(
      new Error("SENTINEL_PASSWORD server diagnostic"),
    );
    expect(unknown.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(unknown)).not.toContain("SENTINEL");
    expect(unknown.confirmedPhase).toBeNull();
    expect(unknown.affectedTarget).toBeNull();
  });
  it("prioritizes unknown/partial outcomes over a generic transport or storage error", () => {
    expect(
      presentError("STORAGE_FAILED", {
        outcome: "unknown",
        confirmedPhase: "finalizing",
      }),
    ).toMatchObject({ code: "RESULT_UNKNOWN", confirmedPhase: "finalizing" });
    expect(presentError("IO_TIMEOUT", { outcome: "partial_rename" }).code).toBe(
      "PARTIAL_RENAME",
    );
  });
  it("uses download-specific messages while retaining the operation's error code", () => {
    const cases = [
      ["SOURCE_CHANGED", "원격 원본"],
      ["VERIFY_MISMATCH", "로컬 임시 파일"],
      ["NAME_CONFLICT", "같은 이름"],
    ] as const;
    for (const [code, text] of cases) {
      const result = presentError(code, { download: true });
      expect(result.code).toBe(code);
      expect(result.userMessage).toContain(text);
      expect(result.userMessage).not.toBe(errorMessages[code]);
    }
    expect(
      presentError("VERIFY_MISMATCH", { download: true, outcome: "unknown" })
        .userMessage,
    ).toBe(errorMessages.RESULT_UNKNOWN);
  });
});
