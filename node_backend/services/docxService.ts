import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import HTMLtoDOCX from "html-to-docx";
import MarkdownIt from "markdown-it";

const execFileAsync = promisify(execFile);
const markdownIt = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true,
  typographer: true,
});

let pandocAvailableCache: boolean | null = null;

const escapeHtml = (input: string): string =>
  input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const markdownToBasicHtml = (markdown: string): string => {
  const rendered = markdownIt.render(markdown || "");
  return `
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Arial, Helvetica, sans-serif; line-height: 1.5; font-size: 12pt; }
      h1, h2, h3, h4, h5, h6 { margin: 14px 0 8px; }
      p { margin: 8px 0; }
      ul, ol { margin: 8px 0 8px 20px; }
      table { border-collapse: collapse; width: 100%; margin: 10px 0; }
      th, td { border: 1px solid #666; padding: 6px; vertical-align: top; text-align: left; }
      th { background: #f3f3f3; }
      code { font-family: "Courier New", monospace; background: #f7f7f7; padding: 1px 3px; }
      pre { font-family: "Courier New", monospace; background: #f7f7f7; padding: 8px; white-space: pre-wrap; }
      hr { border: 0; border-top: 1px solid #ccc; margin: 12px 0; }
    </style>
  </head>
  <body>${rendered}</body>
</html>`;
};

export async function checkPandocAvailable(force = false): Promise<boolean> {
  if (!force && pandocAvailableCache !== null) return pandocAvailableCache;
  try {
    await execFileAsync("pandoc", ["--version"], { timeout: 3000 });
    pandocAvailableCache = true;
  } catch {
    pandocAvailableCache = false;
  }
  return pandocAvailableCache;
}

async function generateWithPandoc(
  content: string,
  inputFormat: "html" | "markdown"
): Promise<Buffer> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "docx-"));
  const inputExt = inputFormat === "markdown" ? "md" : "html";
  const inputPath = path.join(tempDir, `input.${inputExt}`);
  const outputPath = path.join(tempDir, "output.docx");

  try {
    await writeFile(inputPath, content, "utf8");
    await execFileAsync(
      "pandoc",
      [inputPath, "-f", inputFormat, "-t", "docx", "-o", outputPath],
      { timeout: 120000 }
    );
    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function generateDocxBuffer(
  content: string,
  inputFormat: "html" | "markdown"
): Promise<{ buffer: Buffer; engine: "pandoc" | "html-to-docx" }> {
  const pandocAvailable = await checkPandocAvailable();

  if (pandocAvailable) {
    try {
      const buffer = await generateWithPandoc(content, inputFormat);
      return { buffer, engine: "pandoc" };
    } catch (error) {
      console.warn("Pandoc DOCX generation failed, using fallback:", error);
    }
  }

  const htmlContent =
    inputFormat === "markdown" ? markdownToBasicHtml(content) : content;
  const buffer = await HTMLtoDOCX(htmlContent);
  return { buffer, engine: "html-to-docx" };
}

