import { access } from "node:fs/promises";
import path from "node:path";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveWebIndexPath(cwd = process.cwd()): Promise<string> {
  const dist = path.join(cwd, "dist/web/public/index.html");
  if (await exists(dist)) return dist;
  return path.join(cwd, "src/web/public/index.html");
}
