import "katex/dist/katex.min.css";
import { type ReactNode, useRef } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CopyButton } from "@/components/CopyButton";

// remark-math marks math as <code class="language-math math-inline|math-display">;
// keep those classes through sanitizing so rehype-katex can find them.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-./, "math-inline", "math-display"],
    ],
  },
};

// Model and tool output is untrusted: raw HTML is never parsed, and the tree is
// sanitized before KaTeX and highlighting add their (trusted) markup.
const rehypePlugins = [
  [rehypeSanitize, sanitizeSchema],
  [rehypeKatex, { trust: false, throwOnError: false, strict: "ignore" }],
  [rehypeHighlight, { detect: false }],
] as const;
// Single $ is left as text so prices ("$5 and $10") never turn into math.
const remarkPlugins = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]];

type Element = NonNullable<ExtraProps["node"]>;

/** The `language-*` class remark puts on a fence's `<code>`, if the fence named one. */
export function languageOf(pre: Element | undefined): string | null {
  const code = pre?.children[0];
  if (code?.type !== "element" || code.tagName !== "code") return null;
  const classes = code.properties.className;
  if (!Array.isArray(classes)) return null;
  for (const name of classes) {
    const match = /^language-(.+)$/.exec(String(name));
    if (match?.[1]) return match[1];
  }
  return null;
}

/** A fenced block: a header with the language and a copy button over a scrolling `<pre>`. */
function CodeBlock({ language, children }: { language: string | null; children: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  return (
    <div className="not-prose my-3 overflow-hidden rounded-lg border border-border/70 bg-code text-code-foreground">
      <div className="flex h-8 items-center justify-between border-b border-border/70 pr-0.5 pl-3 font-mono text-[0.75rem] text-muted-foreground">
        <span>{language ?? "text"}</span>
        <CopyButton label="Copy code" text={() => pre.current?.textContent ?? ""} />
      </div>
      <pre ref={pre} className="overflow-x-auto p-3 font-mono text-[0.9em] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  pre: ({ node, children }) => <CodeBlock language={languageOf(node)}>{children}</CodeBlock>,
  // Wide tables scroll on their own instead of widening the message.
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  ),
};

/** For code inside another frame (tool cards): fenced blocks without the header bar. */
const bareComponents: Components = {
  ...components,
  pre: ({ node: _node, children }) => (
    <pre className="not-prose overflow-x-auto p-3 font-mono leading-relaxed">{children}</pre>
  ),
};

/** LLMs often write \( … \) and \[ … \]; remark-math only knows $$ delimiters. */
export function normalizeMath(text: string): string {
  // Leave code spans and fenced blocks untouched.
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((chunk, i) =>
      i % 2 === 1
        ? chunk
        : chunk
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, math: string) => `\n$$\n${math.trim()}\n$$\n`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, math: string) => `$$${math.trim()}$$`),
    )
    .join("");
}

export function Markdown({ text, bare = false }: { text: string; bare?: boolean }) {
  return (
    <div className="markdown prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={remarkPlugins as never}
        rehypePlugins={rehypePlugins as never}
        components={bare ? bareComponents : components}
      >
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  );
}

/** A fenced code block that no backtick run inside `code` can close early. */
export function fenced(code: string, language = ""): string {
  const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${code}\n${fence}`;
}
