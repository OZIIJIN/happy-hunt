/**
 * POC: 행복 메모(자연어 문장)에서 "그 순간만의 특색있는 아이템"을 추출한다.
 * 추출에 쓰는 LLM은 로컬(Ollama)이다 — 외부 API 키가 필요 없다.
 *
 * 3단계 파이프라인 (recall → precision → enrichment로 관심사 분리):
 *   1단계 후보 추출 — 문장에 등장한 후보를 필터링 없이 최대한 빠짐없이 뽑는다
 *     (사람/감각 표현도 포함해서 다 뽑는다. recall 중심).
 *   2단계 분류 — 후보 하나하나를 카테고리로만 분류한다(새 후보를 만들거나 keep
 *     여부를 직접 판단하지 않는다. precision 중심). "버릴 이유"를 하나의 IGNORE로
 *     뭉치지 않고 PERSON/EMOTION_REACTION/SENSORY/GENERIC/OTHER로 세분화해서,
 *     모델에게는 "왜 버릴지"까지 긍정적인 분류 문제로 준다. keep 여부는 code가
 *     KEEP_CATEGORIES 화이트리스트로 판정한다.
 *   3단계 구체화 — 2단계에서 KEEP 카테고리로 분류된 최종 아이템에 대해서만 아이콘
 *     생성용 visual_description/uniqueness를 만든다 (생존 여부는 다시 판단하지 않는다).
 * 각 단계가 딱 하나의 일만 하게 나누면, "사람 오분류"는 2단계 분류 문제로,
 * "엣지케이스 과다추출"은 2단계 DROP 카테고리 판정 문제로, "다중 아이템 누락"은
 * 1단계 recall 문제로 분리된다 — 예전처럼 하나의 프롬프트/매치율에 세 문제가
 * 섞이지 않는다.
 *
 * 클라우드 API와 다른 점: 로컬 모델은 "스키마를 어겼을 때" 재시도/검증을 앱이 직접
 * 책임져야 한다. 그래서 각 단계는 (1) JSON Schema로 형식을 강하게 유도하고,
 * (2) Zod로 결과를 다시 검증하고, (3) 실패하면 재시도하는 동일한 구조로 되어 있다.
 *
 * 사전 준비: `ollama pull gemma3:4b` (또는 OLLAMA_MODEL 환경변수로 다른 모델 지정)
 * 실행: npm run poc:items
 */
import { z } from "zod";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "gemma3:4b";

// 로컬 모델은 JSON Schema로 형식을 유도해도 가끔(모델에 따라 10%대 확률로) JSON
// 문법 자체가 깨지거나 스키마를 어기는 응답을 낸다 — 연속 호출 중에만 간헐적으로
// 나타나고 재현이 잘 안 되는 걸로 봐서 일종의 샘플링 변동성으로 보인다. 재시도
// 횟수를 넉넉히 잡아 방어한다.
const MAX_ATTEMPTS = 4;

const CATEGORIES = [
  "FOOD",
  "PLACE",
  "OBJECT",
  "NATURE",
  "ANIMAL",
  "ACTIVITY",
  "PERSON",
  "EMOTION_REACTION",
  "SENSORY",
  "GENERIC",
  "OTHER",
] as const;
type Category = (typeof CATEGORIES)[number];

// "버릴 이유"를 하나의 IGNORE로 뭉치면 모델이 왜 버려야 하는지 판단하기 어렵다 —
// 대신 버리는 이유별로 카테고리를 나누면(사람/감정반응/감각/일반표현/기타) 모델
// 입장에서 "왜 버릴지" 자체가 긍정적인 분류 문제가 된다. keep 여부는 모델에게
// 시키지 않고, 분류된 category를 code가 이 화이트리스트로 판정한다 — 모델의
// 책임을 "이게 뭔지 분류하기"로만 좁힌다.
const KEEP_CATEGORIES = new Set<Category>(["FOOD", "PLACE", "OBJECT", "NATURE", "ANIMAL", "ACTIVITY"]);

const UNIQUENESS_LEVELS = ["GENERIC", "SPECIFIC", "DISTINCTIVE"] as const;

interface OllamaChatResponse {
  message: { content: string };
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

async function callOllama(
  systemPrompt: string,
  jsonSchema: object,
  userContent: string,
): Promise<OllamaChatResponse> {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      options: { temperature: 0 },
      format: jsonSchema,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama 요청 실패 (${res.status}): ${await res.text()}`);
  }

  return res.json() as Promise<OllamaChatResponse>;
}

/** 세 단계가 공유하는 "JSON Schema로 유도 + Zod로 검증 + 실패 시 재시도" 루프. */
async function callWithRetry<S extends z.ZodTypeAny>(
  stageLabel: string,
  systemPrompt: string,
  jsonSchema: object,
  userContent: string,
  zodSchema: S,
): Promise<{ data: z.infer<S>; response: OllamaChatResponse }> {
  let lastRawContent = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await callOllama(systemPrompt, jsonSchema, userContent);
    lastRawContent = response.message.content;

    let json: unknown;
    try {
      json = JSON.parse(lastRawContent);
    } catch (err) {
      console.log(`  [${stageLabel}] (시도 ${attempt} JSON 파싱 실패, 재시도: ${(err as Error).message})`);
      continue;
    }

    const parsed = zodSchema.safeParse(json);
    if (parsed.success) {
      return { data: parsed.data, response };
    }
    console.log(`  [${stageLabel}] (시도 ${attempt} 스키마 검증 실패, 재시도: ${parsed.error.issues[0]?.message})`);
  }

  console.log(`  [${stageLabel}] ${MAX_ATTEMPTS}회 모두 실패한 마지막 원본 응답:\n${lastRawContent}`);
  throw new Error(`[${stageLabel}] ${MAX_ATTEMPTS}회 모두 실패했다`);
}

// ============================================================
// 1단계 — Candidate Recall: 판단/필터링 없이 후보를 빠짐없이 뽑는다.
// ============================================================

const CANDIDATE_JSON_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["name", "evidence"],
      },
    },
  },
  required: ["candidates"],
};

const Candidate = z.object({ name: z.string(), evidence: z.string() });
const CandidateResult = z.object({ candidates: z.array(Candidate) });

const CANDIDATE_SYSTEM_PROMPT = `너는 문장에서 아이템 후보를 찾는 추출기다.

입력 문장에 실제로 등장한 구체적인 대상과 활동 표현을 빠짐없이 찾아라.

추출 대상:
- 사물
- 음식
- 장소
- 자연물
- 동물
- 사람 및 신체 부위
- 구체적인 활동

규칙:
1. 대표적인 하나만 고르지 말고, 해당하는 후보를 모두 추출한다.
2. 후보를 분류하거나 제거하지 않는다.
3. 사람이나 신체 부위도 후보로 등장하면 추출한다.
4. 입력 문장에 없는 대상을 추측하거나 만들어내지 않는다.
5. 후보 이름은 가능하면 원문의 표현을 그대로 사용한다.
6. evidence에는 해당 후보를 확인할 수 있는 원문의 짧은 구절을 그대로 넣는다.
7. 서로 다른 후보를 하나의 아이템으로 합치지 않는다.
8. 같은 대상을 반복해서 추출하지 않는다.
9. 추출할 후보가 없다면 candidates를 빈 배열로 반환한다.
10. 반드시 지정된 JSON 형식으로만 응답한다.`;

// ============================================================
// 2단계 — Classification: 후보를 카테고리로 분류한다. keep 여부는 모델에게
// 시키지 않고, 분류된 category를 code가 KEEP_CATEGORIES로 판정한다.
// ============================================================

const CLASSIFY_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          evidence: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
        },
        required: ["name", "evidence", "category"],
      },
    },
  },
  required: ["items"],
};

const ClassifiedCandidate = z.object({
  name: z.string(),
  evidence: z.string(),
  category: z.enum(CATEGORIES),
});
const ClassifyResult = z.object({ items: z.array(ClassifiedCandidate) });

const CLASSIFY_SYSTEM_PROMPT = `너는 아이템 후보 분류기다.

각 후보를 반드시 아래 카테고리 중 하나로만 분류한다.

분류 우선순위:
1. 후보가 사람, 인간관계, 신체 부위라면 다른 의미를 고려하지 말고 반드시 PERSON으로
   분류한다.
2. PERSON이 아닌 경우에만 나머지 카테고리를 판단한다.

예:
- 친구 → PERSON
- 엄마 → PERSON
- 사람 → PERSON
- 손 → PERSON
- 얼굴 → PERSON
- 고양이 → ANIMAL

중요: 인간은 이 태스크에서 절대 ANIMAL로 분류하지 않는다.

KEEP:
- FOOD: 음식, 음료
- PLACE: 장소, 공간
- OBJECT: 구체적인 사물
- NATURE: 구체적인 자연물 또는 자연 현상
- ANIMAL: 사람이 아닌 동물
- ACTIVITY: 의도적으로 수행하는 구체적인 활동/취미
  예: 산책, 수영, 요가, 독서, 클라이밍

DROP:
- PERSON: 사람, 사람을 가리키는 표현, 신체 부위
- EMOTION_REACTION: 감정이나 감정에 따른 반응
  예: 행복, 마음, 웃음, 울음, 미소
- SENSORY: 형체 없는 감각
  예: 냄새, 소리, 따뜻함, 시원함
- GENERIC: 시간, 날짜, 너무 일반적이거나 추상적인 표현
  예: 오늘, 하루, 날, 아침, 저녁
- OTHER: 위 분류에 해당하지 않으며 아이템으로 쓰기 어려운 표현

추가 기준:
- "비" → NATURE
- "날" → GENERIC
- "웃음" → EMOTION_REACTION
- "산책" → ACTIVITY
- "할아버지" → PERSON
- "할아버지 사진첩" → OBJECT

규칙:
1. 입력 후보만 분류한다.
2. 후보 이름과 evidence는 수정하지 않는다.
3. 새로운 후보를 추가하지 않는다.
4. 애매하면 KEEP 카테고리에 억지로 넣지 말고 OTHER로 분류한다.
5. category만 판단한다. keep 여부는 출력하지 않는다.
6. 반드시 JSON만 출력한다.`;

// ============================================================
// 3단계 — Item Enrichment: keep=true인 최종 아이템만 아이콘 생성용으로 구체화한다.
// ============================================================

const ENRICH_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          evidence: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          visual_description: { type: "string" },
          uniqueness: { type: "string", enum: UNIQUENESS_LEVELS },
        },
        required: ["name", "evidence", "category", "visual_description", "uniqueness"],
      },
    },
  },
  required: ["items"],
};

const EnrichedItem = z.object({
  name: z.string(),
  evidence: z.string(),
  category: z.enum(CATEGORIES),
  visual_description: z.string(),
  uniqueness: z.enum(UNIQUENESS_LEVELS),
});
const EnrichResult = z.object({ items: z.array(EnrichedItem) });

const ENRICH_SYSTEM_PROMPT = `너는 최종 아이템을 아이콘 생성에 사용할 수 있도록 구체화하는 역할이다.

입력으로 주어진 아이템은 이미 추출과 필터링이 끝난 최종 아이템이다.

각 아이템에 대해 다음 두 필드를 생성한다.

visual_description
- 해당 아이템을 하나의 작은 아이콘으로 표현하기 위한 시각적 설명
- 아이템의 형태, 특징, 색이나 질감 등 눈에 보이는 요소 위주로 작성한다.
- 장면 전체를 설명하지 않는다.
- 사람이나 원문에 없는 새로운 물체를 임의로 추가하지 않는다.
- 간결하게 작성한다.

uniqueness
- 이 아이템이 해당 순간에서 얼마나 구체적이고 특징적인지를 분류한다.

값은 다음 중 하나다.

GENERIC
- 너무 흔하거나 범용적인 아이템
- 예: 물, 의자, 길

SPECIFIC
- 어느 정도 구체적인 특징이 있는 아이템
- 예: 치킨, 커피, 벚꽃

DISTINCTIVE
- 해당 경험을 강하게 떠올릴 수 있을 정도로 구체적인 아이템
- 예: 딸기 생크림 케이크, 노을 진 한강, 할아버지의 낡은 사진첩

규칙:

1. 입력으로 주어진 아이템을 삭제하거나 추가하지 않는다.
2. name, evidence, category는 수정하지 않는다.
3. 입력에 없는 사실을 지어내지 않는다.
4. visual_description은 아이콘 제작자가 바로 그림으로 옮길 수 있도록 시각적으로 작성한다.
5. visual_description에 감정이나 추상적인 설명보다 보이는 특징을 우선한다.
6. uniqueness는 아이템 이름과 evidence를 기준으로 판단한다.
7. 모든 아이템에 visual_description과 uniqueness를 반드시 작성한다.
8. 반드시 지정된 JSON 형식으로만 응답한다.`;

const TEST_MEMOS = [
  "오늘 친구랑 한강에서 치킨 먹으면서 노을 봤어. 진짜 행복했다.",
  "비 오는 날 창가에 앉아서 따뜻한 라떼 마시면서 좋아하는 책 읽었어.",
  "엄마가 끓여준 된장찌개 먹으니까 집 생각나서 마음이 따뜻해졌다.",
  "퇴근하고 강아지랑 산책하는데 하늘에 별이 엄청 많았다.",
  "오랜만에 옛날 친구를 만나서 옛날 이야기하면서 엄청 웃었다.",
];

async function main() {
  let totalPromptTokens = 0;
  let totalOutputTokens = 0;
  let totalDurationMs = 0;
  const trackUsage = (response: OllamaChatResponse) => {
    totalPromptTokens += response.prompt_eval_count ?? 0;
    totalOutputTokens += response.eval_count ?? 0;
    totalDurationMs += (response.total_duration ?? 0) / 1_000_000;
  };

  for (const memo of TEST_MEMOS) {
    console.log("\n===================================");
    console.log("메모:", memo);

    const stage1 = await callWithRetry(
      "1단계 후보추출",
      CANDIDATE_SYSTEM_PROMPT,
      CANDIDATE_JSON_SCHEMA,
      memo,
      CandidateResult,
    );
    trackUsage(stage1.response);
    console.log(
      "후보:",
      stage1.data.candidates.length ? stage1.data.candidates.map((c) => c.name).join(", ") : "(없음)",
    );

    if (stage1.data.candidates.length === 0) {
      continue;
    }

    const stage2 = await callWithRetry(
      "2단계 분류",
      CLASSIFY_SYSTEM_PROMPT,
      CLASSIFY_JSON_SCHEMA,
      JSON.stringify({ candidates: stage1.data.candidates }),
      ClassifyResult,
    );
    trackUsage(stage2.response);
    for (const item of stage2.data.items) {
      console.log(`  [${KEEP_CATEGORIES.has(item.category) ? "유지" : "제외"}/${item.category}] ${item.name}`);
    }

    const kept = stage2.data.items.filter((item) => KEEP_CATEGORIES.has(item.category));
    if (kept.length === 0) {
      console.log("  → 최종 아이템 없음");
      continue;
    }

    const stage3 = await callWithRetry(
      "3단계 구체화",
      ENRICH_SYSTEM_PROMPT,
      ENRICH_JSON_SCHEMA,
      JSON.stringify({ items: kept.map(({ name, evidence, category }) => ({ name, evidence, category })) }),
      EnrichResult,
    );
    trackUsage(stage3.response);

    console.log("최종 아이템:");
    for (const item of stage3.data.items) {
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
