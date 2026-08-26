import { loadPublicDelegateConfig } from "./public/public-config.js";
import { FilePublicArtifactSource } from "./public/public-artifact-source.js";
import { DeterministicPublicAnswerService } from "./public/public-answer-service.js";
import { createPublicDelegateServer } from "./public/public-delegate-server.js";
import { DeterministicPublicJobFitService } from "./public/public-job-fit-service.js";
import { FixedWindowPublicRequestAdmission } from "./public/public-request-admission.js";

const config = loadPublicDelegateConfig();
const server = createPublicDelegateServer({
  enabled: config.enabled,
  artifacts: new FilePublicArtifactSource(config.artifactPath),
  answers: new DeterministicPublicAnswerService(),
  jobFit: new DeterministicPublicJobFitService(),
  admissions: new FixedWindowPublicRequestAdmission({
    requestsPerWindow: config.requestsPerMinute,
    maxConcurrentRequests: config.maxConcurrentRequests,
  }),
});

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `Jolene public delegate is listening at http://${config.host}:${config.port}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
