import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// Model and tool output is untrusted: raw HTML is never parsed, and the tree is
// sanitized before highlighting adds its (trusted) class names.
const rehypePlugins = [rehypeSanitize, [rehypeHighlight, { detect: false }]] as const;
const remarkPlugins = [remarkGfm];

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:bg-muted prose-pre:text-foreground">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins as never}
        components={components}
      >
        {text}
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
