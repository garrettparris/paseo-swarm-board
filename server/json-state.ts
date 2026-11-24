import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function openJsonState<T>(file: string, parse: (value: unknown) => T, empty: T) {
  let value: T;
  try {
    value = parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    value = empty;
  }
  return {
    read: () => value,
    save(next: T) {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file + ".tmp", JSON.stringify(next), { mode: 0o600 });
      renameSync(file + ".tmp", file);
      value = next;
    },
  };
}
