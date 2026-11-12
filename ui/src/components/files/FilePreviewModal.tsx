import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  FileText,
  FileCode,
  Image as ImageIcon,
  Copy,
  Check,
  File,
  Table,
  Eye,
  Code2,
  Volume2,
  Video,
  FileSpreadsheet,
  FileArchive,
} from 'lucide-react';
import { useKinStore } from '../../store/kinStore.js';
import { CodeBlock } from '../code/CodeBlock.js';

export const FilePreviewModal: React.FC = () => {
  const { previewFile, closeFilePreview, addToast, activeProjectId } = useKinStore();
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [copied, setCopied] = useState<boolean>(false);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'rendered' | 'code' | 'table'>('rendered');

  function isTextOrCode(fn: string, mime: string = '') {
    if (mime.startsWith('text/') || mime === 'application/json') return true;
    return /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|json|md|markdown|txt|text|html|htm|css|scss|sass|less|yaml|yml|sh|bash|zsh|bat|cmd|ps1|sql|env|xml|log|csv|tsv|ini|conf|config|toml|properties|diff|patch|dockerfile|gitignore)$/i.test(fn);
  }

  function isImage(fn: string, mime: string = '') {
    if (mime.startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(fn);
  }

  function isPdf(fn: string, mime: string = '') {
    if (mime === 'application/pdf') return true;
    return /\.pdf$/i.test(fn);
  }

  function isHtml(fn: string, mime: string = '') {
    if (mime === 'text/html') return true;
    return /\.(html|htm)$/i.test(fn);
  }

  function isMarkdown(fn: string) {
    return /\.(md|markdown)$/i.test(fn);
  }

  function isCsv(fn: string, mime: string = '') {
    if (mime === 'text/csv' || mime.includes('tab-separated')) return true;
    return /\.(csv|tsv)$/i.test(fn);
  }

  function isAudio(fn: string, mime: string = '') {
    if (mime.startsWith('audio/')) return true;
    return /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(fn);
  }

  function isVideo(fn: string, mime: string = '') {
    if (mime.startsWith('video/')) return true;
    return /\.(mp4|webm|mov|mkv)$/i.test(fn);
  }

  function isOfficeDoc(fn: string, mime: string = '') {
    if (
      mime.includes('word') ||
      mime.includes('document') ||
      mime.includes('spreadsheet') ||
      mime.includes('presentation')
    ) {
      return true;
    }
    return /\.(doc|docx|odt|rtf|xls|xlsx|ods|ppt|pptx|odp)$/i.test(fn);
  }

  function isArchive(fn: string, mime: string = '') {
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip')) return true;
    return /\.(zip|tar|gz|7z|rar|bz2|xz)$/i.test(fn);
  }

  useEffect(() => {
    setZoomLevel(1);
    setCopied(false);
    setTextContent(previewFile?.content || null);

    if (previewFile) {
      const fn = previewFile.filename || (previewFile as any).name || '';
      const mime = previewFile.mimeType || '';

      if (isHtml(fn, mime) || isMarkdown(fn)) {
        setViewMode('rendered');
      } else if (isCsv(fn, mime)) {
        setViewMode('table');
      } else {
        setViewMode('code');
      }

      if (previewFile.content) {
        setTextContent(previewFile.content);
      } else if (previewFile.path && activeProjectId && (isTextOrCode(fn, mime) || isHtml(fn, mime))) {
        setIsLoadingContent(true);
        const cleanPath = previewFile.path.replace(/^file:\/\/\//, '').replace(/#[L\d-]+$/i, '');
        const token = typeof window !== 'undefined'
          ? window.sessionStorage?.getItem('kin_ipc_token') || window.localStorage?.getItem('kin_ipc_token')
          : null;
        const headers: Record<string, string> = {};
        if (token) headers['x-kin-ipc-token'] = token;
        const fetchUrl = `/api/projects/${activeProjectId}/artifacts?path=${encodeURIComponent(cleanPath)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
        fetch(fetchUrl, { headers })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((data) => {
            setTextContent(data.content || null);
          })
          .catch((err) => {
            console.warn('[KIN UI] Could not load artifact content:', err);
            setTextContent(null);
          })
          .finally(() => setIsLoadingContent(false));
      } else if (previewFile.url && (isTextOrCode(fn, mime) || isHtml(fn, mime))) {
        setIsLoadingContent(true);
        const token = typeof window !== 'undefined'
          ? window.sessionStorage?.getItem('kin_ipc_token') || window.localStorage?.getItem('kin_ipc_token')
          : null;
        const headers: Record<string, string> = {};
        if (token) headers['x-kin-ipc-token'] = token;
        const fetchUrl = previewFile.url.includes('?')
          ? `${previewFile.url}${token ? `&token=${encodeURIComponent(token)}` : ''}`
          : `${previewFile.url}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
        fetch(fetchUrl, { headers })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          })
          .then((text) => setTextContent(text))
          .catch((err) => {
            console.warn('[KIN UI] Could not load file text content:', err);
            setTextContent(null);
          })
          .finally(() => setIsLoadingContent(false));
      }
    }
  }, [previewFile, activeProjectId]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewFile) {
        closeFilePreview();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewFile, closeFilePreview]);

  // CSV parsing
  const csvData = useMemo(() => {
    const fn = previewFile ? previewFile.filename || (previewFile as any).name || '' : '';
    if (!textContent || !previewFile || !isCsv(fn, previewFile.mimeType || '')) {
      return null;
    }
    const delimiter = previewFile.filename.endsWith('.tsv') ? '\t' : ',';
    const lines = textContent.trim().split(/\r?\n/);
    if (lines.length === 0) return null;

    const parseLine = (line: string) => {
      const cells: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          cells.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      cells.push(current.trim());
      return cells;
    };

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1, 101).map(parseLine);
    return { headers, rows, totalRows: lines.length - 1 };
  }, [textContent, previewFile]);

  if (!previewFile) return null;

  const filename = previewFile.filename || (previewFile as any).name || 'file';
  const { mimeType = '', size, path } = previewFile;
  const cleanPath = previewFile.path ? previewFile.path.replace(/^file:\/\/\//, '').replace(/#[L\d-]+$/i, '') : undefined;
  const token = typeof window !== 'undefined'
    ? window.sessionStorage?.getItem('kin_ipc_token') || window.localStorage?.getItem('kin_ipc_token')
    : null;
  const rawUrl =
    previewFile.url ||
    (cleanPath && activeProjectId
      ? `/api/projects/${activeProjectId}/artifacts?path=${encodeURIComponent(cleanPath)}&raw=true`
      : undefined);
  const effectiveUrl = useMemo(() => {
    if (!rawUrl) return undefined;
    if (!token) return rawUrl;
    return rawUrl.includes('?') ? `${rawUrl}&token=${encodeURIComponent(token)}` : `${rawUrl}?token=${encodeURIComponent(token)}`;
  }, [rawUrl, token]);

  const isImg = isImage(filename, mimeType);
  const isDocPdf = isPdf(filename, mimeType);
  const isHtmlDoc = isHtml(filename, mimeType);
  const isMdDoc = isMarkdown(filename);
  const isCsvDoc = isCsv(filename, mimeType);
  const isAud = isAudio(filename, mimeType);
  const isVid = isVideo(filename, mimeType);
  const isOffDoc = isOfficeDoc(filename, mimeType);
  const isArch = isArchive(filename, mimeType);
  const isCode = isTextOrCode(filename, mimeType);

  const getLanguage = (fn: string) => {
    const ext = fn.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
      case 'mjs':
      case 'cjs':
        return 'javascript';
      case 'py':
        return 'python';
      case 'rs':
        return 'rust';
      case 'json':
        return 'json';
      case 'md':
      case 'markdown':
        return 'markdown';
      case 'html':
      case 'htm':
        return 'html';
      case 'css':
      case 'scss':
      case 'less':
        return 'css';
      case 'sql':
        return 'sql';
      case 'sh':
      case 'bash':
      case 'zsh':
        return 'bash';
      case 'ps1':
        return 'powershell';
      case 'yaml':
      case 'yml':
        return 'yaml';
      case 'xml':
      case 'svg':
        return 'xml';
      default:
        return 'text';
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownload = () => {
    if (effectiveUrl) {
      const a = document.createElement('a');
      const dlUrl = effectiveUrl.includes('?') ? `${effectiveUrl}&download=true` : `${effectiveUrl}?download=true`;
      a.href = dlUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      addToast(`Downloading ${filename}`, 'info');
    } else if (textContent) {
      const blob = new Blob([textContent], { type: mimeType || 'text/plain' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      addToast(`Downloaded ${filename}`, 'info');
    } else {
      addToast('Download target URL is unavailable', 'warning');
    }
  };

  const handleCopyContent = () => {
    if (textContent) {
      navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addToast('File content copied to clipboard', 'info');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`File Preview: ${filename}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-md animate-fadeIn"
      onClick={closeFilePreview}
    >
      <div
        className="relative w-full max-w-5xl h-[88vh] bg-kin-surface/95 border border-kin-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="px-5 py-3.5 border-b border-kin-border flex items-center justify-between shrink-0 bg-kin-surface/60">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="p-2 rounded-xl bg-kin-card border border-kin-border text-kin-accent shrink-0">
              {isImg ? (
                <ImageIcon className="w-4 h-4" />
              ) : isDocPdf || isOffDoc ? (
                <FileText className="w-4 h-4" />
              ) : isCsvDoc ? (
                <FileSpreadsheet className="w-4 h-4" />
              ) : isArch ? (
                <FileArchive className="w-4 h-4" />
              ) : isAud ? (
                <Volume2 className="w-4 h-4" />
              ) : isVid ? (
                <Video className="w-4 h-4" />
              ) : isCode || isHtmlDoc ? (
                <FileCode className="w-4 h-4" />
              ) : (
                <File className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-kin-text truncate" title={filename}>
                {filename}
              </h2>
              <div className="flex items-center space-x-2 text-[10px] font-mono text-kin-muted mt-0.5">
                {size ? <span>{formatFileSize(size)}</span> : null}
                {size && (mimeType || path) ? <span>•</span> : null}
                {mimeType ? <span className="uppercase">{mimeType.split('/')[1] || mimeType}</span> : null}
                {path ? <span className="truncate max-w-xs">• {path}</span> : null}
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center space-x-1.5 shrink-0">
            {/* View Mode Toggle for HTML, Markdown, and CSV */}
            {(isHtmlDoc || isMdDoc) && textContent && (
              <div className="flex items-center rounded-lg bg-kin-card border border-kin-border p-0.5 mr-1 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('rendered')}
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition cursor-pointer font-medium ${
                    viewMode === 'rendered'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-kin-muted hover:text-kin-text'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  <span>Preview</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('code')}
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition cursor-pointer font-medium ${
                    viewMode === 'code'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-kin-muted hover:text-kin-text'
                  }`}
                >
                  <Code2 className="w-3 h-3" />
                  <span>Source</span>
                </button>
              </div>
            )}

            {isCsvDoc && textContent && (
              <div className="flex items-center rounded-lg bg-kin-card border border-kin-border p-0.5 mr-1 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition cursor-pointer font-medium ${
                    viewMode === 'table'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-kin-muted hover:text-kin-text'
                  }`}
                >
                  <Table className="w-3 h-3" />
                  <span>Table</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('code')}
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition cursor-pointer font-medium ${
                    viewMode === 'code'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-kin-muted hover:text-kin-text'
                  }`}
                >
                  <Code2 className="w-3 h-3" />
                  <span>Raw</span>
                </button>
              </div>
            )}

            {/* Image Zoom Toolbar */}
            {isImg && (
              <div className="flex items-center space-x-1 px-1.5 py-1 rounded-lg bg-kin-card border border-kin-border mr-1 text-kin-muted text-xs">
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(0.25, z - 0.25))}
                  className="p-1 hover:text-kin-text transition cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono text-[10px] min-w-[40px] text-center">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(4, z + 0.25))}
                  className="p-1 hover:text-kin-text transition cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel(1)}
                  className="p-1 hover:text-kin-text transition cursor-pointer"
                  title="Reset Zoom"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Copy Button for Text / Code / HTML */}
            {textContent && (
              <button
                type="button"
                onClick={handleCopyContent}
                className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-kin-card hover:bg-kin-cardHover text-kin-muted hover:text-kin-text border border-kin-border text-xs font-semibold transition cursor-pointer"
                title="Copy file contents"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}

            {/* Download Button */}
            {(effectiveUrl || textContent) && (
              <button
                type="button"
                onClick={handleDownload}
                className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-kin-accent/15 hover:bg-kin-accent/25 text-kin-accent border border-kin-accent/30 text-xs font-semibold transition cursor-pointer"
                title="Download file to local machine"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </button>
            )}

            <button
              type="button"
              onClick={closeFilePreview}
              className="p-1.5 rounded-xl text-kin-muted hover:text-kin-text hover:bg-kin-card transition cursor-pointer"
              title="Close Preview (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Viewer Viewport */}
        <div className="flex-1 overflow-auto bg-kin-bg/50 p-4 flex items-center justify-center relative">
          {/* 1. Image Viewer */}
          {isImg ? (
            <div className="overflow-auto max-w-full max-h-full flex items-center justify-center">
              <img
                src={effectiveUrl || (previewFile.contentBase64 ? `data:${mimeType || 'image/png'};base64,${previewFile.contentBase64}` : '')}
                alt={filename}
                style={{ transform: `scale(${zoomLevel})`, transition: 'transform 0.15s ease-out' }}
                className="max-h-[70vh] max-w-full object-contain rounded-lg shadow-lg border border-kin-border select-none"
              />
            </div>
          ) : isDocPdf ? (
            /* 2. PDF Viewer */
            effectiveUrl ? (
              <iframe
                src={effectiveUrl}
                title={filename}
                className="w-full h-full rounded-xl border border-kin-border bg-white"
              />
            ) : (
              <div className="text-center p-8 space-y-3">
                <FileText className="w-12 h-12 text-kin-muted mx-auto opacity-50" />
                <div className="text-sm font-semibold text-kin-text">PDF Document: {filename}</div>
                <p className="text-xs text-kin-muted max-w-md mx-auto">
                  PDF preview requires direct file URL. You can download the document to open in your system reader.
                </p>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-4 py-2 rounded-xl bg-kin-accent text-kin-bg text-xs font-bold shadow-md hover:brightness-110 transition cursor-pointer"
                >
                  Download PDF
                </button>
              </div>
            )
          ) : isHtmlDoc && viewMode === 'rendered' ? (
            /* 3. HTML Rendered Webpage Viewer */
            <div className="w-full h-full rounded-xl border border-kin-border bg-white overflow-hidden shadow-lg flex flex-col">
              <iframe
                srcDoc={textContent || undefined}
                src={!textContent ? effectiveUrl : undefined}
                title={filename}
                sandbox="allow-same-origin allow-scripts"
                className="w-full h-full border-0"
              />
            </div>
          ) : isMdDoc && viewMode === 'rendered' && textContent ? (
            /* 4. Rendered Markdown Document View */
            <div className="w-full h-full overflow-auto rounded-xl border border-kin-border bg-kin-surface p-6 font-sans text-kin-text leading-relaxed prose prose-invert max-w-none">
              <div className="whitespace-pre-wrap font-sans text-xs sm:text-sm">
                {textContent}
              </div>
            </div>
          ) : isCsvDoc && viewMode === 'table' && csvData ? (
            /* 5. CSV / TSV Interactive Data Table */
            <div className="w-full h-full overflow-auto rounded-xl border border-kin-border bg-kin-surface">
              <div className="p-2 border-b border-kin-border bg-kin-card text-[11px] text-kin-muted font-mono flex items-center justify-between">
                <span>Displaying {csvData.rows.length} rows (out of {csvData.totalRows} total)</span>
                <span>{csvData.headers.length} columns</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-kin-card/80 border-b border-kin-border">
                      <th className="py-2 px-3 font-mono text-[10px] text-kin-muted border-r border-kin-border w-12 text-center">
                        #
                      </th>
                      {csvData.headers.map((h, i) => (
                        <th key={i} className="py-2 px-3 font-semibold text-kin-text border-r border-kin-border truncate">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvData.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="border-b border-kin-border/50 hover:bg-kin-cardHover transition font-mono text-[11px]">
                        <td className="py-1.5 px-3 text-kin-muted border-r border-kin-border/50 text-center text-[10px]">
                          {rIdx + 1}
                        </td>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="py-1.5 px-3 text-kin-text border-r border-kin-border/50 truncate max-w-xs">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : isAud && effectiveUrl ? (
            /* 6. Audio Player */
            <div className="p-8 rounded-2xl bg-kin-card border border-kin-border text-center space-y-5 max-w-md shadow-xl w-full">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center mx-auto text-blue-400">
                <Volume2 className="w-8 h-8 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-base text-kin-text">{filename}</h3>
                <p className="text-xs text-kin-muted">{formatFileSize(size) || 'Audio Asset'}</p>
              </div>
              <audio controls src={effectiveUrl} className="w-full mt-4" />
            </div>
          ) : isVid && effectiveUrl ? (
            /* 7. Video Player */
            <div className="max-w-4xl max-h-full flex items-center justify-center">
              <video
                controls
                src={effectiveUrl}
                className="max-h-[70vh] max-w-full rounded-xl border border-kin-border shadow-2xl bg-black"
              />
            </div>
          ) : isOffDoc ? (
            /* 8. Office Document Card */
            <div className="p-8 rounded-2xl bg-kin-card border border-kin-border text-center space-y-4 max-w-md shadow-lg">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center mx-auto text-blue-400">
                <FileText className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-base text-kin-text">{filename}</h3>
                <p className="text-xs text-kin-muted">
                  {formatFileSize(size) || 'Office Document'} • {mimeType || 'Word / Office Document'}
                </p>
              </div>
              <p className="text-xs text-kin-muted leading-relaxed">
                Word and Office formats are structured binary deliverables. Download to open in your desktop office suite or extract with workspace tools.
              </p>
              <button
                type="button"
                onClick={handleDownload}
                className="w-full py-2.5 px-4 rounded-xl bg-kin-accent text-kin-bg text-xs font-bold shadow-md hover:brightness-110 transition cursor-pointer flex items-center justify-center space-x-2"
              >
                <Download className="w-4 h-4" />
                <span>Download {filename}</span>
              </button>
            </div>
          ) : isArch ? (
            /* 9. Archive Card */
            <div className="p-8 rounded-2xl bg-kin-card border border-kin-border text-center space-y-4 max-w-md shadow-lg">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
                <FileArchive className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-base text-kin-text">{filename}</h3>
                <p className="text-xs text-kin-muted">
                  {formatFileSize(size) || 'Archive Asset'} • {mimeType || 'Compressed Archive'}
                </p>
              </div>
              <p className="text-xs text-kin-muted leading-relaxed">
                Compressed package container. Download to inspect and extract archived contents on your computer.
              </p>
              <button
                type="button"
                onClick={handleDownload}
                className="w-full py-2.5 px-4 rounded-xl bg-kin-accent text-kin-bg text-xs font-bold shadow-md hover:brightness-110 transition cursor-pointer flex items-center justify-center space-x-2"
              >
                <Download className="w-4 h-4" />
                <span>Download {filename}</span>
              </button>
            </div>
          ) : isCode || textContent !== null ? (
            /* 10. Code / Text File Viewer */
            <div className="w-full h-full overflow-auto rounded-xl border border-kin-border bg-kin-surface p-4">
              {isLoadingContent ? (
                <div className="flex items-center justify-center h-full text-xs text-kin-muted">
                  Loading file content...
                </div>
              ) : textContent !== null ? (
                <CodeBlock language={getLanguage(filename)} code={textContent} />
              ) : (
                <div className="text-center py-12 text-xs text-kin-muted">
                  File content could not be previewed inline. Please download to view.
                </div>
              )}
            </div>
          ) : (
            /* 11. Generic Binary Asset Card */
            <div className="p-8 rounded-2xl bg-kin-card border border-kin-border text-center space-y-4 max-w-md shadow-lg">
              <div className="w-16 h-16 rounded-2xl bg-kin-surface border border-kin-border flex items-center justify-center mx-auto text-kin-accent">
                <File className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-base text-kin-text">{filename}</h3>
                <p className="text-xs text-kin-muted">
                  {formatFileSize(size) || 'Binary Asset'} • {mimeType || 'Application Asset'}
                </p>
              </div>
              <p className="text-xs text-kin-muted leading-relaxed">
                This file format is designed for external desktop applications. Download it to inspect on your machine.
              </p>
              <button
                type="button"
                onClick={handleDownload}
                className="w-full py-2.5 px-4 rounded-xl bg-kin-accent text-kin-bg text-xs font-bold shadow-md hover:brightness-110 transition cursor-pointer flex items-center justify-center space-x-2"
              >
                <Download className="w-4 h-4" />
                <span>Download {filename}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
