/*
 * A component that lies over the DiagramPanel and lets the user edit label
 * text by double-clicking it. Edits are written back to the Substance program.
 */

import {
  getSubstanceLabel,
  parseSubstance,
  RenderState,
  setSubstanceLabel,
  Shape,
} from "@penrose/core";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useRecoilValue } from "recoil";
import { fileContentsSelector } from "../state/atoms.js";
import { useUpdateSubstance } from "../state/callbacks.js";
import { getRelativeBBox } from "../utils/renderUtils.js";

export interface LabelEditOverlayProps {
  diagramSVG: SVGSVGElement;
  state: RenderState;
  svgTitleCache: Map<string, SVGElement>;
}

// how far (in screen pixels) outside a label's bbox a double-click still counts
const hitSlop = 4;

interface EditableLabel {
  id: string;
  value: string;
  math: boolean;
}

interface Editing extends EditableLabel {
  bbox: DOMRect;
}

const flattenShapes = function* (
  shapes: Shape<number>[],
): Generator<Shape<number>> {
  for (const shape of shapes) {
    if (shape.shapeType === "Group") {
      yield* flattenShapes(shape.shapes.contents);
    } else {
      yield shape;
    }
  }
};

/** Get the Substance object a shape belongs to from its path, e.g. `A`.text */
const substanceId = (path: string): string | null =>
  /^`([^`]+)`\./.exec(path)?.[1] ?? null;

const LabelEditOverlay = memo((props: LabelEditOverlayProps): JSX.Element => {
  const substance = useRecoilValue(fileContentsSelector("substance")).contents;
  const updateSubstance = useUpdateSubstance();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draftLength, setDraftLength] = useState(0);
  const overlay = useRef<HTMLDivElement | null>(null);
  // set when the user presses Escape, so the blur that follows doesn't commit
  const cancelled = useRef(false);

  const prog = useMemo(() => {
    const res = parseSubstance(substance);
    return res.isOk() ? res.value : null;
  }, [substance]);

  // a text shape is editable if it displays exactly the label of the
  // Substance object it was made for, rather than e.g. a string computed in Style
  const editable = useMemo(() => {
    const labels = new Map<string, EditableLabel>();
    if (prog === null) return labels;
    for (const shape of flattenShapes(props.state.shapes)) {
      if (shape.shapeType !== "Text" && shape.shapeType !== "Equation") {
        continue;
      }
      const path = shape.name.contents;
      const id = substanceId(path);
      if (id === null) continue;
      const label = getSubstanceLabel(prog, id);
      if (
        label !== undefined &&
        label.value !== "" &&
        label.value === shape.string.contents
      ) {
        labels.set(path, {
          id,
          value: label.value,
          math: shape.shapeType === "Equation",
        });
      }
    }
    return labels;
  }, [prog, props.state]);

  // Labels are often drawn underneath (translucent) shapes, and in edit mode
  // InteractivityOverlay disables pointer events on non-interactive shapes, so
  // rather than listening on the label elements themselves we hit-test their
  // bounding boxes from the element containing the diagram.
  useEffect(() => {
    const container = props.diagramSVG.parentElement;
    if (container === null) return;

    const labelAt = ({ clientX, clientY }: MouseEvent) => {
      let best: { path: string; elem: SVGElement; area: number } | null = null;
      for (const path of editable.keys()) {
        const elem = props.svgTitleCache.get(path);
        if (elem === undefined) continue;
        const { left, right, top, bottom, width, height } =
          elem.getBoundingClientRect();
        const inside =
          clientX >= left - hitSlop &&
          clientX <= right + hitSlop &&
          clientY >= top - hitSlop &&
          clientY <= bottom + hitSlop;
        // prefer the smallest label if several overlap
        if (inside && (best === null || width * height < best.area)) {
          best = { path, elem, area: width * height };
        }
      }
      return best;
    };

    const onMouseMove = (e: MouseEvent) => {
      container.style.cursor = labelAt(e) ? "text" : "";
    };

    const onDoubleClick = (e: MouseEvent) => {
      const hit = labelAt(e);
      if (hit === null || overlay.current === null) return;
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      cancelled.current = false;
      setDraftLength(editable.get(hit.path)!.value.length);
      setEditing({
        ...editable.get(hit.path)!,
        bbox: getRelativeBBox(hit.elem, overlay.current),
      });
    };

    container.addEventListener("mousemove", onMouseMove);
    container.addEventListener("dblclick", onDoubleClick);
    return () => {
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("dblclick", onDoubleClick);
      container.style.cursor = "";
    };
  }, [editable, props.diagramSVG, props.svgTitleCache]);

  const commit = async (value: string) => {
    if (editing === null || cancelled.current) return;
    setEditing(null);
    if (value === editing.value || value === "" || prog === null) return;
    const res = setSubstanceLabel(substance, prog, editing.id, value);
    if (res.isErr()) {
      toast.error(`Couldn't edit label: ${res.error}`);
      return;
    }
    await updateSubstance(res.value);
  };

  return (
    <div
      style={{
        position: "absolute",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
      ref={overlay}
    >
      {editing && (
        <input
          autoFocus
          defaultValue={editing.value}
          aria-label={`Label of ${editing.id}`}
          title={
            editing.math
              ? "TeX label: press Enter to apply, Esc to cancel"
              : "Press Enter to apply, Esc to cancel"
          }
          spellCheck={!editing.math}
          onFocus={(e) => e.currentTarget.select()}
          onInput={(e) => setDraftLength(e.currentTarget.value.length)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              cancelled.current = true;
              setEditing(null);
            }
          }}
          style={{
            position: "absolute",
            boxSizing: "content-box",
            left: `${editing.bbox.x + editing.bbox.width / 2}px`,
            top: `${editing.bbox.y + editing.bbox.height / 2}px`,
            transform: "translate(-50%, -50%)",
            // fit the text being typed, with room for the caret
            width: `${Math.max(draftLength, 1) + 1}ch`,
            height: "20px",
            padding: "1px 4px",
            fontSize: "14px",
            fontFamily: editing.math ? "monospace" : "inherit",
            textAlign: "center",
            border: "2px solid #40b4f7",
            borderRadius: "4px",
            boxShadow: "0 2px 6px rgba(0, 0, 0, 0.2)",
            pointerEvents: "all",
          }}
        />
      )}
    </div>
  );
});

export default LabelEditOverlay;
