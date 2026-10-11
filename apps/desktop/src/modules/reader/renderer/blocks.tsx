import { Fragment, type ReactNode } from "react";
import { resolvePackPath, type ReaderBlock, type ReaderInline } from "@nexus/core";

/**
 * The article's blocks as React elements (ADR-100).
 *
 * **Why elements and never HTML.** The text in a pack is a stranger's, and this is
 * the only place it becomes something a browser draws. Every node below is built
 * by React, so the worst a pack's text can do is render as text: there is no
 * `dangerouslySetInnerHTML` in this file, and the parser upstream refused raw HTML
 * and unsafe link targets before the text ever got here.
 *
 * **Why a relative link is a button and an http one is an anchor.** An `http(s)`
 * address leaves the app, and it leaves through main's one external-open call; a
 * relative path names another article IN THIS PACK, so it is navigation inside
 * the page and is drawn as a button that jumps there. A relative path that names
 * nothing in the pack stays plain text, because a link that does nothing when
 * pressed is worse than a sentence.
 */

export interface ReaderBlocksProps {
  readonly blocks: readonly ReaderBlock[];
  readonly packId: string;
  /** The article these blocks came from, so a relative link resolves against it. */
  readonly articlePath: string;
  /** The article paths this pack holds, so a relative link can be known to exist. */
  readonly known: ReadonlySet<string>;
  readonly onOpenArticle: (path: string) => void;
  readonly onOpenExternal: (url: string) => void;
}

export function ReaderBlocks({
  blocks,
  packId,
  articlePath,
  known,
  onOpenArticle,
  onOpenExternal,
}: ReaderBlocksProps): ReactNode {
  return blocks.map((block, index) => (
    <Fragment key={index}>{renderBlock(block, packId, articlePath, known, onOpenArticle, onOpenExternal)}</Fragment>
  ));
}

function renderBlock(
  block: ReaderBlock,
  packId: string,
  articlePath: string,
  known: ReadonlySet<string>,
  onOpenArticle: (path: string) => void,
  onOpenExternal: (url: string) => void,
): ReactNode {
  const inline = (nodes: readonly ReaderInline[]): ReactNode => (
    <>{renderInline(nodes, packId, articlePath, known, onOpenArticle, onOpenExternal)}</>
  );
  switch (block.type) {
    case "heading":
      // The article's own title is the page's `h1`, so a pack's first-level
      // heading is drawn at the second level: one heading per screen, and the
      // document's outline stays a tree rather than restarting.
      return block.level === 1 ? (
        <h2>{inline(block.children)}</h2>
      ) : block.level === 2 ? (
        <h3>{inline(block.children)}</h3>
      ) : (
        <h4>{inline(block.children)}</h4>
      );
    case "paragraph":
      return <p>{inline(block.children)}</p>;
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index}>
          {item.map((child, at) => (
            <Fragment key={at}>
              {renderBlock(child, packId, articlePath, known, onOpenArticle, onOpenExternal)}
            </Fragment>
          ))}
        </li>
      ));
      return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "quote":
      return (
        <blockquote>
          {block.children.map((child, index) => (
            <Fragment key={index}>
              {renderBlock(child, packId, articlePath, known, onOpenArticle, onOpenExternal)}
            </Fragment>
          ))}
        </blockquote>
      );
    case "code":
      return (
        <pre className="reader__code">
          <code>{block.text}</code>
        </pre>
      );
    case "table":
      return (
        <div className="reader__table-wrap">
          <table className="reader__table">
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, at) => (
                    <td key={at}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr />;
  }
}

function renderInline(
  nodes: readonly ReaderInline[],
  packId: string,
  articlePath: string,
  known: ReadonlySet<string>,
  onOpenArticle: (path: string) => void,
  onOpenExternal: (url: string) => void,
): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <Fragment key={index}>{node.value}</Fragment>;
      case "code":
        return <code key={index}>{node.value}</code>;
      case "strong":
        return <strong key={index}>{renderInline(node.children, packId, articlePath, known, onOpenArticle, onOpenExternal)}</strong>;
      case "emphasis":
        return <em key={index}>{renderInline(node.children, packId, articlePath, known, onOpenArticle, onOpenExternal)}</em>;
      case "link": {
        const label = renderInline(node.children, packId, articlePath, known, onOpenArticle, onOpenExternal);
        if (node.external) {
          return (
            <a
              key={index}
              className="reader__link"
              href={node.href}
              rel="noreferrer noopener"
              target="_blank"
              onClick={(event) => {
                // The window-open handler denies every new window (SEC-EL-03), so
                // the click is intercepted here and the address is opened through
                // main's one vetted call instead.
                event.preventDefault();
                onOpenExternal(node.href);
              }}
            >
              {label}
            </a>
          );
        }
        const target = resolvePackPath(articlePath, node.href);
        if (target !== null && known.has(target)) {
          return (
            <button
              key={index}
              type="button"
              className="reader__link"
              onClick={() => onOpenArticle(target)}
            >
              {label}
            </button>
          );
        }
        return <Fragment key={index}>{label}</Fragment>;
      }
      case "image": {
        const target = resolvePackPath(articlePath, node.src);
        // A remote image is left to the pack's own address; a relative one is
        // served by `nx-pack:`, which serves only paths an installed pack lists.
        const src = node.src.startsWith("http")
          ? node.src
          : target === null
            ? null
            : `nx-pack://${packId}/${target}`;
        if (src === null) return <Fragment key={index}>{node.alt}</Fragment>;
        return (
          <img
            key={index}
            className="reader__image"
            src={src}
            alt={node.alt}
            loading="lazy"
            decoding="async"
          />
        );
      }
    }
  });
}
