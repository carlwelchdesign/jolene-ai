const actualNodeVersion = process.versions.node;
const actualNodeMajor = Number.parseInt(actualNodeVersion.split(".")[0] ?? "", 10);

if (actualNodeMajor !== 22) {
  process.stderr.write([
    `Jolene requires Node 22; current runtime is ${actualNodeVersion}.`,
    "Open a new shell or run `nvm use` from the repository root.",
    "",
  ].join("\n"));
  process.exit(1);
}
