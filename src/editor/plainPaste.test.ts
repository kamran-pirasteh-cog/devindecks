import { describe, expect, it } from "vitest";
import { plainPasteLines } from "./plainPaste";

const clipboard = (data: Record<string, string>) => ({
  getData: (type: string) => data[type] ?? "",
});

describe("plainPasteLines", () => {
  it("takes the plain text and ignores the HTML flavour", () => {
    expect(
      plainPasteLines(
        clipboard({
          "text/plain": "Revenue",
          "text/html": '<b style="color:red;font-size:48px">Revenue</b>',
        }),
      ),
    ).toEqual(["Revenue"]);
  });

  it("splits on newlines, whichever platform wrote them", () => {
    expect(
      plainPasteLines(clipboard({ "text/plain": "a\r\nb\rc\nd" })),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps blank lines, so an empty paragraph survives the round trip", () => {
    expect(plainPasteLines(clipboard({ "text/plain": "a\n\nb" }))).toEqual([
      "a",
      "",
      "b",
    ]);
  });

  it("is empty when the clipboard holds no text", () => {
    expect(plainPasteLines(clipboard({}))).toEqual([]);
    expect(plainPasteLines(null)).toEqual([]);
  });
});
