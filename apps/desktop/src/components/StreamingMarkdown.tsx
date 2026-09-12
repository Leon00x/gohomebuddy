import { memo, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

function extractLang(children: React.ReactNode): string {
  const child = Array.isArray(children) ? children[0] : children;
  const cls =
    (child as { props?: { className?: string } } | undefined)?.props?.className ?? "";
  const m = /language-([\w-]+)/.exec(cls);
  return m ? m[1] : "";
}

/** 代码块：语言标签 + 复制按钮。 */
function CodeBlock({
  children,
  node: _node,
  ...rest
}: React.ComponentPropsWithoutRef<"pre"> & { node?: unknown }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const lang = extractLang(children);
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang || "文本"}</span>
        <button
          aria-label="复制代码"
          onClick={() => {
            const text = preRef.current?.textContent ?? "";
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <pre ref={preRef} {...rest}>
        {children}
      </pre>
    </div>
  );
}

const BlockMarkdown = memo(function BlockMarkdown({ text }: { text: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>{text}</Markdown>;
});

/**
 * 流式 Markdown：按最后一个空行切分，已完成段落 memo 缓存不重渲染，
 * 增量帧只重解析末尾片段，避免长回复全量重渲染造成卡顿。
 */
export function StreamingMarkdown({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const { stable, tail } = useMemo(() => {
    if (streaming && content.includes("\n\n")) {
      const i = content.lastIndexOf("\n\n");
      return { stable: content.slice(0, i + 2), tail: content.slice(i + 2) };
    }
    return { stable: content, tail: "" };
  }, [content, streaming]);

  if (!streaming || !tail) {
    return <BlockMarkdown text={content} />;
  }
  return (
    <>
      <BlockMarkdown text={stable} />
      <BlockMarkdown text={tail} />
    </>
  );
}
