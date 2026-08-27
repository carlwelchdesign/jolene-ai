import {
  PublicDeploymentPreflightError,
  parsePublicDeploymentPreflightConfig,
  verifyPublicDeployment,
} from "./public/public-deployment-preflight.js";

try {
  const report = await verifyPublicDeployment(
    parsePublicDeploymentPreflightConfig(process.env),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const code = error instanceof PublicDeploymentPreflightError
    ? error.code
    : "preflight_failed";
  process.stderr.write(`Public deployment preflight failed: ${code}.\n`);
  process.exitCode = 1;
}
