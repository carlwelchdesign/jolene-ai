import type { PublicCareerEvidenceRecord } from
  "../domain/public-career-evidence.js";

type PromptTopic =
  | "ai"
  | "career"
  | "creative"
  | "leadership"
  | "proof"
  | "projects"
  | "recommendations"
  | "risk"
  | "role_fit"
  | "systems";

interface PublicConversationPrompt {
  readonly text: string;
  readonly topics: readonly PromptTopic[];
}

export const PUBLIC_CONVERSATION_PROMPTS: readonly PublicConversationPrompt[] = [
  { text: "What makes Carl unusually valuable on a product engineering team?", topics: ["proof", "role_fit"] },
  { text: "Which project best proves Carl can turn ambiguity into a working product?", topics: ["projects", "proof"] },
  { text: "What would you lead with if you were pitching Carl for a staff-level role?", topics: ["role_fit", "leadership"] },
  { text: "Where has Carl led without losing touch with implementation?", topics: ["leadership", "systems"] },
  { text: "Show me the strongest evidence that Carl can handle complex systems.", topics: ["systems", "proof"] },
  { text: "What kind of difficult problem should a company bring Carl first?", topics: ["role_fit", "proof"] },
  { text: "How does Carl connect product judgment with engineering execution?", topics: ["projects", "systems"] },
  { text: "Which project best shows Carl’s frontend depth?", topics: ["projects", "systems"] },
  { text: "Where does Carl demonstrate backend or systems thinking?", topics: ["systems", "proof"] },
  { text: "How does Carl use AI without handing it too much authority?", topics: ["ai", "risk"] },
  { text: "What does Carl understand about RAG, retrieval, and grounded AI?", topics: ["ai", "systems"] },
  { text: "How does Carl handle risk in AI-assisted systems?", topics: ["ai", "risk"] },
  { text: "Which project best demonstrates security and privacy judgment?", topics: ["risk", "projects"] },
  { text: "What has Carl built that is genuinely production-ready?", topics: ["projects", "proof"] },
  { text: "What has Carl actually shipped?", topics: ["projects", "proof"] },
  { text: "Which projects are demos or prototypes, and why do they still matter?", topics: ["projects", "risk"] },
  { text: "How does Carl release software instead of trusting one green check?", topics: ["risk", "systems"] },
  { text: "What do former teammates say Carl is like under pressure?", topics: ["recommendations", "leadership"] },
  { text: "What evidence shows Carl can mentor or lead other engineers?", topics: ["leadership", "proof"] },
  { text: "How do Carl’s design instincts make him a stronger engineer?", topics: ["creative", "systems"] },
  { text: "Where does Carl’s creative-technology background become a business advantage?", topics: ["creative", "role_fit"] },
  { text: "Which role best prepared Carl for a senior product-engineering team?", topics: ["career", "role_fit"] },
  { text: "What changed in Carl’s work as he moved from design into product engineering?", topics: ["career", "creative"] },
  { text: "What is the through-line across Carl’s career?", topics: ["career", "proof"] },
  { text: "Why did Carl build Jolene?", topics: ["ai", "career"] },
  { text: "Which Carl project would you show a hiring manager first?", topics: ["projects", "role_fit"] },
  { text: "What should an interviewer ask Carl to uncover his best work?", topics: ["role_fit", "proof"] },
  { text: "What should a skeptical hiring manager verify directly with Carl?", topics: ["role_fit", "risk"] },
  { text: "Where might Carl be a weaker fit?", topics: ["role_fit", "risk"] },
  { text: "What kind of team gets the most value from Carl?", topics: ["role_fit", "leadership"] },
  { text: "How would you compare Carl’s experience with a specific job description?", topics: ["role_fit", "career"] },
  { text: "How would Carl approach a messy zero-to-one product?", topics: ["projects", "leadership"] },
  { text: "What does Carl do when requirements are incomplete or contradictory?", topics: ["leadership", "systems"] },
  { text: "Where has Carl balanced speed with quality and safeguards?", topics: ["risk", "proof"] },
  { text: "Which recommendation says the most about Carl’s working style?", topics: ["recommendations", "proof"] },
  { text: "What would Carl bring that a conventional frontend engineer might not?", topics: ["creative", "role_fit"] },
  { text: "Give me the strongest honest case for hiring Carl.", topics: ["role_fit", "proof"] },
  { text: "Which project best shows cross-functional judgment?", topics: ["projects", "leadership"] },
  { text: "How does Carl turn research into product decisions?", topics: ["projects", "creative"] },
  { text: "What evidence shows Carl’s persistence and adaptability?", topics: ["career", "recommendations"] },
  { text: "What should I remember about Carl after leaving this site?", topics: ["proof", "role_fit"] },
] as const;

export function suggestPublicFollowUpQuestions(options: {
  readonly question: string;
  readonly selectedEvidence?: readonly PublicCareerEvidenceRecord[];
  readonly turnCount?: number | undefined;
  readonly limit?: number;
}): string[] {
  const limit = Math.max(0, Math.min(options.limit ?? 3, 4));
  if (limit === 0) return [];
  const asked = normalize(options.question);
  const topics = inferTopics(options.question, options.selectedEvidence ?? []);
  const seed = stableHash([
    asked,
    String(options.turnCount ?? 1),
    ...(options.selectedEvidence ?? []).map((record) => record.evidenceId),
  ].join("|"));

  return PUBLIC_CONVERSATION_PROMPTS
    .map((prompt, index) => ({
      prompt,
      score: prompt.topics.reduce(
        (total, topic) => total + (topics.has(topic) ? 8 : 0),
        0,
      ) + ((stableHash(`${seed}:${index}`) % 997) / 997),
    }))
    .filter(({ prompt }) => normalize(prompt.text) !== asked)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ prompt }) => prompt.text);
}

function inferTopics(
  question: string,
  evidence: readonly PublicCareerEvidenceRecord[],
): Set<PromptTopic> {
  const text = normalize([
    question,
    ...evidence.flatMap((record) => [
      record.claim.text,
      record.citation.title,
      record.citation.href,
    ]),
  ].join(" "));
  const topics = new Set<PromptTopic>();
  const patterns: Readonly<Record<PromptTopic, RegExp>> = {
    ai: /\b(?:ai|agent|jolene|model|rag|retriev|grounded|llm)\b/u,
    career: /\b(?:career|history|role|employer|company|worked|background)\b/u,
    creative: /\b(?:creative|design|audio|music|visual|interface|ux)\b/u,
    leadership: /\b(?:lead|mentor|team|staff|principal|manage|cross functional)\b/u,
    proof: /\b(?:evidence|prove|strong|recommend|value|result|impact|ship)\b/u,
    projects: /\b(?:project|product|built|build|portfolio|work)\b/u,
    recommendations: /\b(?:recommendation|testimonial|reference|teammate|colleague)\b/u,
    risk: /\b(?:risk|privacy|security|safe|authority|approval|limitation|release|rollback|validation)\b/u,
    role_fit: /\b(?:hire|hiring|fit|job description|interview|candidate|role|team)\b/u,
    systems: /\b(?:system|backend|frontend|architecture|technical|engineer|api|database)\b/u,
  };
  for (const [topic, pattern] of Object.entries(patterns) as [PromptTopic, RegExp][]) {
    if (pattern.test(text)) topics.add(topic);
  }
  if (topics.size === 0) {
    topics.add("proof");
    topics.add("projects");
  }
  return topics;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, " ").trim();
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
