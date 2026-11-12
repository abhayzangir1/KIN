import React from 'react';
import {
  Info,
  Lightbulb,
  AlertTriangle,
  AlertOctagon,
  Flame,
  CheckSquare,
  Square,
  ExternalLink,
} from 'lucide-react';
import { CodeBlock } from '../code/CodeBlock.js';

interface MarkdownPreviewProps {
  content: string;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content }) => {
  if (!content) {
    return <div className="text-kin-muted text-xs italic p-4">No content to preview.</div>;
  }

  // Parse inline formatting (bold, italic, code, link, image, strikethrough)
  const renderInline = (text: string): React.ReactNode => {
    // Regex for inline elements
    const parts = text.split(
      /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|~~[^~]+~~|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))/g
    );

    return parts.map((part, idx) => {
      if (!part) return null;

      // Inline Code: `code`
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
        return (
          <code
            key={idx}
            className="px-1.5 py-0.5 mx-0.5 rounded bg-kin-card border border-kin-border font-mono text-[11px] text-emerald-400"
          >
            {part.slice(1, -1)}
          </code>
        );
      }

      // Bold: **text**
      if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
        return (
          <strong key={idx} className="font-bold text-kin-text">
            {renderInline(part.slice(2, -2))}
          </strong>
        );
      }

      // Italic: *text* or __text__
      if (
        (part.startsWith('*') && part.endsWith('*') && part.length >= 2) ||
        (part.startsWith('__') && part.endsWith('__') && part.length >= 4)
      ) {
        const inner = part.startsWith('__') ? part.slice(2, -2) : part.slice(1, -1);
        return (
          <em key={idx} className="italic text-kin-text/90">
            {renderInline(inner)}
          </em>
        );
      }

      // Strikethrough: ~~text~~
      if (part.startsWith('~~') && part.endsWith('~~') && part.length >= 4) {
        return (
          <del key={idx} className="line-through text-kin-muted">
            {renderInline(part.slice(2, -2))}
          </del>
        );
      }

      // Image: ![alt](url)
      const imgMatch = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imgMatch) {
        return (
          <img
            key={idx}
            src={imgMatch[2]}
            alt={imgMatch[1]}
            className="max-h-64 rounded-lg border border-kin-border my-2 object-contain"
          />
        );
      }

      // Link: [text](url)
      const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        return (
          <a
            key={idx}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-kin-accent hover:underline inline-flex items-center space-x-0.5 font-medium"
          >
            <span>{linkMatch[1]}</span>
            <ExternalLink className="w-2.5 h-2.5 ml-0.5 opacity-70" />
          </a>
        );
      }

      return part;
    });
  };

  // Block parser
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Fenced Code Block
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // Skip closing ``` if present
      elements.push(
        <div key={`code-${i}`} className="my-2">
          <CodeBlock language={lang} code={codeLines.join('\n')} />
        </div>
      );
      continue;
    }

    // 2. Headings
    if (line.startsWith('#')) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2];
        if (level === 1) {
          elements.push(
            <h1
              key={`h-${i}`}
              className="text-xl sm:text-2xl font-bold text-kin-text border-b border-kin-border pb-2 mt-5 mb-3 tracking-tight"
            >
              {renderInline(text)}
            </h1>
          );
        } else if (level === 2) {
          elements.push(
            <h2
              key={`h-${i}`}
              className="text-lg sm:text-xl font-bold text-kin-text border-b border-kin-border/60 pb-1.5 mt-4 mb-2 tracking-tight"
            >
              {renderInline(text)}
            </h2>
          );
        } else if (level === 3) {
          elements.push(
            <h3
              key={`h-${i}`}
              className="text-base sm:text-lg font-semibold text-kin-text mt-3 mb-1.5"
            >
              {renderInline(text)}
            </h3>
          );
        } else {
          elements.push(
            <h4
              key={`h-${i}`}
              className="text-xs sm:text-sm font-semibold text-kin-text mt-2.5 mb-1 text-kin-muted"
            >
              {renderInline(text)}
            </h4>
          );
        }
        i++;
        continue;
      }
    }

    // 3. Horizontal Rule
    if (/^(---|___|\*\*\*)\s*$/.test(line.trim())) {
      elements.push(<hr key={`hr-${i}`} className="my-4 border-kin-border" />);
      i++;
      continue;
    }

    // 4. GitHub-style Alert Callouts & Blockquotes
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const firstLine = quoteLines[0] || '';
      const alertMatch = firstLine.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);

      if (alertMatch) {
        const alertType = alertMatch[1].toUpperCase();
        const alertBody = quoteLines.slice(1).join('\n').trim();

        let alertStyle = {
          border: 'border-blue-500/40',
          bg: 'bg-blue-500/10',
          text: 'text-blue-400',
          icon: <Info className="w-4 h-4 shrink-0 text-blue-400" />,
          title: 'Note',
        };

        if (alertType === 'TIP') {
          alertStyle = {
            border: 'border-emerald-500/40',
            bg: 'bg-emerald-500/10',
            text: 'text-emerald-400',
            icon: <Lightbulb className="w-4 h-4 shrink-0 text-emerald-400" />,
            title: 'Tip',
          };
        } else if (alertType === 'IMPORTANT') {
          alertStyle = {
            border: 'border-cyan-500/40',
            bg: 'bg-cyan-500/10',
            text: 'text-cyan-400',
            icon: <Flame className="w-4 h-4 shrink-0 text-cyan-400" />,
            title: 'Important',
          };
        } else if (alertType === 'WARNING') {
          alertStyle = {
            border: 'border-amber-500/40',
            bg: 'bg-amber-500/10',
            text: 'text-amber-400',
            icon: <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />,
            title: 'Warning',
          };
        } else if (alertType === 'CAUTION') {
          alertStyle = {
            border: 'border-rose-500/40',
            bg: 'bg-rose-500/10',
            text: 'text-rose-400',
            icon: <AlertOctagon className="w-4 h-4 shrink-0 text-rose-400" />,
            title: 'Caution',
          };
        }

        elements.push(
          <div
            key={`alert-${i}`}
            className={`my-3 p-3.5 rounded-xl border ${alertStyle.border} ${alertStyle.bg} space-y-1.5`}
          >
            <div className={`flex items-center space-x-2 font-bold text-xs uppercase tracking-wider ${alertStyle.text}`}>
              {alertStyle.icon}
              <span>{alertStyle.title}</span>
            </div>
            <div className="text-xs text-kin-text leading-relaxed whitespace-pre-wrap pl-6">
              {renderInline(alertBody)}
            </div>
          </div>
        );
        continue;
      }

      // Standard Blockquote
      elements.push(
        <blockquote
          key={`bq-${i}`}
          className="border-l-4 border-kin-accent/70 bg-kin-accent/10 pl-3.5 py-1.5 my-2.5 text-xs text-kin-text/90 italic rounded-r leading-relaxed whitespace-pre-wrap"
        >
          {renderInline(quoteLines.join('\n'))}
        </blockquote>
      );
      continue;
    }

    // 5. Markdown Tables (| col1 | col2 |)
    if (line.includes('|') && lines[i + 1]?.includes('|') && /\|?\s*[-:]+[-| :]*\|?/.test(lines[i + 1])) {
      const headerLine = line;
      const tableRows: string[] = [];
      i += 2;

      while (i < lines.length && lines[i].includes('|')) {
        tableRows.push(lines[i]);
        i++;
      }

      const parseCells = (row: string) => {
        const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
        return trimmed.split('|').map((c) => c.trim());
      };

      const headers = parseCells(headerLine);
      const rows = tableRows.map(parseCells);

      elements.push(
        <div key={`table-${i}`} className="my-3 overflow-x-auto rounded-xl border border-kin-border">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-kin-card border-b border-kin-border">
                {headers.map((h, hIdx) => (
                  <th key={hIdx} className="py-2.5 px-3 font-semibold text-kin-text border-r border-kin-border last:border-r-0">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className="border-b border-kin-border/50 last:border-b-0 hover:bg-kin-cardHover transition font-mono text-[11px]"
                >
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="py-2 px-3 text-kin-text border-r border-kin-border/50 last:border-r-0"
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 6. Lists (Task lists, Bullet lists, Numbered lists)
    if (/^\s*([*+-]|\d+\.)\s+/.test(line)) {
      const listItems: { text: string; isTask?: boolean; checked?: boolean; isOrdered?: boolean; num?: string }[] = [];

      while (i < lines.length && /^\s*([*+-]|\d+\.)\s+/.test(lines[i])) {
        const current = lines[i];
        const taskMatch = current.match(/^\s*[*+-]\s+\[([ xX])\]\s+(.*)$/);
        if (taskMatch) {
          listItems.push({
            text: taskMatch[2],
            isTask: true,
            checked: taskMatch[1].toLowerCase() === 'x',
          });
        } else {
          const orderedMatch = current.match(/^\s*(\d+)\.\s+(.*)$/);
          if (orderedMatch) {
            listItems.push({
              text: orderedMatch[2],
              isOrdered: true,
              num: orderedMatch[1],
            });
          } else {
            const bulletMatch = current.match(/^\s*[*+-]\s+(.*)$/);
            listItems.push({
              text: bulletMatch ? bulletMatch[1] : current,
            });
          }
        }
        i++;
      }

      elements.push(
        <ul key={`list-${i}`} className="my-2.5 space-y-1 text-xs">
          {listItems.map((item, idx) => (
            <li key={idx} className="flex items-start space-x-2 leading-relaxed">
              {item.isTask ? (
                <span className="mt-0.5 shrink-0 text-kin-accent">
                  {item.checked ? (
                    <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Square className="w-3.5 h-3.5 text-kin-muted" />
                  )}
                </span>
              ) : item.isOrdered ? (
                <span className="font-mono text-kin-muted shrink-0 text-[11px] w-5 text-right mr-1">
                  {item.num}.
                </span>
              ) : (
                <span className="text-kin-accent shrink-0 text-sm leading-none mt-0.5">•</span>
              )}
              <span className={item.checked ? 'line-through text-kin-muted' : 'text-kin-text'}>
                {renderInline(item.text)}
              </span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 7. Regular Paragraphs
    if (line.trim().length > 0) {
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim().length > 0 &&
        !lines[i].startsWith('#') &&
        !lines[i].startsWith('```') &&
        !lines[i].startsWith('>') &&
        !/^\s*([*+-]|\d+\.)\s+/.test(lines[i]) &&
        !lines[i].includes('|')
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      elements.push(
        <p key={`p-${i}`} className="my-2 text-xs sm:text-sm text-kin-text leading-relaxed">
          {renderInline(paraLines.join(' '))}
        </p>
      );
      continue;
    }

    i++;
  }

  return <div className="space-y-1 text-kin-text font-sans">{elements}</div>;
};
