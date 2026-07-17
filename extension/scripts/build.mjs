import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

for (const entry of ["content", "service-worker", "options"]) {
  await build({
    entryPoints: [`src/${entry}.ts`],
    outfile: `dist/${entry}.js`,
    bundle: true,
    format: "iife",
    target: "chrome120",
    sourcemap: false,
    minify: false
  });
}

await cp("manifest.json", "dist/manifest.json");
await cp("src/options.html", "dist/options.html");

