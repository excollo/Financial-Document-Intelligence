import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import HTMLtoDOCX from "html-to-docx";

const execFileAsync = promisify(execFile);

let pandocAvailableCache: boolean | null = null;

const escapeHtml = (input: string): string =>
  input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const markdownToBasicHtml = (markdown: string): string =>
  `<html><body><pre>${escapeHtml(markdown)}</pre></body></html>`;

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
      { timeout: 30000 }
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

