import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RichTextRenderer } from "../RichTextRenderer";

describe("RichTextRenderer — sanitizer", () => {
  it("renders GFM task list checkbox for unchecked item", () => {
    const { container } = render(<RichTextRenderer content="- [ ] task" />);
    const checkbox = container.querySelector("input[type=checkbox]");
    expect(checkbox).not.toBeNull();
    expect(checkbox?.hasAttribute("disabled")).toBe(true);
    expect(checkbox?.hasAttribute("checked")).toBe(false);
  });

  it("renders GFM task list checkbox for checked item", () => {
    const { container } = render(<RichTextRenderer content="- [x] done" />);
    const checkbox = container.querySelector("input[type=checkbox]");
    expect(checkbox).not.toBeNull();
    expect(checkbox?.hasAttribute("disabled")).toBe(true);
    expect(checkbox?.hasAttribute("checked")).toBe(true);
  });

  it("removes input with non-checkbox type", () => {
    const { container } = render(
      <RichTextRenderer content={'<input type="text" name="evil">after'} />,
    );
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain("after");
  });

  it("removes input without type attribute", () => {
    const { container } = render(
      <RichTextRenderer content={'<input name="evil">after'} />,
    );
    expect(container.querySelector("input")).toBeNull();
  });

  it("strips non-allowed attributes from checkbox input", () => {
    const { container } = render(
      <RichTextRenderer content={'<input type="checkbox" name="evil" onclick="alert(1)" disabled>after'} />,
    );
    const checkbox = container.querySelector("input");
    expect(checkbox).not.toBeNull();
    expect(checkbox?.hasAttribute("disabled")).toBe(true);
    expect(checkbox?.hasAttribute("name")).toBe(false);
    expect(checkbox?.hasAttribute("onclick")).toBe(false);
  });
});

describe("RichTextRenderer — markdown rendering", () => {
  it("renders GFM table with proper structure", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |";
    const { container } = render(<RichTextRenderer content={md} />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("thead")).not.toBeNull();
    expect(container.querySelector("tbody")).not.toBeNull();
    expect(container.querySelectorAll("th").length).toBe(2);
    expect(container.querySelectorAll("td").length).toBe(2);
  });

  it("preserves align attribute on th/td from GFM alignment syntax", () => {
    const md = "| Left | Center | Right |\n|:-----|:------:|------:|\n| 1 | 2 | 3 |";
    const { container } = render(<RichTextRenderer content={md} />);
    const ths = container.querySelectorAll("th");
    expect(ths[0]?.getAttribute("align")).toBe("left");
    expect(ths[1]?.getAttribute("align")).toBe("center");
    expect(ths[2]?.getAttribute("align")).toBe("right");
  });

  it("renders headings h1-h6", () => {
    const md = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6";
    const { container } = render(<RichTextRenderer content={md} />);
    for (let i = 1; i <= 6; i++) {
      expect(container.querySelector(`h${i}`)).not.toBeNull();
    }
  });

  it("renders blockquote", () => {
    const { container } = render(<RichTextRenderer content="> quote" />);
    expect(container.querySelector("blockquote")).not.toBeNull();
  });

  it("renders hr", () => {
    const { container } = render(<RichTextRenderer content="---" />);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders ordered list with li elements", () => {
    const { container } = render(<RichTextRenderer content={"1. first\n2. second"} />);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol?.querySelectorAll("li").length).toBe(2);
  });

  it("renders unordered list with li elements", () => {
    const { container } = render(<RichTextRenderer content={"- a\n- b"} />);
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul?.querySelectorAll("li").length).toBe(2);
  });

  it("renders inline code and code block distinctly", () => {
    const md = "inline `code` here\n\n```\nblock code\n```";
    const { container } = render(<RichTextRenderer content={md} />);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.querySelector("code")).not.toBeNull();
  });
});
