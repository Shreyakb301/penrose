import { C, SourceRange } from "../types/ast.js";
import { LabelType, SubProg } from "../types/substance.js";
import { Result, err, ok } from "./Error.js";

/**
 * The label a Substance object ends up with, along with where (if anywhere)
 * that label is written down in the Substance program.
 */
export interface SubstanceLabel {
  value: string;
  labelType: LabelType;
  /**
   * Source range of the string or TeX literal (including its delimiters) in
   * the `Label` statement that sets this label, or `undefined` if the label
   * comes from `AutoLabel` or no label was set.
   */
  literal: SourceRange | undefined;
}

/**
 * Determine the label of the Substance object `id` from the parsed (not yet
 * compiled) Substance program, mirroring how the compiler processes `Label`,
 * `AutoLabel` and `NoLabel` statements: the last statement affecting `id`
 * wins.
 *
 * Returns `undefined` if the label can't be determined without compiling the
 * program, i.e. if it may be set by an indexed statement.
 */
export const getSubstanceLabel = (
  prog: SubProg<C>,
  id: string,
): SubstanceLabel | undefined => {
  for (let i = prog.statements.length - 1; i >= 0; i--) {
    const stmt = prog.statements[i];
    switch (stmt.tag) {
      case "StmtSet": {
        const { tag } = stmt.stmt;
        if (tag === "LabelDecl" || tag === "NoLabel" || tag === "AutoLabel") {
          return undefined;
        }
        break;
      }
      case "LabelDecl": {
        if (stmt.variable.value === id) {
          return {
            value: stmt.label.contents,
            labelType: stmt.labelType,
            literal: { start: stmt.label.start, end: stmt.label.end },
          };
        }
        break;
      }
      case "NoLabel": {
        if (stmt.args.some((arg) => arg.value === id)) {
          return { value: "", labelType: "NoLabel", literal: undefined };
        }
        break;
      }
      case "AutoLabel": {
        if (
          stmt.option.tag === "DefaultLabels" ||
          stmt.option.variables.some((v) => v.value === id)
        ) {
          return { value: id, labelType: "MathLabel", literal: undefined };
        }
        break;
      }
    }
  }
  return { value: "", labelType: "NoLabel", literal: undefined };
};

const toOffset = (source: string, { line, col }: C["start"]): number => {
  let offset = 0;
  for (let l = 1; l < line; l++) {
    offset = source.indexOf("\n", offset) + 1;
  }
  return offset + col;
};

/**
 * Return a copy of the Substance program `source` (which parses to `prog`) in
 * which the label of `id` is `value`, keeping its label type (math or text).
 * An existing `Label` statement for `id` is edited in place; otherwise a new
 * one is appended to the end of the program.
 */
export const setSubstanceLabel = (
  source: string,
  prog: SubProg<C>,
  id: string,
  value: string,
): Result<string, string> => {
  const current = getSubstanceLabel(prog, id);
  if (current === undefined) {
    return err(`the label of ${id} is set by an indexed statement`);
  }
  if (/[\r\n]/.test(value)) {
    return err("labels cannot contain line breaks");
  }

  let literal: string;
  if (current.labelType === "TextLabel") {
    if (value.includes('"')) {
      return err('text labels cannot contain "');
    }
    literal = `"${value}"`;
  } else {
    if (value.includes("$")) {
      return err("math labels cannot contain $");
    }
    literal = `$${value}$`;
  }

  if (current.literal !== undefined) {
    const start = toOffset(source, current.literal.start);
    const end = toOffset(source, current.literal.end);
    return ok(source.slice(0, start) + literal + source.slice(end));
  }

  const sep = source.length === 0 || source.endsWith("\n") ? "" : "\n";
  return ok(`${source}${sep}Label ${id} ${literal}\n`);
};
