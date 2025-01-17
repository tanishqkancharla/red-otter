import { invariant } from "./invariant";
import { Style } from "./Style";
import { Vec4 } from "./math/Vec4";
import { Queue } from "./Queue";
import { Font } from "./fonts/Font";
import { parseColor } from "./parseColor";
import { IContext } from "./IContext";
import { Vec2 } from "./math/Vec2";
import { resolveStylingValues } from "./resolveStylingValues";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  interface Window {
    cssVariables: Map<string, string>;
  }
}

if (typeof window !== "undefined") {
  window.cssVariables = new Map();
}

export type TextStyle = {
  fontFamily: Font;
  fontSize?: number;
  color?: string;
  trimRectangle?: [number, number, number, number];
};

type Input =
  | Style
  | (Style &
      // Remove the optional properties and add them as required (plus change
      // color from string to Vec4).
      Omit<TextStyle, "fontSize"> & {
        text: string;
        fontSize: number;
      })
  | (Style & { points: [number, number][]; color: string } & (
        | {
            thickness: number;
            type: "line";
          }
        | {
            type: "polygon";
          }
      ));

type ResolvedInput = {
  [K in keyof Input]-?: NonNullable<Input[K]>;
};

/**
 * Fixed view is a view with all layout properties calculated.
 */
export type FixedView = {
  input: Input;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  backgroundColor: Vec4;
  borderColor?: Vec4;
};

export const viewDefaults: Partial<Style> = {
  flexDirection: "column",
  justifyContent: "flex-start",
  alignItems: "flex-start",
  position: "relative",
  gap: 0,
  padding: 0,
  display: "flex",
};

export const fixedViewDefaults = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  zIndex: 0,
  backgroundColor: new Vec4(0, 0, 0, 0),
};

export const textStyleDefaults = {
  fontSize: 16,
  color: "#fff",
};

/**
 * A tiny tree implementation which supports only adding children.
 */
export class TreeNode<T> {
  id = -1;
  next: TreeNode<T> | null;
  prev: TreeNode<T> | null;
  firstChild: TreeNode<T> | null;
  lastChild: TreeNode<T> | null;
  parent: TreeNode<T> | null;

  constructor(public readonly value: T) {
    this.next = null;
    this.prev = null;
    this.firstChild = null;
    this.lastChild = null;
    this.parent = null;
  }

  addChild(node: TreeNode<T>): TreeNode<T> {
    node.parent = this;

    if (this.firstChild === null) {
      this.firstChild = node;
      this.lastChild = node;
    } else {
      invariant(this.lastChild !== null, "Last child must be set.");
      node.prev = this.lastChild;
      this.lastChild.next = node;
      this.lastChild = node;
    }

    return node;
  }
}

function toPercentage(value: string): number {
  invariant(value.endsWith("%"), "Value must be a percentage.");
  return Number(value.replace("%", "")) / 100;
}

type LayoutOptions = {
  readCSSVariables?: boolean;
};

/**
 * Layout is a tree of views. Use it via JSX API (`<view>` etc.) or direct API
 * (`view()` and `text()`).
 */
export class Layout {
  readonly root: TreeNode<FixedView> | null;
  private current: TreeNode<FixedView> | null;

  /**
   * Takes a context instance which is used to retrieve HTML canvas size.
   */
  constructor(private readonly context: IContext, options?: LayoutOptions) {
    const node = new TreeNode<FixedView>({
      input: { ...resolveStylingValues(viewDefaults) },
      ...fixedViewDefaults,
      width: context.getCanvas().clientWidth,
      height: context.getCanvas().clientHeight,
    });

    this.root = node;
    this.current = node;

    if (options?.readCSSVariables) {
      const cssRoot = Array.from(document.styleSheets)
        .filter(
          (sheet) =>
            sheet.href === null || sheet.href.startsWith(window.location.origin)
        )
        .map((sheet) => Array.from(sheet.cssRules))
        .flat()
        .filter((rule) => rule instanceof CSSStyleRule)
        .map((rule) => rule as CSSStyleRule)
        .filter((rule) => rule.selectorText === ":root")[0];

      if (cssRoot) {
        const dictionary = new Map<string, string>();
        const vars = Array.from(cssRoot.style).filter((name) =>
          name.startsWith("--")
        );

        for (const name of vars) {
          dictionary.set(name, cssRoot.style.getPropertyValue(name));
        }

        window.cssVariables = dictionary;
      }
    }
  }

  /**
   * Adds a new view to the layout. Any subsequent calls to `view()` and
   * `text()` will add children to this view. Call `end()` to return to the
   * parent view.
   *
   * Alternative to JSX API. Used in combination with `frame()` and `end()`.
   *
   * Usage:
   *
   * ```js
   * layout.view(containerStyle);
   * layout.text("Hello", font, 12, "#000", 10, 10);
   * layout.end();
   * ```
   */
  view(style: Style): void {
    const parent = this.current;
    invariant(parent !== null, "No parent view.");

    const backgroundColor = style.backgroundColor
      ? parseColor(style.backgroundColor)
      : fixedViewDefaults.backgroundColor;

    const borderColor = style.borderColor
      ? parseColor(style.borderColor)
      : undefined;

    const node = new TreeNode({
      input: { ...viewDefaults, ...resolveStylingValues(style) },
      ...fixedViewDefaults,
      backgroundColor,
      borderColor,
    });
    parent.addChild(node);

    this.current = node;
  }

  /**
   * Makes the parent view the current view, so that subsequent calls to
   * `view()` and `text()` will add children to the parent view instead.
   */
  end(): void {
    invariant(this.current !== null, "No current view.");
    this.current = this.current.parent;
  }

  /**
   * Adds a new text view to the layout.
   *
   * Alternative to JSX API.
   */
  text(
    text: string,
    font: Font,
    fontSize: number,
    color: string,
    x?: number,
    y?: number,
    trimStart?: number,
    trimEnd?: number
  ): void {
    const parent = this.current;
    invariant(parent !== null, "No parent view.");

    const shape = font.getTextShape(text, fontSize);
    const { width, height } = shape.boundingRectangle;

    const node = new TreeNode({
      input: {
        ...resolveStylingValues(viewDefaults),
        fontSize: fontSize,
        color,
        text,
        width,
        height,
        trimStart,
        trimEnd,
      },
      ...fixedViewDefaults,
      x: x ?? 0,
      y: y ?? 0,
      width,
      height,
    });

    parent.addChild(node);
  }

  /**
   * Add a subtree to the layout. Can be used interchangeably with direct API
   * (`view()` and `text()`) if needed.
   *
   * Can be also called multiple times.
   *
   * Usage:
   *
   * ```tsx
   * layout.add(
   *   <view style={container}>
   *     <text style={{ fontFamily: font, fontSize: 12, color: '#fff' }}>
   *      Hello
   *    </text>
   *  </view>
   * );
   * ```
   */
  add(node: TreeNode<FixedView>): void {
    const parent = this.current;
    invariant(parent !== null, "No parent view.");
    parent.addChild(node);
  }

  getRoot(): TreeNode<FixedView> | null {
    return this.root;
  }

  /**
   * Calculates layout tree by applying all sizing and direction properties.
   */
  calculate(): void {
    const quadQueue = new Queue<TreeNode<FixedView>>();
    const reverseQueue = new Queue<TreeNode<FixedView>>();
    const forwardQueue = new Queue<TreeNode<FixedView>>();

    invariant(this.root !== null, "No root view.");

    // Traverse node tree in level order and generate the reverse queue.
    quadQueue.enqueue(this.root);
    while (!quadQueue.isEmpty()) {
      const element = quadQueue.dequeue();
      invariant(element !== null, "Empty queue.");

      let p = element.firstChild;
      while (p !== null) {
        quadQueue.enqueue(p);
        reverseQueue.enqueue(p);
        p = p.next;
      }
    }

    // Second tree pass: resolve HugContent.
    // Going bottom-up, level order.
    while (!reverseQueue.isEmpty()) {
      const element = reverseQueue.dequeueFront();
      invariant(element !== null, "Empty queue.");

      forwardQueue.enqueue(element);

      const input = element.value.input as ResolvedInput;

      if (typeof input.width === "number") {
        element.value.width = input.width;
      }

      if (typeof input.height === "number") {
        element.value.height = input.height;
      }

      if (input.width === undefined) {
        let childrenCount = 0;

        let p = element.firstChild;
        while (p) {
          const childInput = p.value.input as ResolvedInput;
          if (p.value.width || typeof childInput.width === "number") {
            if (
              input.flexDirection === "row" &&
              childInput.position === "relative"
            ) {
              element.value.width +=
                p.value.width + childInput.marginLeft + childInput.marginRight;
            }

            if (
              input.flexDirection === "column" &&
              childInput.position === "relative"
            ) {
              element.value.width = Math.max(
                element.value.width,
                p.value.width + childInput.marginLeft + childInput.marginRight
              );
            }
          }

          if (p.value.input.position === "relative") {
            childrenCount += 1;
          }

          p = p.next;
        }

        element.value.width +=
          input.paddingLeft +
          input.paddingRight +
          (input.flexDirection === "row" ? (childrenCount - 1) * input.gap : 0);
      }

      if (input.height === undefined) {
        let childrenCount = 0;

        let p = element.firstChild;
        while (p) {
          const childInput = p.value.input as ResolvedInput;

          if (p.value.height || typeof childInput.height === "number") {
            if (
              input.flexDirection === "column" &&
              p.value.input.position === "relative"
            ) {
              element.value.height +=
                p.value.height + childInput.marginTop + childInput.marginBottom;
            }

            if (
              input.flexDirection === "row" &&
              p.value.input.position === "relative"
            ) {
              element.value.height = Math.max(
                element.value.height,
                p.value.height + childInput.marginTop + childInput.marginBottom
              );
            }
          }

          if (childInput.position === "relative") {
            childrenCount += 1;
          }

          p = p.next;
        }

        element.value.height +=
          input.paddingTop +
          input.paddingBottom +
          (input.flexDirection === "column"
            ? (childrenCount - 1) * input.gap
            : 0);
      }
    }

    // Third tree pass: resolve flex.
    // Going top-down, level order.
    while (!forwardQueue.isEmpty()) {
      const element = forwardQueue.dequeueFront();
      invariant(element !== null, "Empty queue.");

      let totalFlex = 0;
      let childrenCount = 0;

      const parent = element.parent;

      // Undefined is ruled out by the previous pass.
      const parentWidth = parent?.value.width ?? 0;
      const parentHeight = parent?.value.height ?? 0;

      const input = element.value.input as ResolvedInput;
      const parentInput = parent?.value.input as ResolvedInput;

      invariant(
        input.flex ? input.flex >= 0 : true,
        "Flex cannot be negative."
      );

      if (typeof input.width === "string") {
        element.value.width = toPercentage(input.width) * parentWidth;
      }

      if (typeof input.height === "string") {
        element.value.height = toPercentage(input.height) * parentHeight;
      }

      // Apply `top`, `left`, `right`, `bottom` properties.
      {
        if (
          input.left !== undefined &&
          input.right !== undefined &&
          input.width === undefined
        ) {
          element.value.x = (parent?.value.x ?? 0) + input.left;
          element.value.width = parentWidth - input.left - input.right;
        } else if (input.left !== undefined) {
          if (input.position === "absolute") {
            element.value.x = (parent?.value.x ?? 0) + input.left;
          } else {
            element.value.x += input.left;
          }
        } else if (input.right !== undefined) {
          if (input.position === "absolute") {
            element.value.x =
              (parent?.value.x ?? 0) +
              parentWidth -
              input.right -
              element.value.width;
          } else {
            element.value.x = (parent?.value.x ?? 0) - input.right;
          }
        } else if (input.position === "absolute") {
          // If position is "absolute" but offsets are not specified, set
          // position to parent's top left corner.
          element.value.x = parent?.value.x ?? 0;
        }

        if (
          input.top !== undefined &&
          input.bottom !== undefined &&
          input.height === undefined
        ) {
          element.value.y = (parent?.value.y ?? 0) + input.top;
          element.value.height = parentHeight - input.top - input.bottom;
        } else if (input.top !== undefined) {
          if (input.position === "absolute") {
            element.value.y = (parent?.value.y ?? 0) + input.top;
          } else {
            element.value.y += input.top;
          }
        } else if (input.bottom !== undefined) {
          if (input.position === "absolute") {
            element.value.y =
              (parent?.value.y ?? 0) +
              parentHeight -
              input.bottom -
              element.value.height;
          } else {
            element.value.y = (parent?.value.y ?? 0) - input.bottom;
          }
        } else if (input.position === "absolute") {
          // If position is "absolute" but offsets are not specified, set
          // position to parent's top left corner.
          element.value.y = parent?.value.y ?? 0;
        }
      }

      // Apply align self.
      if (element.value.input.position !== "absolute" && parent) {
        if (parentInput.flexDirection === "row") {
          if (input.alignSelf === "center") {
            element.value.y =
              element.value.y +
              element.value.height / 2 -
              element.value.height / 2;
          }

          if (input.alignSelf === "flex-end") {
            element.value.y =
              element.value.y +
              parent.value.height -
              element.value.height -
              parentInput.paddingBottom -
              parentInput.paddingTop;
          }

          if (input.alignSelf === "stretch") {
            element.value.height =
              parent.value.height -
              parentInput.paddingBottom -
              parentInput.paddingTop;
          }
        }

        if (parentInput.flexDirection === "column") {
          if (input.alignSelf === "center") {
            element.value.x =
              element.value.x +
              element.value.width / 2 -
              element.value.width / 2;
          }

          if (input.alignSelf === "flex-end") {
            element.value.x =
              element.value.x +
              parent.value.width -
              element.value.width -
              parentInput.paddingLeft -
              parentInput.paddingRight;
          }

          if (input.alignSelf === "stretch") {
            element.value.width =
              parent.value.width -
              parentInput.paddingLeft -
              parentInput.paddingRight;
          }
        }
      }

      if (input.aspectRatio) {
        if (parentInput.flexDirection === "row") {
          element.value.width = element.value.height * input.aspectRatio;
        }

        if (parentInput.flexDirection === "column") {
          element.value.height = element.value.width / input.aspectRatio;
        }
      }

      // Set sizes for children that use percentages.
      let p = element.firstChild;
      while (p) {
        if (typeof p.value.input.width === "string") {
          p.value.width =
            toPercentage(p.value.input.width) * element.value.width;
        }

        if (typeof p.value.input.height === "string") {
          p.value.height =
            toPercentage(p.value.input.height) * element.value.height;
        }

        p = p.next;
      }

      // Take zIndex from parent if not set.
      element.value.zIndex = input.zIndex ?? parent?.value.zIndex ?? 0;

      let availableWidth = element.value.width;
      let availableHeight = element.value.height;

      // Count children and total flex value.
      p = element.firstChild;
      while (p) {
        if (p.value.input.position === "relative") {
          childrenCount += 1;
        }

        if (
          input.flexDirection === "row" &&
          p.value.input.flex === undefined &&
          p.value.input.position === "relative"
        ) {
          availableWidth -= p.value.width;
        }

        if (
          input.flexDirection === "column" &&
          p.value.input.flex === undefined &&
          p.value.input.position === "relative"
        ) {
          availableHeight -= p.value.height;
        }

        // Calculate how many quads will be splitting the available space.
        if (input.flexDirection === "row" && p.value.input.flex !== undefined) {
          totalFlex += p.value.input.flex;
        }

        if (
          input.flexDirection === "column" &&
          p.value.input.flex !== undefined
        ) {
          totalFlex += p.value.input.flex;
        }

        p = p.next;
      }

      availableWidth -=
        input.paddingLeft +
        input.paddingRight +
        (input.flexDirection === "row" &&
        input.justifyContent !== "space-between" &&
        input.justifyContent !== "space-around" &&
        input.justifyContent !== "space-evenly"
          ? (childrenCount - 1) * input.gap
          : 0);

      availableHeight -=
        input.paddingTop +
        input.paddingBottom +
        (input.flexDirection === "column" &&
        input.justifyContent !== "space-between" &&
        input.justifyContent !== "space-around" &&
        input.justifyContent !== "space-evenly"
          ? (childrenCount - 1) * input.gap
          : 0);

      // Apply sizes.
      p = element.firstChild;
      while (p) {
        if (input.flexDirection === "row") {
          if (
            p.value.input.flex !== undefined &&
            input.justifyContent !== "space-between" &&
            input.justifyContent !== "space-evenly" &&
            input.justifyContent !== "space-around"
          ) {
            p.value.width = (p.value.input.flex / totalFlex) * availableWidth;
          }
        }

        if (input.flexDirection === "column") {
          if (
            p.value.input.flex !== undefined &&
            input.justifyContent !== "space-between" &&
            input.justifyContent !== "space-evenly" &&
            input.justifyContent !== "space-around"
          ) {
            p.value.height = (p.value.input.flex / totalFlex) * availableHeight;
          }
        }

        p = p.next;
      }

      element.value.x += input.marginLeft;
      element.value.y += input.marginTop;

      // Determine positions.
      let x = element.value.x + input.paddingLeft;
      let y = element.value.y + input.paddingTop;

      // Apply justify content.
      {
        if (input.flexDirection === "row") {
          if (input.justifyContent === "center") {
            x += availableWidth / 2;
          }

          if (input.justifyContent === "flex-end") {
            x += availableWidth;
          }
        }

        if (input.flexDirection === "column") {
          if (input.justifyContent === "center") {
            y += availableHeight / 2;
          }

          if (input.justifyContent === "flex-end") {
            y += availableHeight;
          }
        }
      }

      // NOTE: order of applying justify content, this and align items is important.
      if (input.justifyContent === "space-between") {
        const horizontalGap = availableWidth / (childrenCount - 1);
        const verticalGap = availableHeight / (childrenCount - 1);

        p = element.firstChild;
        while (p) {
          p.value.x = x;
          p.value.y = y;

          if (input.flexDirection === "row") {
            x += p.value.width + horizontalGap;
          }

          if (input.flexDirection === "column") {
            y += p.value.height + verticalGap;
          }

          p = p.next;
        }
      } else if (input.justifyContent === "space-around") {
        const horizontalGap = availableWidth / childrenCount;
        const verticalGap = availableHeight / childrenCount;

        p = element.firstChild;
        while (p) {
          p.value.x = x + horizontalGap / 2;
          p.value.y = y + verticalGap / 2;

          if (input.flexDirection === "row") {
            x += p.value.width + horizontalGap;
          }

          if (input.flexDirection === "column") {
            y += p.value.height + verticalGap;
          }

          p = p.next;
        }
      } else if (input.justifyContent === "space-evenly") {
        const horizontalGap = availableWidth / (childrenCount + 1);
        const verticalGap = availableHeight / (childrenCount + 1);

        p = element.firstChild;
        while (p) {
          p.value.x = x + horizontalGap;
          p.value.y = y + verticalGap;

          if (input.flexDirection === "row") {
            x += p.value.width + horizontalGap;
          }

          if (input.flexDirection === "column") {
            y += p.value.height + verticalGap;
          }

          p = p.next;
        }
      } else {
        p = element.firstChild;
        while (p) {
          if (
            p.value.input.position === "absolute" ||
            p.value.input.display === "none"
          ) {
            p = p.next;
            continue;
          }

          if (input.flexDirection === "row") {
            p.value.x = x;
            x += p.value.width;
            x += input.gap;
          } else {
            p.value.x = x + p.value.x;
          }

          if (input.flexDirection === "column") {
            p.value.y = y;
            y += p.value.height;
            y += input.gap;
          } else {
            p.value.y = y + p.value.y;
          }

          p = p.next;
        }
      }

      // Apply align items.
      {
        p = element.firstChild;
        while (p) {
          if (p.value.input.position === "absolute") {
            p = p.next;
            continue;
          }

          if (input.flexDirection === "row") {
            if (input.alignItems === "center") {
              p.value.y =
                element.value.y + element.value.height / 2 - p.value.height / 2;
            }

            if (input.alignItems === "flex-end") {
              p.value.y =
                element.value.y +
                element.value.height -
                p.value.height -
                input.paddingBottom;
            }

            if (
              input.alignItems === "stretch" &&
              p.value.input.height === undefined
            ) {
              p.value.height =
                element.value.height - input.paddingTop - input.paddingBottom;
            }
          }

          if (input.flexDirection === "column") {
            if (input.alignItems === "center") {
              p.value.x =
                element.value.x + element.value.width / 2 - p.value.width / 2;
            }

            if (input.alignItems === "flex-end") {
              p.value.x =
                element.value.x +
                element.value.width -
                p.value.width -
                input.paddingRight;
            }

            if (
              input.alignItems === "stretch" &&
              p.value.input.width === undefined
            ) {
              p.value.width =
                element.value.width - input.paddingLeft - input.paddingRight;
            }
          }

          p = p.next;
        }
      }

      // Round to whole pixels.
      element.value.x = Math.round(element.value.x);
      element.value.y = Math.round(element.value.y);
      element.value.width = Math.round(element.value.width);
      element.value.height = Math.round(element.value.height);

      // Trim to parent. Skip text as it would move it and we want to trim it
      // properly.
      // TODO: this only works for direct descendants. It needs different design
      // to be a true implementation of `overflow: hidden`.
      // if (parent && !("text" in element.value.input)) {
      //   if (element.value.x < parent.value.x) {
      //     element.value.width -= parent.value.x - element.value.x;
      //     element.value.x = parent.value.x;
      //   }

      //   if (element.value.y < parent.value.y) {
      //     element.value.height -= parent.value.y - element.value.y;
      //     element.value.y = parent.value.y;
      //   }

      //   if (
      //     element.value.x + element.value.width >
      //     parent.value.x + parent.value.width
      //   ) {
      //     element.value.width =
      //       parent.value.x + parent.value.width - element.value.x;
      //   }

      //   if (
      //     element.value.y + element.value.height >
      //     parent.value.y + parent.value.height
      //   ) {
      //     element.value.height =
      //       parent.value.y + parent.value.height - element.value.y;
      //   }
      // }
    }
  }

  /**
   * Render the tree to the context. Most of the time it means that this step is
   * what takes UI to appear on the screen.
   */
  render(): void {
    this.calculate();
    const list: FixedView[] = [];

    // Traverse the tree in DFS order to respect local order of components
    // (unlike in level order traversal).
    const queue = new Queue<TreeNode<FixedView>>();
    queue.enqueue(this.root as TreeNode<FixedView>);

    while (!queue.isEmpty()) {
      const node = queue.dequeueFront();
      invariant(node, "Node should not be null.");

      list.push(node.value);

      let p = node.lastChild;
      while (p) {
        if (
          p.value.width < 0.1 ||
          p.value.height < 0.1 ||
          p.value.input.display === "none"
        ) {
          p = p.prev;
          continue;
        }

        queue.enqueue(p);
        p = p.prev;
      }
    }

    list.sort((a, b) => a.zIndex - b.zIndex);

    for (const view of list) {
      if ("text" in view.input) {
        if (view.input.color) {
          if (view.input.trimRectangle) {
            const { trimRectangle } = view.input;

            this.context.text(
              view.input.text,
              new Vec2(view.x, view.y),
              view.input.fontSize,
              parseColor(view.input.color),
              new Vec2(trimRectangle[0], trimRectangle[1]),
              new Vec2(trimRectangle[2], trimRectangle[3])
            );
          } else {
            this.context.text(
              view.input.text,
              new Vec2(view.x, view.y),
              view.input.fontSize,
              parseColor(view.input.color)
            );
          }
        }
      } else if ("points" in view.input) {
        if (view.input.type === "polygon") {
          this.context.polygon(
            view.input.points.map(([x, y]) => new Vec2(x + view.x, y + view.y)),
            view.backgroundColor
          );
        } else if (view.input.type === "line") {
          this.context.line(
            view.input.points.map(([x, y]) => new Vec2(x + view.x, y + view.y)),
            view.input.thickness,
            view.backgroundColor
          );
        }
      } else {
        if (view.backgroundColor.w === 0) {
          continue;
        }

        const input = view.input as ResolvedInput;

        this.context.rectangle(
          new Vec2(view.x, view.y),
          new Vec2(view.width, view.height),
          view.backgroundColor,
          new Vec4(
            input.borderRadiusTopLeft,
            input.borderRadiusTopRight,
            input.borderRadiusBottomRight,
            input.borderRadiusBottomLeft
          ),
          new Vec4(
            input.borderTopWidth,
            input.borderRightWidth,
            input.borderBottomWidth,
            input.borderLeftWidth
          ),
          view.borderColor
        );
      }
    }
  }
}
