import "katex/dist/katex.min.css";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

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

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
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

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:bg-muted prose-pre:text-foreground">
      <ReactMarkdown
        remarkPlugins={remarkPlugins as never}
        rehypePlugins={rehypePlugins as never}
        components={components}
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
