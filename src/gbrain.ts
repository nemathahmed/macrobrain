import { $ } from "bun";

const GBRAIN = process.env.GBRAIN_BIN ?? "/Users/nemath/.bun/bin/gbrain";

async function run(args: string[]): Promise<string> {
  const result = await $`${GBRAIN} ${args}`.text();
  return result.trim();
}

async function runWithStdin(args: string[], input: string): Promise<string> {
  const proc = Bun.spawn([GBRAIN, ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(new TextEncoder().encode(input));
  proc.stdin.end();

  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`gbrain exited ${exitCode}`);
  }

  return stdout.trim();
}

export async function gbrainSearch(query: string): Promise<string> {
  return run(["search", query]);
}

export async function gbrainQuery(question: string): Promise<string> {
  return run(["query", question, "--no-expand"]);
}

export async function gbrainGet(slug: string): Promise<string> {
  return run(["get", slug]);
}

export async function gbrainPut(slug: string, content: string): Promise<string> {
  return runWithStdin(["put", slug], content);
}

export async function gbrainList(type?: string): Promise<string> {
  const args = type ? ["list", "--type", type] : ["list"];
  return run(args);
}
