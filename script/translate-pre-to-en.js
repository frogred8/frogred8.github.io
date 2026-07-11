#!/usr/bin/env node

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const SOURCE_DIR = "docs";
const TARGET_DIR = "docs_en";
const DEFAULT_CODEX_COMMAND = "codex";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printUsage(args.length === 1 ? 0 : 1);
}

for (const arg of args) {
  const inputPath = normalize(arg);
  const sourcePath = await resolveSourcePath(inputPath);
  const targetPath = resolveTargetPath(sourcePath);

  await translateFile(sourcePath, targetPath);
}

async function translateFile(sourcePath, targetPath) {
  console.log(`Translating ${sourcePath}`);

  const source = await readFile(sourcePath, "utf8");
  const title = findFrontMatterTitle(source);
  const blocks = findPreBlocks(source);

  if (blocks.length === 0) {
    fail(`No <pre> block found in ${sourcePath}.`);
  }

  let output = "";
  let cursor = 0;

  if (title) {
    const translatedTitle = await translateTitleToEnglishWithCodex(title.value);
    output += source.slice(0, title.valueStart);
    output += escapeFrontMatterTitle(translatedTitle.trim(), title.quote);
    cursor = title.valueEnd;
  }

  for (const [index, block] of blocks.entries()) {
    output += source.slice(cursor, block.contentStart);

    const { leadingWhitespace, text, trailingWhitespace } = splitOuterWhitespace(block.content);
    const translated = await translateToEnglishWithCodex(text);

    output += `${leadingWhitespace}${translated.trim()}${trailingWhitespace}`;
    cursor = block.contentEnd;

    console.log(`Translated <pre> block ${index + 1}/${blocks.length}`);
  }

  output += source.slice(cursor);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, output, "utf8");

  console.log(`Wrote ${targetPath}`);
}

function printUsage(exitCode) {
  console.log(`Usage: npm run translate:doc docs/027_fast_json_parse.md
       npm run translate:doc 027_fast_json_parse.md
       npm run translate:doc 027
       npm run translate:doc 027 028 029

Environment:
  CODEX_COMMAND       Optional Codex CLI command. Defaults to ${DEFAULT_CODEX_COMMAND}.
  CODEX_MODEL         Optional model name passed to codex exec.`);
  process.exit(exitCode);
}

async function resolveSourcePath(input) {
  if (/^\d+$/.test(input)) {
    return resolveSourcePathByNumber(input);
  }

  const path = input.startsWith(`${SOURCE_DIR}/`) ? input : join(SOURCE_DIR, input);

  if (extname(path) !== ".md") {
    fail("Please select a markdown file from the docs folder.");
  }

  const rel = relative(SOURCE_DIR, path);
  if (rel.startsWith("..") || rel === "") {
    fail("Please select a markdown file from the docs folder.");
  }

  return path;
}

async function resolveSourcePathByNumber(number) {
  const prefix = `${number}_`;
  const matches = (await readdir(SOURCE_DIR))
    .filter((file) => file.startsWith(prefix) && extname(file) === ".md")
    .sort();

  if (matches.length === 0) {
    fail(`No markdown file found for number ${number}.`);
  }

  if (matches.length > 1) {
    fail(`Multiple markdown files found for number ${number}: ${matches.join(", ")}`);
  }

  return join(SOURCE_DIR, matches[0]);
}

function resolveTargetPath(path) {
  return join(TARGET_DIR, relative(SOURCE_DIR, path));
}

function findPreBlocks(markdown) {
  const blocks = [];
  const openTag = /<pre\b[^>]*>/gi;
  let match;

  while ((match = openTag.exec(markdown)) !== null) {
    const contentStart = match.index + match[0].length;
    const closeMatch = /<\/pre>/gi;
    closeMatch.lastIndex = contentStart;
    const close = closeMatch.exec(markdown);
    const contentEnd = close ? close.index : markdown.length;

    blocks.push({
      content: markdown.slice(contentStart, contentEnd),
      contentStart,
      contentEnd,
    });

    openTag.lastIndex = close ? close.index + close[0].length : markdown.length;
  }

  return blocks;
}

function splitOuterWhitespace(text) {
  const leadingWhitespace = text.match(/^\s*/)[0];
  const trailingWhitespace = text.match(/\s*$/)[0];
  const contentStart = leadingWhitespace.length;
  const contentEnd = text.length - trailingWhitespace.length;

  return {
    leadingWhitespace,
    text: text.slice(contentStart, contentEnd),
    trailingWhitespace,
  };
}

function findFrontMatterTitle(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    return null;
  }

  const frontMatterStart = match.index;
  const frontMatter = match[1];
  const titleMatch = frontMatter.match(/^title:\s*(["']?)(.*?)\1\s*$/m);
  if (!titleMatch) {
    return null;
  }

  const lineStartInFrontMatter = titleMatch.index;
  const valueOffsetInLine = titleMatch[0].indexOf(titleMatch[2]);
  const valueStart = frontMatterStart + "---\n".length + lineStartInFrontMatter + valueOffsetInLine;

  return {
    value: titleMatch[2],
    quote: titleMatch[1],
    valueStart,
    valueEnd: valueStart + titleMatch[2].length,
  };
}

function escapeFrontMatterTitle(title, quote) {
  if (quote === "'") {
    return title.replace(/'/g, "''");
  }

  return title.replace(/"/g, '\\"');
}

async function translateTitleToEnglishWithCodex(title) {
  return translateWithCodex(
    title,
    "Translate this Korean technical blog title into natural English. Return only the translated title.",
  );
}

async function translateToEnglishWithCodex(text) {
  return translateWithCodex(
    text,
    "Translate the Korean technical blog content in this file into natural English.",
  );
}

async function translateWithCodex(text, instruction) {
  const tempDir = await mkdtemp(join(tmpdir(), "docs-en-"));
  const inputPath = join(tempDir, "source.txt");
  const outputPath = join(tempDir, "translation.txt");
  const command = process.env.CODEX_COMMAND || DEFAULT_CODEX_COMMAND;
  const args = ["exec", "--yolo"];

  if (process.env.CODEX_MODEL) {
    args.push("--model", process.env.CODEX_MODEL);
  }

  args.push(buildTranslationPrompt(inputPath, outputPath, instruction));

  try {
    await writeFile(inputPath, text.trim(), "utf8");
    await runCodex(command, args);
    return await readFile(outputPath, "utf8");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function buildTranslationPrompt(inputPath, outputPath, instruction) {
  return `${instruction}
${inputPath}

Rules:
- Write only the translated content to this file:
${outputPath}
- Do not print the translation anywhere else.
- Do not wrap the result in code fences.
- Preserve code snippets, URLs, markdown lists, numbers, hashtags, and line breaks.
- Do not add explanations or summaries.
- Do not modify any repository files.`;
}

function runCodex(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "ignore"],
      env: {
        ...process.env,
      },
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(`${command} ${args.slice(0, -1).join(" ")} failed with exit code ${code}`),
      );
    });
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
