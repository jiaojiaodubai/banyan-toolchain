import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await cp(path.join(root, "src", "types"), path.join(root, "dist", "types"), {
  recursive: true,
});
