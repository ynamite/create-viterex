import { styleText } from "node:util";

export function printBanner(): void {
  const top = "┌────────────────────┐";
  const bottom = "└────────────────────┘";
  const label = styleText(["magentaBright", "bold"], "ViteRex Setup");
  const side = styleText("magenta", "│");
  console.log("");
  console.log(styleText("magenta", top));
  console.log(`${side}   ${label}    ${side}`);
  console.log(styleText("magenta", bottom));
  console.log("");
}

export function printSuccess(projectName: string): void {
  console.log(
    styleText("green", `\n✓ Project "${projectName}" created successfully!\n`)
  );
}

export function printError(err: Error): void {
  console.error(styleText("red", `\n✗ ${err.message}\n`));
}
