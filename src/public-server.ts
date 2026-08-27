import { loadPublicDelegateConfig } from "./public/public-config.js";
import { FilePublicArtifactSource } from "./public/public-artifact-source.js";
import { DeterministicPublicAnswerService } from "./public/public-answer-service.js";
import { createPublicDelegateServer } from "./public/public-delegate-server.js";

const config = loadPublicDelegateConfig();
const server = createPublicDelegateServer({
  artifacts: new FilePublicArtifactSource(config.artifactPath),
  answers: new DeterministicPublicAnswerService(),
});

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `Jolene public delegate manifest is listening at http://${config.host}:${config.port}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
