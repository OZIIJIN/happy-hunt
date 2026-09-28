/**
 * test-memos.ts의 TEST_CASES(정답 포함)를 여러 로컬 모델로 돌려서
 * 정확도/속도를 비교한다.
 *
 * extract-items.ts와 추출 로직(스키마/프롬프트/재시도)은 동일하게 맞췄다 —
 * 이 파일은 그 위에 "정답과 비교해서 채점 + 모델간 비교"를 추가한 버전이다.
 *
 * 실행 (기본: qwen3:8b, qwen2.5:7b, qwen2.5:3b를 각 50개 케이스로 비교):
 *   node --experimental-strip-types poc/run-eval.ts
 * 모델/케이스 수 직접 지정:
 *   node --experimental-strip-types poc/run-eval.ts qwen3:8b,gemma3:4b 20
 */
import { z } from "zod";
import { TEST_CASES, type ExpectedItem, type TestCase } from "./test-memos.ts";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";

const DEFAULT_MODELS = ["qwen3:8b", "qwen2.5:7b", "qwen2.5:3b"];
const DEFAULT_LIMIT = 50;

// 로컬 모델은 JSON Schema로 형식을 유도해도 가끔(모델에 따라 10%대 확률로) JSON
// 문법 자체가 깨지거나 스키마를 어기는 응답을 낸다 — 연속 호출 중에만 간헐적으로
// 나타나고 재현이 잘 안 되는 걸로 봐서 일종의 샘플링 변동성으로 보인다. 재시도
// 횟수를 넉넉히 잡아 방어한다.
const MAX_ATTEMPTS = 4;

const CATEGORIES = ["음식", "장소", "자연", "사물", "동물", "활동", "기타"] as const;

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "아이템의 짧은 한글 이름" },
          category: { type: "string", enum: CATEGORIES },
          evidence: { type: "string", description: "근거가 된 원문 구절 그대로 인용" },
          visual_description: {
            type: "string",
            description: "아이콘 생성용 시각적 특징(색감/형태/분위기)",
          },
          uniqueness: { type: "string", enum: ["common", "rare"] },
        },
        required: ["name", "category", "evidence", "visual_description", "uniqueness"],
      },
    },
    primary_emotion: { type: ["string", "null"], description: "주된 감정 한 단어, 애매하면 null" },
  },
  required: ["items", "primary_emotion"],
};

const HappyItem = z.object({
  name: z.string(),
  category: z.enum(CATEGORIES),
  evidence: z.string(),
  visual_description: z.string(),
  uniqueness: z.enum(["common", "rare"]),
});

const ExtractionResult = z.object({
  items: z.array(HappyItem).max(5),
  primary_emotion: z.string().nullable(),
});

const SYSTEM_PROMPT = `너는 "행복찾기" 앱의 아이템 추출 엔진이다.
사용자가 소소한 행복의 순간을 적은 메모에서, 나중에 게임 아이템/아이콘으로 만들 수 있는
"그 경험만의 특색있는 아이템"을 추출한다.

규칙:
- "오늘", "행복", "좋았다"처럼 감정 서술어나 일반 명사는 아이템으로 뽑지 않는다.
- 그 순간을 대표하는 구체적 사물/음식/장소/자연/동물/활동 요소를 우선한다.
  카테고리 사이에 우선순위는 없다 — 문장에 등장한 각 요소를 해당 카테고리 그대로 뽑는다.
- "동물"은 사람이 아닌 생물만 해당한다(고양이, 강아지, 앵무새 등). 사람(친구, 가족,
  아기, 타인 등 모든 인간과 그 신체 부위·행동)은 어떤 카테고리로도, "동물"에도
  뽑지 않는다. 사람만 등장하고 다른 구체물이 없으면 items는 빈 배열이다.
- 문장에 명시적으로 등장하거나 강하게 암시된 것만 뽑는다. 지어내지 않는다.
- "바람", "냄새", "소리", "온도"처럼 형체 없는 감각은 아이템으로 뽑지 않는다 —
  대신 visual_description이나 primary_emotion에 반영한다.
- 활동(예: "요가", "수영", "클라이밍")은 그 자체로 유효한 아이템이다. 관련 도구가
  문장에 없다면 도구를 지어내지 말고 활동명을 그대로 뽑는다.
- 문장에 구체적 요소가 여러 개 있으면 하나로 합치지 말고 각각 별도 아이템으로 뽑는다.
- 구체적인 아이템이 하나도 없으면 items를 빈 배열로 반환한다. 억지로 만들어내지 않는다.
- 반드시 JSON만 출력한다. 설명이나 <think> 같은 부연 텍스트를 붙이지 않는다.`;

// few-shot 예시(대화 턴에 예시 user/assistant 쌍 추가)로 "사람은 동물에도 뽑지
// 않는다" 규칙을 보강해봤지만, gemma3:4b 100케이스 평가에서 매치율 70.1%→67.0%,
// 엣지케이스 통과율 64.7%→29.4%로 오히려 나빠져 롤백했다 (poc/eval-results.md 참고).
// 원래 고치려던 문제는 안 고쳐지고 관련 없는 카테고리(사물→장소)까지 깨진 걸 보면,
// 컨텍스트가 늘어나면서 시스템 프롬프트 지시에 대한 주의가 흐트러진 것으로 보인다 —
// 3~8B급 로컬 모델은 few-shot보다 규칙 텍스트만으로 유지하는 게 낫다.

interface OllamaChatResponse {
  message: { content: string };
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

async function callOllama(model: string, memo: string): Promise<OllamaChatResponse> {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature: 0 },
      format: RESPONSE_JSON_SCHEMA,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: memo },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama 요청 실패 (${res.status}): ${await res.text()}`);
  }

  return res.json() as Promise<OllamaChatResponse>;
}

/**
 * ollama는 모델을 요청 사이에 메모리에 계속 들고 있다가 유휴 상태가 일정 시간
 * 지나야 내린다. 여러 모델을 순서대로 비교하는 이 스크립트에서는 그 유휴 시간이
 * 오기 전에 다음 모델을 또 로드하게 되어, 여러 모델이 동시에 메모리에 쌓인다 —
 * 이 머신은 여유 메모리가 넉넉하지 않아 이 상태에서 추론이 극단적으로 느려지고
 * 5분 안에 응답을 못 받으면 fetch 자체가 실패한다. 모델을 바꾸기 전에 명시적으로
 * 언로드해서 항상 하나의 모델만 메모리에 남도록 한다.
 */
async function unloadModel(model: string) {
  await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
  });
}

async function extractWithRetry(model: string, memo: string) {
  let lastRawContent = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await callOllama(model, memo);
    lastRawContent = response.message.content;

    let json: unknown;
    try {
      json = JSON.parse(lastRawContent);
    } catch {
      continue;
    }

    const parsed = ExtractionResult.safeParse(json);
    if (parsed.success) {
      return { data: parsed.data, response, attempt, schemaFailures: attempt - 1 };
    }
  }
  console.log(`  [${model}] ${MAX_ATTEMPTS}회 모두 실패한 마지막 원본 응답:\n${lastRawContent}`);
  throw new Error(`"${memo}" 추출이 ${MAX_ATTEMPTS}회 모두 실패했다`);
}

/** 정답 하나가 실제 추출 결과에 있는지: 카테고리 일치 + 이름 부분 포함(양방향). */
function isMatched(expected: ExpectedItem, actual: { name: string; category: string }[]) {
  return actual.some(
    (a) =>
      a.category === expected.category &&
      (a.name.includes(expected.name) || expected.name.includes(a.name)),
  );
}

interface ModelStats {
  model: string;
  matchedCount: number;
  totalExpected: number;
  edgeCaseTotal: number;
  edgeCasePassed: number;
  schemaFailures: number;
  errorCount: number;
  totalPromptTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  failures: { memo: string; expected: ExpectedItem[]; actual: string[] }[];
}

async function runEval(model: string, cases: TestCase[]): Promise<ModelStats> {
  const stats: ModelStats = {
    model,
    matchedCount: 0,
    totalExpected: 0,
    edgeCaseTotal: 0,
    edgeCasePassed: 0,
    schemaFailures: 0,
    errorCount: 0,
    totalPromptTokens: 0,
    totalOutputTokens: 0,
    totalDurationMs: 0,
    failures: [],
  };

  for (const [i, testCase] of cases.entries()) {
    process.stdout.write(`  [${model}] [${i + 1}/${cases.length}] `);
    try {
      const { data, response, schemaFailures } = await extractWithRetry(model, testCase.memo);
      stats.schemaFailures += schemaFailures;
      stats.totalPromptTokens += response.prompt_eval_count ?? 0;
      stats.totalOutputTokens += response.eval_count ?? 0;
      stats.totalDurationMs += (response.total_duration ?? 0) / 1_000_000;

      if (testCase.expected.length === 0) {
        stats.edgeCaseTotal++;
        const pass = data.items.length === 0;
        if (pass) stats.edgeCasePassed++;
        console.log(pass ? "엣지케이스 통과" : `엣지케이스 실패 (${data.items.length}개)`);
        if (!pass) {
          stats.failures.push({
            memo: testCase.memo,
            expected: [],
            actual: data.items.map((it) => `${it.name}(${it.category})`),
          });
        }
        continue;
      }

      stats.totalExpected += testCase.expected.length;
      let caseMatched = 0;
      for (const exp of testCase.expected) {
        if (isMatched(exp, data.items)) {
          stats.matchedCount++;
          caseMatched++;
        }
      }
      const pass = caseMatched === testCase.expected.length;
      console.log(pass ? `통과 (${caseMatched}/${testCase.expected.length})` : `부분/실패 (${caseMatched}/${testCase.expected.length})`);
      if (!pass) {
        stats.failures.push({
          memo: testCase.memo,
          expected: testCase.expected,
          actual: data.items.map((it) => `${it.name}(${it.category})`),
        });
      }
    } catch (err) {
      stats.errorCount++;
      console.log("에러:", (err as Error).message);
      stats.failures.push({ memo: testCase.memo, expected: testCase.expected, actual: ["(에러 발생)"] });
    }
  }

  return stats;
}

function printModelReport(stats: ModelStats) {
  console.log(`\n--- ${stats.model} 실패/부분 실패 케이스 ---`);
  for (const f of stats.failures) {
    console.log(`- "${f.memo}"`);
    console.log(`    정답: ${f.expected.map((e) => `${e.name}(${e.category})`).join(", ") || "(없음)"}`);
    console.log(`    실제: ${f.actual.join(", ") || "(없음)"}`);
  }
}

function printComparisonTable(allStats: ModelStats[]) {
  console.log("\n===================================");
  console.log("모델 비교 요약");
  console.log("===================================");
  for (const s of allStats) {
    const matchRate = s.totalExpected ? ((s.matchedCount / s.totalExpected) * 100).toFixed(1) : "0";
    const edgeRate = s.edgeCaseTotal ? ((s.edgeCasePassed / s.edgeCaseTotal) * 100).toFixed(1) : "-";
    const avgDurationS = s.totalDurationMs / 1000 / (s.matchedCount + s.errorCount + s.edgeCaseTotal || 1);
    console.log(`\n[${s.model}]`);
    console.log(`  아이템 매치율: ${s.matchedCount}/${s.totalExpected} (${matchRate}%)`);
    console.log(`  엣지케이스 통과율: ${s.edgeCasePassed}/${s.edgeCaseTotal} (${edgeRate}%)`);
    console.log(`  스키마 재시도: ${s.schemaFailures}회, 에러: ${s.errorCount}건`);
    console.log(
      `  총 소요시간: ${(s.totalDurationMs / 1000).toFixed(1)}s (케이스당 평균 ${avgDurationS.toFixed(1)}s), ` +
        `총 토큰: prompt=${s.totalPromptTokens}, output=${s.totalOutputTokens}`,
    );
  }
}

async function main() {
  const models = process.argv[2] ? process.argv[2].split(",") : DEFAULT_MODELS;
  const limit = process.argv[3] ? Number(process.argv[3]) : DEFAULT_LIMIT;
  const cases = TEST_CASES.slice(0, limit);

  console.log(`모델 ${models.length}개 x 케이스 ${cases.length}개 비교 시작: ${models.join(", ")}`);

  const allStats: ModelStats[] = [];
  for (const model of models) {
    console.log(`\n### ${model} 시작 ###`);
    const stats = await runEval(model, cases);
    allStats.push(stats);
    printModelReport(stats);
    await unloadModel(model);
  }

  printComparisonTable(allStats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
