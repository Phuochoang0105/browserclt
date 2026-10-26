import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Accurately finds the project root directory regardless of OS (macOS, Windows, Linux)
 * or execution context (dist/ or server/src/ or running with arbitrary cwd).
 */
export function getProjectRoot(): string {
  let curr = path.dirname(fileURLToPath(import.meta.url));
  while (curr !== path.dirname(curr)) {
    if (fs.existsSync(path.join(curr, 'package.json'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return (process.cwd() && process.cwd() !== '/' && !/^[A-Za-z]:\\?$/.test(process.cwd()))
    ? process.cwd()
    : path.dirname(fileURLToPath(import.meta.url));
}

/**
 * Sanitizes a filename to ensure compatibility across Windows, macOS, and Linux filesystems.
 * Strips reserved characters: / \ ? % * : | " < > and control characters.
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 100);
}

/**
 * Saves markdown content to disk.
 * Uses exports/ inside project root by default, or an absolute / relative custom path.
 * Automatically creates parent directories if they don't exist.
 */
export function saveMarkdownFile(content: string, customPath?: string, title?: string): string {
  const root = getProjectRoot();
  let finalPath: string;

  if (customPath) {
    finalPath = path.isAbsolute(customPath)
      ? customPath
      : path.resolve(root, customPath);
  } else {
    const exportsDir = path.resolve(root, 'exports');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTitle = title ? sanitizeFileName(title) : 'page';
    const filename = `${safeTitle}_${timestamp}.md`;
    finalPath = path.join(exportsDir, filename);
  }

  const parentDir = path.dirname(finalPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(finalPath, content, 'utf8');
  return finalPath;
}

/**
 * Saves binary buffer (e.g. screenshots) to disk safely across OS environments.
 */
export function saveBinaryFile(data: Buffer, customPath?: string, prefix = 'file', ext = 'bin'): string {
  const root = getProjectRoot();
  let finalPath: string;

  if (customPath) {
    finalPath = path.isAbsolute(customPath)
      ? customPath
      : path.resolve(root, customPath);
  } else {
    const exportsDir = path.resolve(root, 'exports');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${prefix}_${timestamp}.${ext}`;
    finalPath = path.join(exportsDir, filename);
  }

  const parentDir = path.dirname(finalPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(finalPath, data);
  return finalPath;
}
