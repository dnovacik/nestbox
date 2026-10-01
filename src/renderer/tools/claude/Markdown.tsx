import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/lib/api';

interface MdNode {
  type: string;
  children?: MdNode[];
}

/** remark plugin: raw HTML becomes literal text, so the preview shows it instead of dropping it. */
function htmlAsText() {
  const walk = (node: MdNode) => {
    if (node.type === 'html') node.type = 'text';
    node.children?.forEach(walk);
  };
  return (tree: MdNode) => walk(tree);
}

/** Opens http(s) links in the browser; anything else (relative paths, file:, javascript:) does nothing. */
function Link({ href, children }: { href?: string | undefined; children?: React.ReactNode }) {
  const external = href !== undefined && /^https?:\/\//i.test(href);
  return (
    <a
      href={href}
      className={external ? 'text-brand hover:underline' : 'text-fg-muted'}
      title={external ? href : undefined}
      onClick={(e) => {
        e.preventDefault();
        if (external) void api.app.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

const components: Components = {
  h1: ({ children }) => <h1 className="mt-4 mb-2 text-lg font-semibold text-fg first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-4 mb-2 text-base font-semibold text-fg first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-sm font-semibold text-fg first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-medium text-fg first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-0.5 pl-5">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-line pl-3 text-fg-muted">{children}</blockquote>,
  code: ({ children }) => <code className="rounded bg-surface px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md bg-surface p-3 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
  table: ({ children }) => <table className="my-2 border-collapse text-xs">{children}</table>,
  th: ({ children }) => <th className="border border-line px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-line px-2 py-1">{children}</td>,
  hr: () => <hr className="my-3 border-line" />,
  a: ({ href, children }) => <Link href={href}>{children}</Link>,
  // Images would load from the network or the disk: show the alt text instead.
  img: ({ alt }) => <span className="text-fg-faint">[{alt ?? 'image'}]</span>,
};

/** Renders Markdown with GitHub extensions. Raw HTML is never rendered: it shows as text. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm text-fg">
      <ReactMarkdown remarkPlugins={[remarkGfm, htmlAsText]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
