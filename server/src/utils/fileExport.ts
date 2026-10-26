import * as fs from 'fs';
import * as path from 'path';

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 100);
}

export function saveMarkdownFile(content: string, customPath?: string, title?: string): string {
  const exportsDir = path.resolve(process.cwd(), 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  let finalPath: string;
  if (customPath) {
    finalPath = path.isAbsolute(customPath)
      ? customPath
      : path.resolve(process.cwd(), customPath);
    const parentDir = path.dirname(finalPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  } else {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTitle = title ? sanitizeFileName(title) : 'page';
    const filename = `${safeTitle}_${timestamp}.md`;
    finalPath = path.join(exportsDir, filename);
  }

  fs.writeFileSync(finalPath, content, 'utf8');
  return finalPath;
}
