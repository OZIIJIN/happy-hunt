/**
 * test-memos.ts의 TEST_CASES(정답 포함)를 여러 로컬 모델로 돌려서
 * 정확도/속도를 비교한다.
 *
 * extract-items.ts와 추출 로직(3단계 파이프라인: 후보추출 → 분류 → 구체화)은
 * 동일하게 맞췄다 — 이 파일은 그 위에 "정답과 비교해서 채점 + 모델간 비교"를
 * 추가한 버전이다. 3단계 세부 설계 이유는 extract-items.ts 헤더 주석 참고.
 *
 * test-memos.ts의 정답 카테고리는 한글(음식/장소/자연/사물/동물/활동)이고 파이프라인의
 * 최종 카테고리는 영어(FOOD/PLACE/...)라 CATEGORY_KO_TO_EN으로 채점 시에만 매핑한다.
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
// 시키지 않고, 분류된 category를 code가 이 화이트리스트로 판정한다.
const KEEP_CATEGORIES = new Set<Category>(["FOOD", "PLACE", "OBJECT", "NATURE", "ANIMAL", "ACTIVITY"]);

const UNIQUENESS_LEVELS = ["GENERIC", "SPECIFIC", "DISTINCTIVE"] as const;

const CATEGORY_KO_TO_EN: Record<string, Category> = {
  음식: "FOOD",
  장소: "PLACE",
  사물: "OBJECT",
  자연: "NATURE",
  동물: "ANIMAL",
  활동: "ACTIVITY",
};

interface OllamaChatResponse {
  message: { content: string };
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

async function callOllama(
  model: string,
  systemPrompt: string,
  jsonSchema: object,
  userContent: string,
): Promise<OllamaChatResponse> {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
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

/** 세 단계가 공유하는 "JSON Schema로 유도 + Zod로 검증 + 실패 시 재시도" 루프. */
async function callWithRetry<S extends z.ZodTypeAny>(
  model: string,
  stageLabel: string,
  systemPrompt: string,
  jsonSchema: object,
  userContent: string,
  zodSchema: S,
): Promise<{ data: z.infer<S>; response: OllamaChatResponse; schemaFailures: number }> {
  let lastRawContent = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await callOllama(model, systemPrompt, jsonSchema, userContent);
    lastRawContent = response.message.content;

    let json: unknown;
    try {
      json = JSON.parse(lastRawContent);
    } catch {
      continue;
    }

    const parsed = zodSchema.safeParse(json);
    if (parsed.success) {
      return { data: parsed.data, response, schemaFailures: attempt - 1 };
    }
  }

  console.log(`  [${model}/${stageLabel}] ${MAX_ATTEMPTS}회 모두 실패한 마지막 원본 응답:\n${lastRawContent}`);
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

입력 문장에 실제로 등장하거나,
원문의 표현에서 직접적으로 알 수 있는 구체적인 대상과 활동을 빠짐없이 찾아라.

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
4. 원문에 근거가 없는 새로운 대상이나 활동을 추측하거나 만들어내지 않는다.
5. 사물, 음식, 장소, 자연물, 동물, 사람의 후보 이름은 가능하면 원문의 표현을 그대로 사용한다.
6. 활동은 원문의 행동 표현에서 직접적으로 알 수 있는 경우, 의미가 유지되는 범위에서 대표적인 활동명으로 정규화할 수 있다.
7. evidence에는 해당 후보를 확인할 수 있는 원문의 짧은 구절을 그대로 넣는다.
8. 서로 다른 후보를 하나의 아이템으로 합치지 않는다.
9. 같은 대상을 반복해서 추출하지 않는다.
10. 추출할 후보가 없다면 candidates를 빈 배열로 반환한다.
11. 반드시 지정된 JSON 형식으로만 응답한다.

활동 이름 정규화 예시:
- "자유형을 완주했다" → "수영"
- "빵을 구웠다" → "베이킹"
- "여행 계획을 짜고 떠났다" → "여행"
- "자전거를 탔다" → "자전거"
- "그림을 그렸다" → "그림"

정규화하면 안 되는 예시:
- "국밥집에 들어갔다" → "국밥"으로 바꾸지 않는다.
- "수영장에 갔다" → "수영"으로 바꾸지 않는다.
- "카페에 있었다" → "커피"를 만들어내지 않는다.`;

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

const CLASSIFY_SYSTEM_PROMPT = `너는 아이템 후보의 의미적 카테고리를 분류하는 분류기다.

각 후보를 반드시 아래 카테고리 중 하나로만 분류한다.

분류 우선순위:
1. 후보가 사람, 인간관계, 신체 부위라면 반드시 PERSON으로 분류한다.
2. PERSON이 아닌 경우에만 나머지 카테고리를 판단한다.

KEEP 계열:
- FOOD: 음식, 음료
- PLACE: 장소, 공간
- OBJECT: 사람이 만들거나 사용하는 구체적인 물건.
  FOOD, PLACE, NATURE, ANIMAL, ACTIVITY에 해당하지 않을 때만 선택한다.
  예: 책, 우산, 카메라, 사진첩, 가방
- NATURE: 구체적인 자연물 또는 자연 현상
- ANIMAL: 사람이 아닌 동물
- ACTIVITY: 사람이 수행하는 구체적인 행동이나 활동
  예: 산책, 수영, 요가, 독서, 클라이밍, 통화, 이야기하기, 눕기, 잠자기

DROP 계열:
- PERSON: 사람, 인간관계 표현, 신체 부위
- EMOTION_REACTION: 감정이나 감정에 따른 반응
  예: 행복, 마음, 웃음, 울음, 미소
- SENSORY: 형체 없는 감각
  예: 냄새, 소리, 따뜻함, 시원함
- GENERIC: 시간, 날짜, 너무 일반적이거나 추상적인 표현
  예: 오늘, 하루, 날, 아침, 저녁
- OTHER: 위 카테고리 중 어느 것에도 해당하지 않는 표현

중요:
- 인간은 절대 ANIMAL로 분류하지 않는다.
- 다른 카테고리에 해당하면 OBJECT보다 해당 카테고리를 우선한다.
- OBJECT는 다른 구체적인 카테고리에 해당하지 않는 물건에만 사용한다.
- ACTIVITY에서는 그 활동이 앱에서 좋은 아이템인지 판단하지 않는다.
  사람이 수행하는 행동/활동인지 의미만 분류한다.

예:
- 친구 → PERSON
- 엄마 → PERSON
- 고양이 → ANIMAL
- 딸기 케이크 → FOOD
- 만두 → FOOD
- 서점 → PLACE
- 봉숭아 → NATURE
- 책 → OBJECT
- 우산 → OBJECT
- 산책 → ACTIVITY
- 통화 → ACTIVITY
- 이야기 → ACTIVITY
- 눕기 → ACTIVITY
- 날 → GENERIC
- 웃음 → EMOTION_REACTION

규칙:
1. 입력 후보만 분류한다.
2. 후보 이름과 evidence는 수정하지 않는다.
3. 새로운 후보를 추가하지 않는다.
4. category만 판단한다.
5. 반드시 JSON만 출력한다.`;

// ============================================================
// 2.5단계 — ACTIVITY Collectibility: 2단계에서 ACTIVITY로 분류된 후보만 모아,
// "앱의 수집 아이템으로 쓸 만큼 독립적인 활동인가"를 원문 맥락과 함께 판정한다.
// 2단계(ontology 분류)와 제품 정책 판정을 한 질문으로 섞지 않기 위해 분리했다 —
// "통화 = ACTIVITY"(2단계)와 "통화 = NOT_COLLECTIBLE"(2.5단계)가 모순 없이 공존한다.
// 모든 KEEP 후보로 범위를 넓혀본 적이 있는데, Context Rejection Rate가 41.4%까지
// 떨어지고 엣지케이스가 94.1%→58.8%로 무너져서 ACTIVITY 전용으로 되돌렸다.
// ============================================================

const ACTIVITY_FILTER_JSON_SCHEMA = {
  type: "object",
  properties: {
    activities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          result: { type: "string", enum: ["COLLECTIBLE", "NOT_COLLECTIBLE"] },
        },
        required: ["name", "result"],
      },
    },
  },
  required: ["activities"],
};

const ActivityVerdict = z.object({
  name: z.string(),
  result: z.enum(["COLLECTIBLE", "NOT_COLLECTIBLE"]),
});
const ActivityFilterResult = z.object({ activities: z.array(ActivityVerdict) });

const ACTIVITY_FILTER_SYSTEM_PROMPT = `너는 활동 후보가 "행복찾기" 앱의 수집 아이템으로
사용할 만한 독립적인 활동인지 판정한다.

입력에는 원문과 ACTIVITY 후보들이 주어진다.

각 후보를 다음 중 하나로 판정한다.

COLLECTIBLE:
- 행동 자체가 하나의 독립적인 경험이나 활동으로 볼 수 있다.
- 그 활동 자체만으로도 사용자가 무엇을 했는지 구체적으로 떠올릴 수 있다.
- 하나의 아이콘으로 수집할 만한 활동이다.
- 예: 산책, 수영, 요가, 독서, 클라이밍, 캠핑, 자전거 타기

NOT_COLLECTIBLE:
- 사람과의 관계나 교류를 보조하는 일상적인 행동
- 단순한 자세, 상태 또는 휴식
- 문장의 배경이 되는 부수적인 행동
- 사물의 상태 변화나 사람이 수행하지 않은 동작
- 그 행동만 떼어놓으면 독립적인 수집 경험으로 보기 어려운 것

판단할 때 후보 문자열만 보지 말고 반드시 원문과 evidence를 함께 본다.

예:
원문: "친구와 한참 이야기했다."
후보: "이야기"
→ NOT_COLLECTIBLE

원문: "친구와 오랜만에 통화했다."
후보: "통화"
→ NOT_COLLECTIBLE

원문: "오늘 침대에 누워만 있었다."
후보: "누워"
→ NOT_COLLECTIBLE

원문: "늦잠을 잤다."
후보: "늦잠"
→ NOT_COLLECTIBLE

원문: "계란말이가 조금 탔다."
후보: "탔다"
→ NOT_COLLECTIBLE

원문: "저녁에 공원을 산책했다."
후보: "산책"
→ COLLECTIBLE

원문: "오랜만에 자전거를 탔다."
후보: "자전거 타기"
→ COLLECTIBLE

원문: "카페에서 책을 읽었다."
후보: "독서"
→ COLLECTIBLE

규칙:
1. 입력으로 받은 ACTIVITY 후보만 판정한다.
2. 새로운 후보를 추가하거나 후보 이름을 수정하지 않는다.
3. 단어 형태가 아니라 원문의 의미와 문맥을 기준으로 판단한다.
4. 모든 후보에 대해 COLLECTIBLE 또는 NOT_COLLECTIBLE 중 하나만 선택한다.
5. 반드시 JSON만 출력한다.`;

// ============================================================
// 3단계 — Item Enrichment: 2단계(ACTIVITY 제외 KEEP 카테고리) + 2.5단계
// (COLLECTIBLE로 판정된 ACTIVITY)를 통과한 최종 아이템만 구체화한다.
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

interface FinalItem {
  name: string;
  evidence: string;
  category: Category;
  visual_description: string;
  uniqueness: (typeof UNIQUENESS_LEVELS)[number];
}

interface PipelineResult {
  items: FinalItem[];
  schemaFailures: number;
  totalPromptTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
}

/** 1단계(후보추출) → 2단계(분류) → 3단계(구체화)를 순서대로 실행한다. */
async function extractPipeline(model: string, memo: string): Promise<PipelineResult> {
  const result: PipelineResult = {
    items: [],
    schemaFailures: 0,
    totalPromptTokens: 0,
    totalOutputTokens: 0,
    totalDurationMs: 0,
  };
  const track = (response: OllamaChatResponse, schemaFailures: number) => {
    result.schemaFailures += schemaFailures;
    result.totalPromptTokens += response.prompt_eval_count ?? 0;
    result.totalOutputTokens += response.eval_count ?? 0;
    result.totalDurationMs += (response.total_duration ?? 0) / 1_000_000;
  };

  const stage1 = await callWithRetry(
    model,
    "1단계",
    CANDIDATE_SYSTEM_PROMPT,
    CANDIDATE_JSON_SCHEMA,
    memo,
    CandidateResult,
  );
  track(stage1.response, stage1.schemaFailures);
  if (stage1.data.candidates.length === 0) {
    return result;
  }

  const stage2 = await callWithRetry(
    model,
    "2단계",
    CLASSIFY_SYSTEM_PROMPT,
    CLASSIFY_JSON_SCHEMA,
    JSON.stringify({ candidates: stage1.data.candidates }),
    ClassifyResult,
  );
  track(stage2.response, stage2.schemaFailures);

  const kept = stage2.data.items.filter((item) => KEEP_CATEGORIES.has(item.category));
  const activityCandidates = kept.filter((item) => item.category === "ACTIVITY");
  const nonActivityKept = kept.filter((item) => item.category !== "ACTIVITY");

  let collectibleActivities: typeof activityCandidates = [];
  if (activityCandidates.length > 0) {
    const stage2_5 = await callWithRetry(
      model,
      "2.5단계",
      ACTIVITY_FILTER_SYSTEM_PROMPT,
      ACTIVITY_FILTER_JSON_SCHEMA,
      JSON.stringify({
        memo,
        activities: activityCandidates.map(({ name, evidence }) => ({ name, evidence })),
      }),
      ActivityFilterResult,
    );
    track(stage2_5.response, stage2_5.schemaFailures);
    const collectibleNames = new Set(
      stage2_5.data.activities.filter((v) => v.result === "COLLECTIBLE").map((v) => v.name),
    );
    collectibleActivities = activityCandidates.filter((item) => collectibleNames.has(item.name));
  }

  const finalKept = [...nonActivityKept, ...collectibleActivities];
  if (finalKept.length === 0) {
    return result;
  }

  const stage3 = await callWithRetry(
    model,
    "3단계",
    ENRICH_SYSTEM_PROMPT,
    ENRICH_JSON_SCHEMA,
    JSON.stringify({ items: finalKept.map(({ name, evidence, category }) => ({ name, evidence, category })) }),
    EnrichResult,
  );
  track(stage3.response, stage3.schemaFailures);

  result.items = stage3.data.items;
  return result;
}

/** 정답 하나가 실제 추출 결과에 있는지: 카테고리 일치(한글→영어 매핑) + 이름 부분 포함(양방향). */
function isMatched(expected: ExpectedItem, actual: { name: string; category: string }[]) {
  const expectedCategory = CATEGORY_KO_TO_EN[expected.category] ?? expected.category;
  const names = [expected.name, ...(expected.aliases ?? [])];
  return actual.some(
    (a) => a.category === expectedCategory && names.some((n) => a.name.includes(n) || n.includes(a.name)),
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
      const { items, schemaFailures, totalPromptTokens, totalOutputTokens, totalDurationMs } =
        await extractPipeline(model, testCase.memo);
      stats.schemaFailures += schemaFailures;
      stats.totalPromptTokens += totalPromptTokens;
      stats.totalOutputTokens += totalOutputTokens;
      stats.totalDurationMs += totalDurationMs;

      if (testCase.expected.length === 0) {
        stats.edgeCaseTotal++;
        const pass = items.length === 0;
        if (pass) stats.edgeCasePassed++;
        console.log(pass ? "엣지케이스 통과" : `엣지케이스 실패 (${items.length}개)`);
        if (!pass) {
          stats.failures.push({
            memo: testCase.memo,
            expected: [],
            actual: items.map((it) => `${it.name}(${it.category})`),
          });
        }
        continue;
      }

      stats.totalExpected += testCase.expected.length;
      let caseMatched = 0;
      for (const exp of testCase.expected) {
        if (isMatched(exp, items)) {
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
          actual: items.map((it) => `${it.name}(${it.category})`),
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
