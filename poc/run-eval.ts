/**
 * test-memos.ts의 TEST_CASES(100개, 정답 포함)를 전부 돌려서
 * 모델 출력과 정답을 기계적으로 비교하고 정확도를 낸다.
 *
 * extract-items.ts와 추출 로직(스키마/프롬프트/재시도)은 동일하게 맞췄다 —
 * 이 파일은 그 위에 "정답과 비교해서 채점"만 추가한 버전이다.
 *
 * 실행: node --experimental-strip-types poc/run-eval.ts
 * 일부만 돌리고 싶으면: node --experimental-strip-types poc/run-eval.ts 10
 */
import { z } from "zod";
import { TEST_CASES, type ExpectedItem } from "./test-memos.js";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

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

async function callOllama(memo: string): Promise<OllamaChatResponse> {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
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

async function extractWithRetry(memo: string) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await callOllama(memo);
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

async function main() {
  const limit = process.argv[2] ? Number(process.argv[2]) : TEST_CASES.length;
  const cases = TEST_CASES.slice(0, limit);

  let matchedCount = 0;
  let totalExpected = 0;
  let edgeCaseTotal = 0;
  let edgeCasePassed = 0;
  let schemaFailures = 0;
  let totalPromptTokens = 0;
  let totalOutputTokens = 0;
  let totalDurationMs = 0;
  const failures: { memo: string; expected: ExpectedItem[]; actual: string[] }[] = [];

  for (const [i, testCase] of cases.entries()) {
    process.stdout.write(`[${i + 1}/${cases.length}] `);
    try {
      const { data, response, schemaFailures: sf } = await extractWithRetry(testCase.memo);
      schemaFailures += sf;
      totalPromptTokens += response.prompt_eval_count ?? 0;
      totalOutputTokens += response.eval_count ?? 0;
      totalDurationMs += (response.total_duration ?? 0) / 1_000_000;

      if (testCase.expected.length === 0) {
        edgeCaseTotal++;
        const pass = data.items.length === 0;
        if (pass) edgeCasePassed++;
        console.log(pass ? "엣지케이스 통과 (0개)" : `엣지케이스 실패 (${data.items.length}개 뽑음)`);
        if (!pass) {
          failures.push({
            memo: testCase.memo,
            expected: [],
            actual: data.items.map((it) => `${it.name}(${it.category})`),
          });
        }
        continue;
      }

      totalExpected += testCase.expected.length;
      let caseMatched = 0;
      for (const exp of testCase.expected) {
        if (isMatched(exp, data.items)) {
          matchedCount++;
          caseMatched++;
        }
      }
      const pass = caseMatched === testCase.expected.length;
      console.log(pass ? `통과 (${caseMatched}/${testCase.expected.length})` : `부분/실패 (${caseMatched}/${testCase.expected.length})`);
      if (!pass) {
        failures.push({
          memo: testCase.memo,
          expected: testCase.expected,
          actual: data.items.map((it) => `${it.name}(${it.category})`),
        });
      }
    } catch (err) {
      console.log("에러:", (err as Error).message);
      failures.push({ memo: testCase.memo, expected: testCase.expected, actual: ["(에러 발생)"] });
    }
  }

  console.log("\n===================================");
  console.log("실패/부분 실패 케이스:");
  for (const f of failures) {
    console.log(`- "${f.memo}"`);
    console.log(`    정답: ${f.expected.map((e) => `${e.name}(${e.category})`).join(", ") || "(없음)"}`);
    console.log(`    실제: ${f.actual.join(", ") || "(없음)"}`);
  }

  console.log("\n===================================");
  console.log(`모델: ${MODEL}`);
  console.log(
    `일반 케이스 아이템 매치율: ${matchedCount}/${totalExpected} (${totalExpected ? ((matchedCount / totalExpected) * 100).toFixed(1) : "0"}%)`,
  );
  console.log(
    `엣지케이스(아이템 없어야 함) 통과율: ${edgeCasePassed}/${edgeCaseTotal} (${edgeCaseTotal ? ((edgeCasePassed / edgeCaseTotal) * 100).toFixed(1) : "0"}%)`,
  );
  console.log(`스키마 검증 재시도 발생 횟수: ${schemaFailures}`);
  console.log(
    `총 토큰: prompt=${totalPromptTokens}, output=${totalOutputTokens} | 총 소요시간: ${(totalDurationMs / 1000).toFixed(1)}s`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
