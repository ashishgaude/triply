import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Plane } from "lucide-react";
import sharp from "sharp";

const directory = new URL("../public/", import.meta.url);
await mkdir(directory, { recursive: true });
const artwork = renderToStaticMarkup(
  createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: 512,
      height: 512,
      viewBox: "0 0 512 512",
    },
    createElement("rect", { width: 512, height: 512, fill: "#167962" }),
    createElement(Plane, {
      x: 116,
      y: 116,
      width: 280,
      height: 280,
      color: "#ffffff",
      strokeWidth: 1.7,
    }),
  ),
);
await writeFile(new URL("favicon.svg", directory), artwork);
for (const [name, size] of [
  ["pwa-192.png", 192],
  ["pwa-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  await sharp(Buffer.from(artwork))
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(name, directory)));
}
console.log("Generated Triply favicon and install icons.");
