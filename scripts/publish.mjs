#!/usr/bin/env node
// Started by "Update Library.bat". Converts new and changed books, shows the report,
// and only after you answer Y pushes to GitHub, which then updates the website.
//
//   node scripts/publish.mjs [--no-notepad]

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_FILE = path.join(ROOT, "update-report.txt");

const git = (...args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
const gitOk = (...args) => git(...args).status === 0;

function ensureDependencies() {
  if (fs.existsSync(path.join(ROOT, "node_modules", "mammoth"))) return true;
  console.log("First run: installing what the converter needs...");
  return spawnSync("npm install", { cwd: ROOT, stdio: "inherit", shell: true }).status === 0;
}

/** Runs the converter, showing its report here and returning a copy of it. */
function runConverter() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", "convert.mjs")], { cwd: ROOT });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (text) => {
        output += text;
        process.stdout.write(text);
      });
    }
    child.on("close", (code) => resolve({ ok: code === 0, output }));
  });
}

async function confirm(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(question);
  prompt.close();
  return answer.trim().toLowerCase() === "y";
}

function stop(message) {
  console.log(`\n${message}`);
  process.exitCode = 1;
}

async function main() {
  if (!ensureDependencies()) return stop("Could not install what the converter needs. Check the internet connection.");

  console.log("Checking the content folder for new and changed books...");
  const { ok, output } = await runConverter();
  fs.writeFileSync(REPORT_FILE, output, "utf8");
  // Burmese titles can show as boxes in a command window; Notepad always displays them.
  if (/^(New|Changed|Removed|Problems): [1-9]/m.test(output) && !process.argv.includes("--no-notepad")) {
    spawn("notepad", [REPORT_FILE], { detached: true, stdio: "ignore" }).unref();
  }
  if (!ok) return stop("A book could not be converted, so nothing was published. See the report above.");

  if (!gitOk("rev-parse", "--is-inside-work-tree") || !gitOk("remote", "get-url", "origin")) {
    console.log("\nDone. The books are converted on this PC.");
    console.log("Publishing is not switched on yet, because this folder is not connected to GitHub.");
    return;
  }
  if (!git("status", "--porcelain").stdout.trim()) {
    console.log("\nNothing new to publish. The website is already up to date.");
    return;
  }
  if (!(await confirm("\nPublish these changes to the website? Type Y and press Enter, or just Enter to stop: "))) {
    console.log("Not published. The converted books stay on this PC, and you will be asked again next time.");
    return;
  }

  console.log("Publishing...");
  if (!gitOk("add", "-A")) return stop("Could not prepare the files for publishing.");
  const commit = git("commit", "-m", "Update books");
  if (commit.status !== 0) return stop(`Could not save this update:\n${commit.stdout}${commit.stderr}`);
  const push = git("push", "-u", "origin", "HEAD");
  if (push.status !== 0) return stop(`Could not send to GitHub. Check the internet connection, then run this again.\n${push.stderr}`);
  console.log("Published. The website will update in a few minutes.");
}

await main();
