import * as fs from 'fs';
import * as path from 'path';

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 100);
}

export function saveMarkdownFile(content: string, customPath?: string, title?: string): string {
  const baseDir = (process.cwd() && process.cwd() !== '/')
    ? process.cwd()
    : path.resolve(__dirname, '../..');

  let finalPath: string;
  if (customPath) {
    finalPath = path.isAbsolute(customPath)
      ? customPath
      : path.resolve(baseDir, customPath);
    const parentDir = path.dirname(finalPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  } else {
    const exportsDir = path.resolve(baseDir, 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTitle = title ? sanitizeFileName(title) : 'page';
    const filename = `${safeTitle}_${timestamp}.md`;
    finalPath = path.join(exportsDir, filename);
  }

  fs.writeFileSync(finalPath, content, 'utf8');
  return finalPath;
}
