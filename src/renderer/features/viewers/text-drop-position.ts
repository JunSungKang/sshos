export type TextDropPosition = {
  offset: number;
  x: number;
  y: number;
  height: number;
};

function findPosition(
  node: Node,
  start: number,
  length: number,
  x: number,
  y: number,
): TextDropPosition | null {
  const range = document.caretRangeFromPoint(x, y);
  if (!range || !node.contains(range.startContainer)) return null;
  if (range.startContainer.nodeType !== Node.TEXT_NODE && length > 0)
    return null;
  const offset = Math.min(length, range.startOffset);
  const bounds = range.getBoundingClientRect();
  return {
    offset: start + offset,
    x: bounds.height ? bounds.left : x,
    y: bounds.height ? bounds.top : y - 8,
    height: bounds.height || 16,
  };
}

/** Blink exposes the pointer offset in normal text, but hides the inner textarea DOM. */
export class TextDropPositionProbe {
  private mirror: HTMLDivElement | null = null;
  private mirroredValue: string | null = null;

  close() {
    this.mirror?.remove();
    this.mirror = null;
    this.mirroredValue = null;
  }

  locate(viewport: HTMLElement, x: number, y: number): TextDropPosition | null {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !viewport.contains(hit)) return null;
    if (!(hit instanceof HTMLTextAreaElement)) {
      const line = hit.closest<HTMLElement>("pre[data-text-start]");
      if (!line) return null;
      return findPosition(
        line,
        Number(line.dataset.textStart),
        line.textContent?.length ?? 0,
        x,
        y,
      );
    }
    let mirror = this.mirror;
    if (!mirror) {
      mirror = document.createElement("div");
      mirror.setAttribute("aria-hidden", "true");
      const css = getComputedStyle(hit);
      for (const key of [
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "line-height",
        "letter-spacing",
        "word-spacing",
        "text-indent",
        "text-align",
        "direction",
        "writing-mode",
        "tab-size",
        "white-space",
        "overflow-wrap",
        "word-break",
        "padding",
        "border",
        "box-sizing",
        "scrollbar-gutter",
        "overflow-x",
        "overflow-y",
      ])
        mirror.style.setProperty(key, css.getPropertyValue(key));
      Object.assign(mirror.style, {
        position: "fixed",
        zIndex: "2147483647",
        opacity: "0",
        pointerEvents: "none",
      });
      document.body.append(mirror);
      this.mirror = mirror;
    }
    if (hit.value !== this.mirroredValue) {
      // A trailing zero-width character gives Blink a measurable final empty line.
      mirror.textContent = hit.value + "\u200b";
      this.mirroredValue = hit.value;
    }
    const box = hit.getBoundingClientRect();
    Object.assign(mirror.style, {
      width: box.width + "px",
      height: box.height + "px",
      left: box.x + "px",
      top: box.y + "px",
      pointerEvents: "auto",
    });
    try {
      mirror.scrollTop = hit.scrollTop;
      mirror.scrollLeft = hit.scrollLeft;
      return findPosition(mirror, 0, hit.value.length, x, y);
    } finally {
      mirror.style.pointerEvents = "none";
    }
  }
}
