/**
 * POC: 행복 메모(자연어 문장)에서 "그 순간만의 특색있는 아이템"을 추출한다.
 * 추출에 쓰는 LLM은 로컬(Ollama)이다 — 외부 API 키가 필요 없다.
 *
 * 이 스크립트가 검증하려는 것은 하나: 로컬 LLM이 뻔한 단어("오늘", "행복", "친구")가
 * 아니라 그 경험을 대표할 만한 구체적 아이템("치킨", "노을", "된장찌개")을
 * 신뢰할 수 있는 JSON 형식으로 골라낼 수 있는가.
 *
 * 클라우드 API와 다른 점: 로컬 모델은 "스키마를 어겼을 때" 재시도/검증을 앱이 직접
 * 책임져야 한다. 그래서 이 스크립트는 (1) JSON Schema로 형식을 강하게 유도하고,
 * (2) Zod로 결과를 다시 검증하고, (3) 실패하면 한 번 재시도하는 구조로 되어 있다.
 *
 * 사전 준비: `ollama pull qwen2.5:7b` (또는 OLLAMA_MODEL 환경변수로 다른 모델 지정)
 * 실행: npm run poc:items
 */
import { z } from "zod";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

// 로컬 모델은 JSON Schema로 형식을 유도해도 가끔(모델에 따라 10%대 확률로) JSON
// 문법 자체가 깨지거나 스키마를 어기는 응답을 낸다 — 연속 호출 중에만 간헐적으로
// 나타나고 재현이 잘 안 되는 걸로 봐서 일종의 샘플링 변동성으로 보인다. 재시도
// 횟수를 넉넉히 잡아 방어한다.
const MAX_ATTEMPTS = 4;

// 아이템 카테고리는 나중에 "아이콘 이미지 생성 프롬프트 템플릿"을 카테고리별로
// 분기하기 위한 것이라 지금부터 고정해둔다 (스타일 일관성 문제의 첫 단추).
const CATEGORIES = ["음식", "장소", "자연", "사물", "동물", "활동", "기타"] as const;

// 로컬 모델에게 형식을 강제하기 위한 JSON Schema (Ollama의 structured output).
// 필드 설명은 클라우드 모델용 프롬프트보다 짧고 명료하게 — 작은 모델일수록
// 장황한 지시보다 짧고 반복 가능한 지시를 더 잘 따른다.
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

// 위 JSON Schema로 형식을 유도해도 로컬 모델은 가끔 스키마를 어기거나
// enum에 없는 값을 넣는다. Zod는 "형식 강제"가 아니라 "결과 검증" 용도로 쓴다.
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
사용자가 소소한 행복의 순간을 적은 메모에서, 아이템/아이콘으로 만들 수 있는
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

const TEST_MEMOS = [
  "오늘 친구랑 한강에서 치킨 먹으면서 노을 봤어. 진짜 행복했다.",
  "비 오는 날 창가에 앉아서 따뜻한 라떼 마시면서 좋아하는 책 읽었어.",
  "엄마가 끓여준 된장찌개 먹으니까 집 생각나서 마음이 따뜻해졌다.",
  "퇴근하고 강아지랑 산책하는데 하늘에 별이 엄청 많았다.",
  "오랜만에 옛날 친구를 만나서 옛날 이야기하면서 엄청 웃었다.",
];

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
  let lastRawContent = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await callOllama(memo);
    lastRawContent = response.message.content;

    let json: unknown;
    try {
      json = JSON.parse(lastRawContent);
    } catch (err) {
      console.log(`  (시도 ${attempt} JSON 파싱 실패, 재시도: ${(err as Error).message})`);
      continue;
    }

    const parsed = ExtractionResult.safeParse(json);
    if (parsed.success) {
      return { data: parsed.data, response, attempt };
    }
    console.log(`  (시도 ${attempt} 스키마 검증 실패, 재시도: ${parsed.error.issues[0]?.message})`);
  }

  console.log(`  ${MAX_ATTEMPTS}회 모두 실패한 마지막 원본 응답:\n${lastRawContent}`);
  throw new Error(`"${memo}" 추출이 ${MAX_ATTEMPTS}회 모두 실패했다`);
}

async function main() {
  let totalPromptTokens = 0;
  let totalOutputTokens = 0;
  let totalDurationMs = 0;

  for (const memo of TEST_MEMOS) {
    console.log("\n===================================");
    console.log("메모:", memo);

    const { data, response } = await extractWithRetry(memo);

    totalPromptTokens += response.prompt_eval_count ?? 0;
    totalOutputTokens += response.eval_count ?? 0;
    totalDurationMs += (response.total_duration ?? 0) / 1_000_000;

    console.log("주된 감정:", data.primary_emotion ?? "(판단 불가)");
    for (const item of data.items) {
      console.log(
        `  - [${item.category}/${item.uniqueness}] ${item.name}` +
          `\n      근거: "${item.evidence}"` +
          `\n      비주얼: ${item.visual_description}`,
      );
    }
  }

  console.log("\n===================================");
  console.log(
    `모델: ${MODEL} | 총 토큰: prompt=${totalPromptTokens}, output=${totalOutputTokens} | ` +
      `총 소요시간: ${(totalDurationMs / 1000).toFixed(1)}s`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
