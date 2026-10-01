import { describe, expect, test } from "vitest";
import { parseSubstance } from "../compiler/Substance.js";
import { getSubstanceLabel, setSubstanceLabel } from "./LabelEditing.js";

const parse = (source: string) => {
  const res = parseSubstance(source);
  if (res.isErr()) throw Error("failed to parse Substance");
  return res.value;
};

const relabel = (source: string, id: string, value: string) =>
  setSubstanceLabel(source, parse(source), id, value);

const unwrap = (res: ReturnType<typeof relabel>): string => {
  if (res.isErr()) throw Error(res.error);
  return res.value;
};

describe("getSubstanceLabel", () => {
  test("explicit labels", () => {
    const prog = parse(`Set A, B
Label A $\\alpha$
Label B "my set"
`);
    expect(getSubstanceLabel(prog, "A")).toMatchObject({
      value: "\\alpha",
      labelType: "MathLabel",
    });
    expect(getSubstanceLabel(prog, "B")).toMatchObject({
      value: "my set",
      labelType: "TextLabel",
    });
  });

  test("later statements win", () => {
    const prog = parse(`Set A, B, C
Label A $a$
AutoLabel All
Label B $b$
NoLabel C
`);
    expect(getSubstanceLabel(prog, "A")).toEqual({
      value: "A",
      labelType: "MathLabel",
      literal: undefined,
    });
    expect(getSubstanceLabel(prog, "B")?.value).toEqual("b");
    expect(getSubstanceLabel(prog, "C")?.value).toEqual("");
  });

  test("unlabeled", () => {
    expect(getSubstanceLabel(parse("Set A\n"), "A")?.value).toEqual("");
  });

  test("indexed label statements are unknown", () => {
    const prog = parse(`Set x_i for i in [1, 3]
Label x_i $x_i$ for i in [1, 3]
`);
    expect(getSubstanceLabel(prog, "x_1")).toBeUndefined();
  });
});

describe("setSubstanceLabel", () => {
  test("edits a math label in place", () => {
    const source = `Set A, B
Label A $\\alpha$ -- comment
Label B "b"
`;
    expect(unwrap(relabel(source, "A", "\\beta^2"))).toEqual(`Set A, B
Label A $\\beta^2$ -- comment
Label B "b"
`);
  });

  test("edits a text label in place", () => {
    const source = `Set A, B\nLabel A $a$\nLabel B "old"\n`;
    expect(unwrap(relabel(source, "B", "new label"))).toEqual(
      `Set A, B\nLabel A $a$\nLabel B "new label"\n`,
    );
  });

  test("edits only the statement that takes effect", () => {
    const source = `Set A\nLabel A $a$\nLabel A $b$\n`;
    expect(unwrap(relabel(source, "A", "c"))).toEqual(
      `Set A\nLabel A $a$\nLabel A $c$\n`,
    );
  });

  test("appends a label for AutoLabel objects", () => {
    const source = `Set A, B\nAutoLabel All`;
    expect(unwrap(relabel(source, "A", "S"))).toEqual(
      `Set A, B\nAutoLabel All\nLabel A $S$\n`,
    );
  });

  test("result reparses to the new label", () => {
    const source = `Set A\r\nSet B\r\nLabel B "x"\r\n`;
    const edited = unwrap(relabel(source, "B", "y"));
    expect(getSubstanceLabel(parse(edited), "B")?.value).toEqual("y");
  });

  test("rejects values that would break the literal", () => {
    expect(relabel(`Set A\nLabel A $a$\n`, "A", "$x$").isErr()).toBe(true);
    expect(relabel(`Set A\nLabel A "a"\n`, "A", 'say "hi"').isErr()).toBe(true);
    expect(relabel(`Set A\nLabel A "a"\n`, "A", "two\nlines").isErr()).toBe(
      true,
    );
  });

  test("refuses labels set by indexed statements", () => {
    const source = `Set x_i for i in [1, 2]\nLabel x_i $x$ for i in [1, 2]\n`;
    expect(relabel(source, "x_1", "y").isErr()).toBe(true);
  });
});
