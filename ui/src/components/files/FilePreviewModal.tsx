import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { useKinStore } from '../../store/kinStore.js';
import { CodeBlock } from '../code/CodeBlock.js';

export const FilePreviewModal: React.FC = () => {
  const { previewFile, closeFilePreview, addToast, activeProjectId } = useKinStore();
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [copied, setCopied] = useState<boolean>(false);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState<boolean>(false);

  function isTextOrCode(fn: string, mime: string = '') {
    if (mime.startsWith('text/') || mime === 'application/json') return true;
    return /\.(ts|tsx|js|jsx|py|rs|json|md|txt|html|css|scss|yaml|yml|sh|bat|ps1|sql|env|xml|log)$/i.test(fn);
  }

  function isImage(fn: string, mime: string = '') {
    if (mime.startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(fn);
  }

  function isPdf(fn: string, mime: string = '') {
    if (mime === 'application/pdf') return true;
    return /\.pdf$/i.test(fn);
  }

  useEffect(() => {
    setZoomLevel(1);
    setCopied(false);
    setTextContent(previewFile?.content || null);

    if (previewFile) {
      if (previewFile.content) {
        setTextContent(previewFile.content);
      } else if (previewFile.path && activeProjectId && isTextOrCode(previewFile.filename, previewFile.mimeType || '')) {
        setIsLoadingContent(true);
        const cleanPath = previewFile.path.replace(/^file:\/\/\//, '').replace(/#[L\d-]+$/i, '');
        fetch(`/api/projects/${activeProjectId}/artifacts?path=${encodeURIComponent(cleanPath)}`)
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
      } else if (previewFile.url && isTextOrCode(previewFile.filename, previewFile.mimeType || '')) {
        setIsLoadingContent(true);
        fetch(previewFile.url)
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

  if (!previewFile) return null;

  const { filename, mimeType = '', size, path } = previewFile;
  const cleanPath = previewFile.path ? previewFile.path.replace(/^file:\/\/\//, '').replace(/#[L\d-]+$/i, '') : undefined;
  const effectiveUrl =
    previewFile.url ||
    (cleanPath && activeProjectId
      ? `/api/projects/${activeProjectId}/artifacts?path=${encodeURIComponent(cleanPath)}&raw=true`
      : undefined);

  const isImg = isImage(filename, mimeType);
  const isDocPdf = isPdf(filename, mimeType);
  const isCode = isTextOrCode(filename, mimeType);

  const getLanguage = (fn: string) => {
    const ext = fn.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'py':
        return 'python';
      case 'rs':
        return 'rust';
      case 'json':
        return 'json';
      case 'md':
        return 'markdown';
      case 'html':
        return 'html';
      case 'css':
        return 'css';
      case 'sql':
        return 'sql';
      case 'sh':
      case 'bash':
        return 'bash';
      case 'ps1':
        return 'powershell';
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
              ) : isDocPdf ? (
                <FileText className="w-4 h-4" />
              ) : isCode ? (
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

            {isCode && textContent && (
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
          ) : isCode ? (
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
            /* Generic Binary File Card */
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
