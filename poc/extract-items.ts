/**
 * POC: 행복 메모(자연어 문장)에서 "그 순간만의 특색있는 아이템"을 추출한다.
 * 추출에 쓰는 LLM은 로컬(Ollama)이다 — 외부 API 키가 필요 없다.
 *
 * 파이프라인 (recall → ontology 분류 → 제품 정책 판정 → enrichment로 관심사 분리):
 *   1단계 후보 추출 — 문장에 등장한 후보를 필터링 없이 최대한 빠짐없이 뽑는다
 *     (사람/감각 표현도 포함해서 다 뽑는다. recall 중심).
 *   2단계 분류 — 후보 하나하나를 "이게 의미적으로 무엇이냐"만으로 카테고리에
 *     분류한다. "버릴 이유"를 하나의 IGNORE로 뭉치지 않고
 *     PERSON/EMOTION_REACTION/SENSORY/GENERIC/OTHER로 세분화한다. 중요: 여기서는
 *     "이게 앱 아이템으로 쓸 만한가" 같은 제품 정책은 묻지 않는다 — ontology
 *     분류와 제품 정책을 한 번에 물으면 모델이 둘을 뒤섞어 판단한다(예: "통화"가
 *     ACTIVITY인지와, 통화를 아이템으로 줄지를 같은 질문으로 취급).
 *   2.5단계 — ACTIVITY 수집 가치 판정: 2단계에서 ACTIVITY로 분류된 후보만 모아,
 *     "앱의 수집 아이템으로 쓸 만큼 독립적인 활동인가"를 원문 맥락과 함께 판정한다.
 *     여기서만 제품 정책(COLLECTIBLE/NOT_COLLECTIBLE)을 다룬다. 2단계와 2.5단계를
 *     분리하면 "통화 = ACTIVITY"(2단계, 맞음)와 "통화 = NOT_COLLECTIBLE"(2.5단계,
 *     맞음)가 서로 모순 없이 공존한다.
 *     (한 번 모든 KEEP 후보로 범위를 넓혀봤지만 Context Rejection Rate가
 *     41.4%까지 떨어지고 엣지케이스가 94.1%→58.8%로 무너져서 ACTIVITY 전용으로
 *     되돌렸다 — poc/eval-results.md 참고.)
 *   3단계 구체화 — 2단계(ACTIVITY 외) + 2.5단계(COLLECTIBLE로 판정된 ACTIVITY)를
 *     통과한 최종 아이템에 대해서만 아이콘 생성용 visual_description/uniqueness를
 *     만든다 (생존 여부는 다시 판단하지 않는다).
 * 각 단계가 딱 하나의 일만 하게 나누면, "사람 오분류"는 2단계 분류 문제로,
 * "엣지케이스 과다추출"은 2.5단계 COLLECTIBLE 판정 문제로, "다중 아이템 누락"은
 * 1단계 recall 문제로 분리된다 — 예전처럼 하나의 프롬프트/매치율에 여러 문제가
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
4. 입력 문장에 근거가 없는 대상이나 활동을 만들어내지 않는다.
5. 후보 이름은 원문의 의미를 유지하는 범위에서 기본형으로 정리할 수 있다.
6. 활동 표현은 행동이 드러나도록 정리하되, 다른 의미의 대표 활동명으로 바꾸지 않는다.
7. evidence에는 해당 후보를 확인할 수 있는 원문의 짧은 구절을 그대로 넣는다.
8. 서로 다른 후보를 하나의 아이템으로 합치지 않는다.
9. 같은 대상을 반복해서 추출하지 않는다.
10. 추출할 후보가 없다면 candidates를 빈 배열로 반환한다.
11. 반드시 지정된 JSON 형식으로만 응답한다.

예:
- "자유형을 완주했다" → "자유형"
- "빵을 구웠다" → "빵 굽기"
- "피아노를 쳤다" → "피아노 치기"
- "자전거를 탔다" → "자전거 타기"
- "푹 쉬었다" → "쉬기"

하지 말아야 할 정규화:
- "자유형" → "수영"
- "빵 굽기" → "베이킹"
- "피아노 치기" → "피아노 연주"
- "쉬기" → "휴식"`;

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
// (COLLECTIBLE로 판정된 ACTIVITY)를 통과한 최종 아이템만 아이콘 생성용으로
// 구체화한다.
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
    const activityCandidates = kept.filter((item) => item.category === "ACTIVITY");
    const nonActivityKept = kept.filter((item) => item.category !== "ACTIVITY");

    let collectibleActivities: typeof activityCandidates = [];
    if (activityCandidates.length > 0) {
      const stage2_5 = await callWithRetry(
        "2.5단계 활동판정",
        ACTIVITY_FILTER_SYSTEM_PROMPT,
        ACTIVITY_FILTER_JSON_SCHEMA,
        JSON.stringify({
          memo,
          activities: activityCandidates.map(({ name, evidence }) => ({ name, evidence })),
        }),
        ActivityFilterResult,
      );
      trackUsage(stage2_5.response);
      for (const v of stage2_5.data.activities) {
        console.log(`  [2.5단계/${v.result}] ${v.name}`);
      }
      const collectibleNames = new Set(
        stage2_5.data.activities.filter((v) => v.result === "COLLECTIBLE").map((v) => v.name),
      );
      collectibleActivities = activityCandidates.filter((item) => collectibleNames.has(item.name));
    }

    const finalKept = [...nonActivityKept, ...collectibleActivities];
    if (finalKept.length === 0) {
      console.log("  → 최종 아이템 없음");
      continue;
    }

    const stage3 = await callWithRetry(
      "3단계 구체화",
      ENRICH_SYSTEM_PROMPT,
      ENRICH_JSON_SCHEMA,
      JSON.stringify({ items: finalKept.map(({ name, evidence, category }) => ({ name, evidence, category })) }),
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
