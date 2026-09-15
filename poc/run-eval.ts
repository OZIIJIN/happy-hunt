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
import { TEST_CASES, type ExpectedItem, type TestCase } from "./test-memos.js";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";

const DEFAULT_MODELS = ["qwen3:8b", "qwen2.5:7b", "qwen2.5:3b"];
const DEFAULT_LIMIT = 50;

const CATEGORIES = ["음식", "장소", "자연", "사물", "사람_동물", "활동", "기타"] as const;

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
- 그 순간을 대표하는 구체적 사물/음식/장소/자연 요소를 우선한다.
- 문장에 명시적으로 등장하거나 강하게 암시된 것만 뽑는다. 지어내지 않는다.
- 근거가 빈약하면 억지로 5개를 채우지 말고 1~2개만 반환해도 된다.
- 반드시 JSON만 출력한다. 설명이나 <think> 같은 부연 텍스트를 붙이지 않는다.`;

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
      options: { temperature: 0.2 },
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

async function extractWithRetry(model: string, memo: string) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await callOllama(model, memo);
    const parsed = ExtractionResult.safeParse(JSON.parse(response.message.content));

    if (parsed.success) {
      return { data: parsed.data, response, attempt, schemaFailures: attempt - 1 };
    }
  }
  throw new Error(`"${memo}" 추출이 2회 모두 스키마 검증에 실패했다`);
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
  }

  for (const stats of allStats) {
    printModelReport(stats);
  }
  printComparisonTable(allStats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
