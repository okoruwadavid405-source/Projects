/**
 * DocumentParser: turns an uploaded file into text, locally.
 * File types are detected from the bytes, not trusted from the name or browser.
 * Scanned PDFs and images have no text layer; they need the AI provider (vision).
 */
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export type ParsedDocument =
  | { kind: 'text'; mimeType: string; text: string }
  | { kind: 'needs_ai'; mimeType: 'application/pdf' | ImageType; reason: string };

export class UnsupportedDocumentError extends Error {}

function sniff(buf: Buffer, filename: string): string {
  const name = filename.toLowerCase();
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf[0] === 0x50 && buf[1] === 0x4b && name.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (buf[0] === 0xd0 && buf[1] === 0xcf) return 'application/msword';
  if (!buf.includes(0) && /\.(txt|md|markdown|text|csv)$/.test(name)) return 'text/plain';
  if (!buf.includes(0) && buf.length > 0 && isUtf8(buf)) return 'text/plain';
  return 'application/octet-stream';
}

function isUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

const normalize = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export async function parseDocument(buf: Buffer, filename: string): Promise<ParsedDocument> {
  if (buf.length === 0) throw new UnsupportedDocumentError('That file is empty.');
  if (buf.length > MAX_UPLOAD_BYTES) throw new UnsupportedDocumentError('Files must be 10 MB or smaller.');
  const type = sniff(buf, filename);

  switch (type) {
    case 'application/pdf': {
      let text = '';
      try {
        const pdf = await getDocumentProxy(new Uint8Array(buf));
        text = normalize((await extractText(pdf, { mergePages: true })).text);
      } catch {
        throw new UnsupportedDocumentError("That PDF couldn't be read. It may be damaged or password-protected.");
      }
      // Fewer than ~40 letters means a scanned (image-only) PDF.
      if (text.replace(/[^\p{L}]/gu, '').length < 40) {
        return { kind: 'needs_ai', mimeType: 'application/pdf', reason: 'This PDF has no selectable text (it looks scanned).' };
      }
      return { kind: 'text', mimeType: type, text };
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      try {
        const { value } = await mammoth.extractRawText({ buffer: buf });
        const text = normalize(value);
        if (!text) throw new Error('empty');
        return { kind: 'text', mimeType: type, text };
      } catch {
        throw new UnsupportedDocumentError("That Word document couldn't be read.");
      }
    }
    case 'application/msword':
      throw new UnsupportedDocumentError('Old .doc files aren’t supported. Save it as .docx or PDF and upload that.');
    case 'image/png':
    case 'image/jpeg':
    case 'image/gif':
    case 'image/webp':
      return { kind: 'needs_ai', mimeType: type, reason: 'Images need text recognition.' };
    case 'text/plain': {
      const text = normalize(buf.toString('utf8'));
      if (!text) throw new UnsupportedDocumentError('That file is empty.');
      return { kind: 'text', mimeType: type, text };
    }
    default:
      throw new UnsupportedDocumentError('Unsupported file type. Upload a PDF, Word (.docx), text file, or an image.');
  }
}

/** Split text into ~1,000-character passages on paragraph boundaries, for full-text retrieval. */
export function chunkText(text: string, target = 1000): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if (p.length > target * 1.5) {
      if (current) chunks.push(current);
      current = '';
      for (let i = 0; i < p.length; i += target) chunks.push(p.slice(i, i + target));
      continue;
    }
    if (current && current.length + p.length > target) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${p}` : p;
  }
  if (current) chunks.push(current);
  return chunks;
}
