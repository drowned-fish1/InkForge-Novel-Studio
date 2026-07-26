import { Fragment, useMemo, type ReactNode } from "react";
import { marked } from "marked";

interface MarkdownToken {
  type: string;
  text?: string;
  raw?: string;
  depth?: number;
  href?: string;
  title?: string | null;
  lang?: string;
  ordered?: boolean;
  start?: number | "";
  tokens?: MarkdownToken[];
  items?: Array<MarkdownToken & { task?: boolean; checked?: boolean }>;
  header?: Array<{ text?: string; tokens?: MarkdownToken[] }>;
  rows?: Array<Array<{ text?: string; tokens?: MarkdownToken[] }>>;
}

interface MarkdownContentProps {
  content: string;
  className?: string;
}

const safeLink = (href?: string): string | undefined => {
  if (!href) {
    return undefined;
  }
  const value = href.trim();
  if (/^(https?:|mailto:)/iu.test(value) || value.startsWith("#")) {
    return value;
  }
  return undefined;
};

const renderTokens = (tokens: MarkdownToken[] | undefined, prefix: string): ReactNode =>
  tokens?.map((token, index) => {
    const key = `${prefix}-${token.type}-${index}`;
    const children = token.tokens?.length ? renderTokens(token.tokens, key) : token.text;

    switch (token.type) {
      case "space":
        return null;
      case "text":
      case "escape":
        return <Fragment key={key}>{children}</Fragment>;
      case "paragraph":
        return <p key={key}>{children}</p>;
      case "strong":
        return <strong key={key}>{children}</strong>;
      case "em":
        return <em key={key}>{children}</em>;
      case "del":
        return <del key={key}>{children}</del>;
      case "codespan":
        return <code key={key}>{token.text}</code>;
      case "code":
        return (
          <pre key={key}>
            <code data-language={token.lang || undefined}>{token.text}</code>
          </pre>
        );
      case "heading": {
        const level = Math.min(6, Math.max(1, token.depth ?? 2));
        const Heading = `h${level}` as keyof React.JSX.IntrinsicElements;
        return <Heading key={key}>{children}</Heading>;
      }
      case "blockquote":
        return <blockquote key={key}>{renderTokens(token.tokens, key)}</blockquote>;
      case "list": {
        const List = token.ordered ? "ol" : "ul";
        return (
          <List key={key} start={token.ordered && typeof token.start === "number" ? token.start : undefined}>
            {token.items?.map((item, itemIndex) => (
              <li key={`${key}-item-${itemIndex}`}>
                {item.task ? (
                  <span className="markdown-task-state" aria-label={item.checked ? "已完成" : "未完成"}>
                    {item.checked ? "✓" : "○"}
                  </span>
                ) : null}
                {renderTokens(item.tokens, `${key}-item-${itemIndex}`)}
              </li>
            ))}
          </List>
        );
      }
      case "link": {
        const href = safeLink(token.href);
        return href ? (
          <a href={href} key={key} rel="noreferrer" target="_blank" title={token.title || undefined}>
            {children}
          </a>
        ) : (
          <Fragment key={key}>{children}</Fragment>
        );
      }
      case "image":
        return (
          <span className="markdown-image-note" key={key}>
            图片：{token.text || "未命名"}
          </span>
        );
      case "br":
        return <br key={key} />;
      case "hr":
        return <hr key={key} />;
      case "table":
        return (
          <div className="markdown-table-wrap" key={key}>
            <table>
              <thead>
                <tr>
                  {token.header?.map((cell, cellIndex) => (
                    <th key={`${key}-head-${cellIndex}`}>
                      {renderTokens(cell.tokens, `${key}-head-${cellIndex}`) ?? cell.text}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {token.rows?.map((row, rowIndex) => (
                  <tr key={`${key}-row-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${key}-row-${rowIndex}-${cellIndex}`}>
                        {renderTokens(cell.tokens, `${key}-row-${rowIndex}-${cellIndex}`) ?? cell.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "html":
        return token.text ? <Fragment key={key}>{token.text}</Fragment> : null;
      default:
        return <Fragment key={key}>{children ?? token.raw}</Fragment>;
    }
  });

export const MarkdownContent = ({ content, className = "" }: MarkdownContentProps) => {
  const tokens = useMemo(
    () => marked.lexer(content, { gfm: true, breaks: true }) as unknown as MarkdownToken[],
    [content]
  );

  return <div className={`markdown-content ${className}`.trim()}>{renderTokens(tokens, "markdown")}</div>;
};
