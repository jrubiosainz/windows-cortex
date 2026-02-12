import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";

async function build() {
    // Build main process
    await esbuild.build({
        entryPoints: ["src/main.ts"],
        bundle: true,
        platform: "node",
        target: "node20",
        outfile: "dist/main.cjs",
        format: "cjs",
        external: ["electron"],
        sourcemap: true,
        banner: {
            js: "// Bundled with esbuild",
        },
    });

    console.log("✅ Build complete");
}

build().catch((e) => {
    console.error("Build failed:", e);
    process.exit(1);
});
