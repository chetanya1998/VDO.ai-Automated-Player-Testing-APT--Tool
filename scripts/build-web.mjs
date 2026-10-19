import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
globalThis.location = new URL("file:///");

const esbuild = require("esbuild-wasm/lib/browser.js");
const wasmPath = require.resolve("esbuild-wasm/esbuild.wasm");
const wasmModule = await WebAssembly.compile(await readFile(wasmPath));
await esbuild.initialize({ wasmModule, worker: false });

const sourceExtensions = ["", ".tsx", ".ts", ".jsx", ".js", ".json"];

function nativePath(path) {
  return path.replace(/^[/\\]([A-Za-z]:[/\\])/, "$1");
}

async function resolveSource(candidate) {
  const normalized = nativePath(candidate);
  const candidates = [normalized];
  if ([".js", ".jsx"].includes(extname(normalized))) {
    candidates.push(normalized.slice(0, -extname(normalized).length));
  }

  for (const base of candidates) for (const suffix of sourceExtensions) {
    const path = `${base}${suffix}`;
    try {
      if ((await stat(path)).isFile()) return path;
    } catch {}
  }

  for (const suffix of sourceExtensions.slice(1)) {
    const path = resolve(normalized, `index${suffix}`);
    try {
      if ((await stat(path)).isFile()) return path;
    } catch {}
  }

  throw new Error(`Cannot resolve ${candidate}`);
}

const filesystemPlugin = {
  name: "node-filesystem",
  setup(build) {
    build.onResolve({ filter: /.*/ }, async (args) => {
      if (args.kind === "entry-point" || args.path.startsWith(".") || args.path.startsWith("/")) {
        const base = args.kind === "entry-point"
          ? resolve(process.cwd(), args.path)
          : resolve(nativePath(args.resolveDir), args.path);
        return { path: await resolveSource(base), namespace: "local-file" };
      }

      return {
        path: require.resolve(args.path, { paths: [nativePath(args.resolveDir), process.cwd()] }),
        namespace: "local-file",
      };
    });

    build.onLoad({ filter: /.*/, namespace: "local-file" }, async (args) => {
      const extension = extname(args.path).slice(1);
      const loader = extension === "tsx" || extension === "ts" || extension === "jsx" || extension === "json"
        ? extension
        : "js";
      return {
        contents: await readFile(args.path, "utf8"),
        loader,
        resolveDir: dirname(args.path),
      };
    });
  },
};

const result = await esbuild.build({
  entryPoints: ["web/src/main.tsx"],
  bundle: true,
  format: "esm",
  jsx: "automatic",
  minify: true,
  outfile: "dashboard.js",
  target: ["es2022"],
  plugins: [filesystemPlugin],
  write: false,
});

const javascript = result.outputFiles.find((file) => file.path.endsWith("dashboard.js"));
if (!javascript) throw new Error("Dashboard bundle was not produced");

await mkdir("web/dist", { recursive: true });
await writeFile("web/dist/dashboard.js", javascript.contents);
