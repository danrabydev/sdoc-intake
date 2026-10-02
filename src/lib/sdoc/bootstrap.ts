import { createServerFn } from "@tanstack/react-start";
import type { FileResponse, IndexNode, TreeFile } from "./api-types.ts";

export interface IntakeBootstrap {
  root: string;
  files: TreeFile[];
  dirs: string[];
  nodes: IndexNode[];
  file: FileResponse | null;
  aliases: Record<string, string>;
}

export const loadIntake = createServerFn({ method: "GET" })
  .validator((input: { file?: string }) => ({
    file: typeof input?.file === "string" ? input.file : "",
  }))
  .handler(async ({ data }): Promise<IntakeBootstrap> => {
    const { buildIndex, buildTree, readFileView } = await import("./store.server.ts");
    const tree = await buildTree();
    const index = await buildIndex();
    const path = data.file || tree.files[0]?.path || "";
    let file: FileResponse | null = null;
    if (path) {
      try {
        file = await readFileView(path);
      } catch {
        file = null;
      }
    }
    return { root: tree.root, files: tree.files, dirs: tree.dirs, nodes: index.nodes, file, aliases: tree.aliases };
  });
