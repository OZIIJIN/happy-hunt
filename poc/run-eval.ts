/**
 * test-memos.ts의 TEST_CASES(정답 포함)를 여러 로컬 모델로 돌려서
 * 정확도/속도를 비교한다.
 *
 * extract-items.ts와 추출 로직(후보추출 → 분류 → 활동판정 → Final Selector → 구체화)은
 * 동일하게 맞췄다 — 이 파일은 그 위에 "정답과 비교해서 채점 + 모델간 비교"를
 * 추가한 버전이다. 단계별 세부 설계 이유는 extract-items.ts 헤더 주석 참고.
 * FINAL_SELECTOR=off를 주면 Final Selector 없이 baseline 파이프라인으로 돈다.
 *
 * test-memos.ts의 정답 카테고리는 한글(음식/장소/자연/사물/동물/활동)이고 파이프라인의
 * 최종 카테고리는 영어(FOOD/PLACE/...)라 CATEGORY_KO_TO_EN으로 채점 시에만 매핑한다.
 *
 * 데이터셋 500개(test-memos.ts) / 원래 100개(test-memos-100.ts) 중 선택 가능 —
 * TEST_SET=100 환경변수를 주면 100개짜리로 돈다(기존 실험 기록과 바로 비교 가능,
 * 500개는 모델 하나당 몇 시간씩 걸림). 기본값은 500개 전체.
 *
 * 실행 (기본: qwen3:8b, qwen2.5:7b, qwen2.5:3b를 각 50개 케이스로 비교):
 *   node --experimental-strip-types poc/run-eval.ts
 * 모델/케이스 수 직접 지정:
 *   node --experimental-strip-types poc/run-eval.ts qwen3:8b,gemma3:4b 20
 * 원래 100개 데이터셋으로 돌리기:
 *   TEST_SET=100 node --experimental-strip-types poc/run-eval.ts gemma3:4b-it-q8_0 999
 */
import { z } from "zod";
import { TEST_CASES as TEST_CASES_500, type ExpectedItem, type TestCase } from "./test-memos.ts";
import { TEST_CASES as TEST_CASES_100 } from "./test-memos-100.ts";

const DATASET = process.env.TEST_SET === "100" ? TEST_CASES_100 : TEST_CASES_500;

// FINAL_SELECTOR=off를 주면 Final Selector 없이 baseline 파이프라인 그대로 돈다
// (Selector 입력 후보가 그대로 3단계로 넘어감) — baseline 재현/비교용.
const FINAL_SELECTOR_ENABLED = process.env.FINAL_SELECTOR !== "off";

// Final Selector 실험의 비교 기준 — Selector 도입 직전 baseline(100케이스) 수치.
const BASELINE_PRF = { precision: 48.4, recall: 80.2, f1: 60.4 };

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";

// gemma3:4b-it-q8_0가 지금까지 실험으로 확정한 baseline 모델이다 — poc/eval-results.md 참고.
const DEFAULT_MODELS = ["gemma3:4b-it-q8_0"];
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

/** category confusion matrix를 한글로 보기 좋게 찍기 위한 역매핑(평가 코드 전용). */
const CATEGORY_EN_TO_KO: Record<Category, string> = {
  FOOD: "음식",
  PLACE: "장소",
  OBJECT: "사물",
  NATURE: "자연",
  ANIMAL: "동물",
  ACTIVITY: "활동",
  PERSON: "사람",
  EMOTION_REACTION: "감정반응",
  SENSORY: "감각",
  GENERIC: "일반",
  OTHER: "기타",
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

/**
 * 평가 코드 전용 계측값 — 파이프라인(모델 호출/재시도 로직)은 그대로 두고,
 * 호출마다 "성공/실패/재시도" 여부만 옆에서 집계한다.
 */
interface StageCallStats {
  totalCalls: number;
  validCalls: number;
  retries: number;
  finalFailures: number;
}

function newStageCallStats(): StageCallStats {
  return { totalCalls: 0, validCalls: 0, retries: 0, finalFailures: 0 };
}

interface StageCallStatsBundle {
  stage1: StageCallStats;
  stage2: StageCallStats;
  stage25: StageCallStats;
  finalSelector: StageCallStats;
  stage3: StageCallStats;
}

/** 세 단계가 공유하는 "JSON Schema로 유도 + Zod로 검증 + 실패 시 재시도" 루프. */
async function callWithRetry<S extends z.ZodTypeAny>(
  model: string,
  stageLabel: string,
  systemPrompt: string,
  jsonSchema: object,
  userContent: string,
  zodSchema: S,
  callStats: StageCallStats,
): Promise<{ data: z.infer<S>; response: OllamaChatResponse; schemaFailures: number }> {
  let lastRawContent = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    callStats.totalCalls++;
    if (attempt > 1) callStats.retries++;
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
      callStats.validCalls++;
      return { data: parsed.data, response, schemaFailures: attempt - 1 };
    }
  }

  callStats.finalFailures++;
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
// Final Selector — 2단계(ACTIVITY 제외 KEEP 카테고리) + 2.5단계(COLLECTIBLE)를
// 통과한 후보 전체를 한 번에 비교해서, 그 행복 순간을 대표할 수집 아이템만 고른다.
// 1단계는 recall 우선이라 후보를 넓게 뽑고 2단계 KEEP은 대부분 끝까지 살아남아서,
// 원문엔 있지만 주변적인 후보가 최종 결과에 많이 섞인다 — 그걸 줄이는 단계다.
// 새 후보 생성/이름·category·evidence 수정은 하지 않고 id 선택만 시킨다
// (선택된 id로 기존 candidate 객체를 그대로 필터링해서 3단계로 넘긴다).
// ============================================================

interface SelectorCandidate {
  id: number;
  name: string;
  category: Category;
  evidence: string;
}

/**
 * Final Selector 스키마는 입력 후보 id 집합에 따라 달라서 호출마다 만든다.
 * JSON Schema enum으로 입력 id만 고르도록 유도하고, Zod에서 "입력에 없는 id"와
 * "중복 id"를 다시 검증해 invalid output으로 처리한다(→ 재시도).
 */
function finalSelectorSchemas(ids: number[]) {
  const idSet = new Set(ids);
  const jsonSchema = {
    type: "object",
    properties: {
      selected_ids: { type: "array", items: { type: "integer", enum: ids } },
    },
    required: ["selected_ids"],
  };
  const zodSchema = z.object({ selected_ids: z.array(z.number().int()) }).superRefine((value, ctx) => {
    if (new Set(value.selected_ids).size !== value.selected_ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "selected_ids에 중복 id가 있다" });
    }
    const unknownIds = value.selected_ids.filter((id) => !idSet.has(id));
    if (unknownIds.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `입력에 없는 id: ${unknownIds.join(", ")}` });
    }
  });
  return { jsonSchema, zodSchema };
}

const FINAL_SELECTOR_SYSTEM_PROMPT = `너는 사용자의 행복한 순간에서 최종적으로 수집할 아이템을 선택하는 역할이다.

입력에는 원문과 이미 추출·분류된 후보들이 주어진다.

후보를 새로 만들지 말고, 주어진 후보 중 실제 수집 아이템으로 적절한 것만 선택하라.

다음 네 기준을 함께 고려한다.

1. 관련성
- 해당 후보가 이 행복한 순간에서 의미 있는 요소인가?
- 단순히 문장에 등장했을 뿐인 배경이나 주변 요소는 제외한다.

2. 구체성
- 독립적인 아이템으로 표현할 만큼 구체적인가?
- "하루", "곳", "한 잔", "조각"처럼 문맥 없이는 의미가 약한 표현은 제외한다.

3. 근거성
- 원문과 evidence에서 해당 후보가 명확하게 확인되는가?
- 원문의 일부를 잘못 잘라 만들어진 후보는 제외한다.

4. 수집 가치
- 이 아이템을 아이콘으로 받아 나중에 봤을 때 해당 행복한 순간을 떠올리기 좋은가?
- 단순 배경, 상태, 부수 행동보다 그 순간을 대표하는 구체적인 대상이나 경험을 우선한다.

추가 규칙:
- 후보 전체를 서로 비교해서 판단한다.
- 같은 의미를 중복해서 나타내는 후보가 여러 개라면 가장 구체적이고 대표적인 하나만 선택한다.
- 여러 후보가 각각 독립적으로 그 순간을 잘 대표한다면 여러 개를 선택할 수 있다.
- 억지로 하나 이상 선택할 필요는 없다.
- 카테고리가 무엇인지보다 실제 순간을 대표하는지가 더 중요하다.
- 새로운 아이템을 만들지 않고, 입력에 있는 id만 selected_ids로 반환한다.
- 선택할 아이템이 없다면 selected_ids를 빈 배열로 반환한다.
- 반드시 지정된 JSON 형식으로만 응답한다.

예 1:
원문: "베란다에 누워 쏟아지는 유성우를 한참 바라봤다."
후보:
[
  {"id":1,"name":"베란다","category":"PLACE","evidence":"베란다에 누워"},
  {"id":2,"name":"유성우","category":"NATURE","evidence":"쏟아지는 유성우"},
  {"id":3,"name":"유성","category":"NATURE","evidence":"유성우를"}
]
결과: {"selected_ids":[2]}
(유성우가 순간을 가장 잘 대표하며 유성은 중복이고 베란다는 배경에 가깝다.)

예 2:
원문: "주말 장터에서 산 따끈한 꽈배기를 손난로를 쥔 채 호호 불며 먹었다."
후보:
[
  {"id":1,"name":"장터","category":"PLACE","evidence":"주말 장터에서"},
  {"id":2,"name":"꽈배기","category":"FOOD","evidence":"따끈한 꽈배기"},
  {"id":3,"name":"손난로","category":"OBJECT","evidence":"손난로를 쥔 채"}
]
결과: {"selected_ids":[2,3]}
(꽈배기와 손난로는 해당 순간을 기억하게 하는 핵심 요소이고, 장터는 상대적으로 배경 역할이다.)

예 3:
원문: "할아버지가 손수 담그신 수정과에 인절미 한 조각을 곁들였다."
후보:
[
  {"id":1,"name":"수정과","category":"FOOD","evidence":"수정과"},
  {"id":2,"name":"인절미","category":"FOOD","evidence":"인절미"},
  {"id":3,"name":"손수","category":"OBJECT","evidence":"손수"},
  {"id":4,"name":"한 조각","category":"OBJECT","evidence":"한 조각"}
]
결과: {"selected_ids":[1,2]}

예 4:
원문: "출장길에 우연히 들른 작은 문방구에서 어릴 적 추억에 빠졌다."
후보:
[
  {"id":1,"name":"출장","category":"ACTIVITY","evidence":"출장길에"},
  {"id":2,"name":"문방구","category":"PLACE","evidence":"작은 문방구에서"}
]
결과: {"selected_ids":[2]}
(문방구 자체가 이 행복한 순간의 핵심 경험이므로 PLACE라도 선택한다.)`;

// ============================================================
// 3단계 — Item Enrichment: 2단계(ACTIVITY 제외 KEEP 카테고리) + 2.5단계
// (COLLECTIBLE로 판정된 ACTIVITY)를 통과한 최종 아이템만 구체화한다.
// (Final Selector가 켜져 있으면 그중 Selector가 선택한 후보만 들어온다.)
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

/** 평가 코드 전용 — 단계별 소요시간(ms). 2.5단계/Final Selector를 안 돌린 케이스는 0. */
interface StageTiming {
  stage1: number;
  stage2: number;
  stage25: number;
  finalSelector: number;
  stage3: number;
  total: number;
}

/** 평가 코드 전용 — 2.5단계에 들어간 ACTIVITY 후보별 판정 기록. */
interface ActivityVerdictRecord {
  name: string;
  category: Category;
  result: "COLLECTIBLE" | "NOT_COLLECTIBLE";
}

interface PipelineResult {
  items: FinalItem[];
  schemaFailures: number;
  totalPromptTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  // 아래는 평가 코드가 단계별 지표(Candidate Recall/Category Accuracy/
  // Collectibility/Latency)를 계산하기 위해 추가로 기록하는 중간 산출물이다.
  // 파이프라인이 실제로 만들어내는 값을 그대로 노출할 뿐, 후처리로 보정하지 않는다.
  candidates: { name: string; evidence: string }[];
  classified: { name: string; evidence: string; category: Category }[];
  activityVerdicts: ActivityVerdictRecord[];
  // Final Selector에 들어간 후보(id 부여)와 선택된 id. Selector가 꺼져 있으면
  // 입력 전체가 선택된 것으로 기록한다.
  selectorInput: SelectorCandidate[];
  selectedIds: number[];
  timing: StageTiming;
  failedStage: "1단계" | "2단계" | "2.5단계" | "Final Selector" | "3단계" | null;
}

/**
 * 1단계(후보추출) → 2단계(분류) → 2.5단계(활동 판정) → Final Selector(최종 선택)
 * → 3단계(구체화)를 순서대로 실행한다.
 */
async function extractPipeline(
  model: string,
  memo: string,
  callStats: StageCallStatsBundle,
): Promise<PipelineResult> {
  const result: PipelineResult = {
    items: [],
    schemaFailures: 0,
    totalPromptTokens: 0,
    totalOutputTokens: 0,
    totalDurationMs: 0,
    candidates: [],
    classified: [],
    activityVerdicts: [],
    selectorInput: [],
    selectedIds: [],
    timing: { stage1: 0, stage2: 0, stage25: 0, finalSelector: 0, stage3: 0, total: 0 },
    failedStage: null,
  };
  const track = (response: OllamaChatResponse, schemaFailures: number) => {
    result.schemaFailures += schemaFailures;
    result.totalPromptTokens += response.prompt_eval_count ?? 0;
    result.totalOutputTokens += response.eval_count ?? 0;
    result.totalDurationMs += (response.total_duration ?? 0) / 1_000_000;
  };

  const t1 = Date.now();
  let stage1: Awaited<ReturnType<typeof callWithRetry<typeof CandidateResult>>>;
  try {
    stage1 = await callWithRetry(
      model,
      "1단계",
      CANDIDATE_SYSTEM_PROMPT,
      CANDIDATE_JSON_SCHEMA,
      memo,
      CandidateResult,
      callStats.stage1,
    );
  } catch {
    result.timing.stage1 = Date.now() - t1;
    result.timing.total = result.timing.stage1;
    result.failedStage = "1단계";
    return result;
  }
  result.timing.stage1 = Date.now() - t1;
  track(stage1.response, stage1.schemaFailures);
  result.candidates = stage1.data.candidates;

  if (stage1.data.candidates.length === 0) {
    result.timing.total = result.timing.stage1;
    return result;
  }

  const t2 = Date.now();
  let stage2: Awaited<ReturnType<typeof callWithRetry<typeof ClassifyResult>>>;
  try {
    stage2 = await callWithRetry(
      model,
      "2단계",
      CLASSIFY_SYSTEM_PROMPT,
      CLASSIFY_JSON_SCHEMA,
      JSON.stringify({ candidates: stage1.data.candidates }),
      ClassifyResult,
      callStats.stage2,
    );
  } catch {
    result.timing.stage2 = Date.now() - t2;
    result.timing.total = result.timing.stage1 + result.timing.stage2;
    result.failedStage = "2단계";
    return result;
  }
  result.timing.stage2 = Date.now() - t2;
  track(stage2.response, stage2.schemaFailures);
  result.classified = stage2.data.items;

  const kept = stage2.data.items.filter((item) => KEEP_CATEGORIES.has(item.category));
  const activityCandidates = kept.filter((item) => item.category === "ACTIVITY");
  const nonActivityKept = kept.filter((item) => item.category !== "ACTIVITY");

  let collectibleActivities: typeof activityCandidates = [];
  if (activityCandidates.length > 0) {
    const t25 = Date.now();
    let stage2_5: Awaited<ReturnType<typeof callWithRetry<typeof ActivityFilterResult>>>;
    try {
      stage2_5 = await callWithRetry(
        model,
        "2.5단계",
        ACTIVITY_FILTER_SYSTEM_PROMPT,
        ACTIVITY_FILTER_JSON_SCHEMA,
        JSON.stringify({
          memo,
          activities: activityCandidates.map(({ name, evidence }) => ({ name, evidence })),
        }),
        ActivityFilterResult,
        callStats.stage25,
      );
    } catch {
      result.timing.stage25 = Date.now() - t25;
      result.timing.total = result.timing.stage1 + result.timing.stage2 + result.timing.stage25;
      result.failedStage = "2.5단계";
      return result;
    }
    result.timing.stage25 = Date.now() - t25;
    track(stage2_5.response, stage2_5.schemaFailures);
    result.activityVerdicts = activityCandidates.map((item) => ({
      name: item.name,
      category: item.category,
      result: stage2_5.data.activities.find((v) => v.name === item.name)?.result ?? "NOT_COLLECTIBLE",
    }));
    const collectibleNames = new Set(
      stage2_5.data.activities.filter((v) => v.result === "COLLECTIBLE").map((v) => v.name),
    );
    collectibleActivities = activityCandidates.filter((item) => collectibleNames.has(item.name));
  }

  const finalKept = [...nonActivityKept, ...collectibleActivities];
  if (finalKept.length === 0) {
    result.timing.total = result.timing.stage1 + result.timing.stage2 + result.timing.stage25;
    return result;
  }

  result.selectorInput = finalKept.map(({ name, category, evidence }, i) => ({ id: i + 1, name, category, evidence }));
  let selected = result.selectorInput;
  if (FINAL_SELECTOR_ENABLED) {
    const { jsonSchema, zodSchema } = finalSelectorSchemas(result.selectorInput.map((c) => c.id));
    const tfs = Date.now();
    let finalSelector: Awaited<ReturnType<typeof callWithRetry<typeof zodSchema>>>;
    try {
      finalSelector = await callWithRetry(
        model,
        "Final Selector",
        FINAL_SELECTOR_SYSTEM_PROMPT,
        jsonSchema,
        JSON.stringify({ original_text: memo, candidates: result.selectorInput }),
        zodSchema,
        callStats.finalSelector,
      );
    } catch {
      result.timing.finalSelector = Date.now() - tfs;
      result.timing.total =
        result.timing.stage1 + result.timing.stage2 + result.timing.stage25 + result.timing.finalSelector;
      result.failedStage = "Final Selector";
      return result;
    }
    result.timing.finalSelector = Date.now() - tfs;
    track(finalSelector.response, finalSelector.schemaFailures);
    const selectedIdSet = new Set(finalSelector.data.selected_ids);
    selected = result.selectorInput.filter((c) => selectedIdSet.has(c.id));
  }
  result.selectedIds = selected.map((c) => c.id);
  if (selected.length === 0) {
    result.timing.total =
      result.timing.stage1 + result.timing.stage2 + result.timing.stage25 + result.timing.finalSelector;
    return result;
  }

  const t3 = Date.now();
  let stage3: Awaited<ReturnType<typeof callWithRetry<typeof EnrichResult>>>;
  try {
    stage3 = await callWithRetry(
      model,
      "3단계",
      ENRICH_SYSTEM_PROMPT,
      ENRICH_JSON_SCHEMA,
      JSON.stringify({ items: selected.map(({ name, evidence, category }) => ({ name, evidence, category })) }),
      EnrichResult,
      callStats.stage3,
    );
  } catch {
    result.timing.stage3 = Date.now() - t3;
    result.timing.total =
      result.timing.stage1 +
      result.timing.stage2 +
      result.timing.stage25 +
      result.timing.finalSelector +
      result.timing.stage3;
    result.failedStage = "3단계";
    return result;
  }
  result.timing.stage3 = Date.now() - t3;
  track(stage3.response, stage3.schemaFailures);

  result.items = stage3.data.items;
  result.timing.total =
    result.timing.stage1 +
    result.timing.stage2 +
    result.timing.stage25 +
    result.timing.finalSelector +
    result.timing.stage3;
  return result;
}

/** 이름 부분 포함(양방향) — 모든 단계 평가에서 공통으로 쓰는 이름 매칭 규칙. */
function namesOverlap(a: string, b: string): boolean {
  return a.includes(b) || b.includes(a);
}

/** expected.name 또는 expected.aliases 중 하나라도 겹치면 매치로 본다. */
function matchesExpectedName(actualName: string, expected: ExpectedItem): boolean {
  const names = [expected.name, ...(expected.aliases ?? [])];
  return names.some((n) => namesOverlap(actualName, n));
}

/** 정답 하나가 실제 추출 결과에 있는지: 카테고리 일치(한글→영어 매핑) + 이름 매칭(위 공통 규칙). */
function isMatched(expected: ExpectedItem, actual: { name: string; category: string }[]) {
  const expectedCategory = CATEGORY_KO_TO_EN[expected.category] ?? expected.category;
  return actual.some((a) => a.category === expectedCategory && matchesExpectedName(a.name, expected));
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function percentile(nums: number[], p: number): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
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
  failures: { memo: string; expected: ExpectedItem[]; actual: string[]; selectorDropped?: string[] }[];

  // --- 아래부터 확장 지표 (기존 지표는 위에서 그대로 유지) ---

  // Precision/Recall/F1 (micro, 최종 아이템 vs expected)
  tp: number;
  fp: number;
  fn: number;

  // 1단계 Candidate Recall
  candidateRecallHits: number;
  candidateRecallTotal: number;
  candidateRecallMisses: { memo: string; name: string; category: string }[];

  // 2단계 Category Accuracy (1단계에서 발견된 expected candidate만 대상)
  categoryCorrect: number;
  categoryTotal: number;
  categoryConfusion: Map<string, number>;

  // 2.5단계 Collectibility
  collectTp: number;
  collectTn: number;
  collectFp: number;
  collectFn: number;

  // 엣지케이스 실패 상세(최종 출력 아이템 포함)
  failedEdgeCases: { memo: string; actual: string[] }[];

  // Final Selector — 에러 없이 끝난 케이스 기준. 입력이 0개라 Selector를 안 돌린
  // 케이스도 "케이스당 평균"의 분모에는 포함한다.
  selectorEvaluatedCases: number;
  selectorRanCases: number;
  selectorInputTotal: number;
  selectorSelectedTotal: number;
  // 매칭은 최종 채점과 같은 규칙(category 일치 + 이름 매칭)을 쓴다.
  selectorExpectedInInput: number;
  selectorExpectedPreserved: number;
  selectorNonExpectedInInput: number;
  selectorNonExpectedRemoved: number;
  selectorDroppedExpected: { memo: string; expected: string; candidates: string[] }[];
  // 같은 실행에서 Selector 입력을 그대로 최종 결과로 봤을 때의 TP/FP/FN —
  // "Selector 미적용" 가정치(3단계는 name/category를 바꾸지 않으므로 baseline에 대응).
  preSelectorTp: number;
  preSelectorFp: number;
  preSelectorFn: number;
  // 엣지케이스 중 Selector 입력엔 후보가 있었는데 Selector가 전부 제거한 케이스 수
  edgeCasesClearedBySelector: number;

  // 단계별 schema validation 호출 통계
  stageCallStats: StageCallStatsBundle;

  // 단계별 소요시간(ms) 분포 — 케이스마다 하나씩 push (2.5단계/Final Selector 미실행 시 0)
  latencies: {
    stage1: number[];
    stage2: number[];
    stage25: number[];
    finalSelector: number[];
    stage3: number[];
    total: number[];
  };
}

/** 최종 채점과 같은 규칙: category 일치(한글→영어 매핑) + 이름 매칭. */
function matchesExpectedItem(actual: { name: string; category: string }, expected: ExpectedItem): boolean {
  const expectedCategory = CATEGORY_KO_TO_EN[expected.category] ?? expected.category;
  return actual.category === expectedCategory && matchesExpectedName(actual.name, expected);
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
    tp: 0,
    fp: 0,
    fn: 0,
    candidateRecallHits: 0,
    candidateRecallTotal: 0,
    candidateRecallMisses: [],
    categoryCorrect: 0,
    categoryTotal: 0,
    categoryConfusion: new Map(),
    collectTp: 0,
    collectTn: 0,
    collectFp: 0,
    collectFn: 0,
    failedEdgeCases: [],
    selectorEvaluatedCases: 0,
    selectorRanCases: 0,
    selectorInputTotal: 0,
    selectorSelectedTotal: 0,
    selectorExpectedInInput: 0,
    selectorExpectedPreserved: 0,
    selectorNonExpectedInInput: 0,
    selectorNonExpectedRemoved: 0,
    selectorDroppedExpected: [],
    preSelectorTp: 0,
    preSelectorFp: 0,
    preSelectorFn: 0,
    edgeCasesClearedBySelector: 0,
    stageCallStats: {
      stage1: newStageCallStats(),
      stage2: newStageCallStats(),
      stage25: newStageCallStats(),
      finalSelector: newStageCallStats(),
      stage3: newStageCallStats(),
    },
    latencies: { stage1: [], stage2: [], stage25: [], finalSelector: [], stage3: [], total: [] },
  };

  for (const [i, testCase] of cases.entries()) {
    process.stdout.write(`  [${model}] [${i + 1}/${cases.length}] `);

    const result = await extractPipeline(model, testCase.memo, stats.stageCallStats);
    printCaseTrace(testCase.memo, result);

    // 레이턴시는 실행된(혹은 실패로 중단된) 단계까지 그대로 기록한다 — 실행 안 된
    // 단계는 extractPipeline이 이미 0으로 초기화해둔다.
    stats.latencies.stage1.push(result.timing.stage1);
    stats.latencies.stage2.push(result.timing.stage2);
    stats.latencies.stage25.push(result.timing.stage25);
    stats.latencies.finalSelector.push(result.timing.finalSelector);
    stats.latencies.stage3.push(result.timing.stage3);
    stats.latencies.total.push(result.timing.total);

    if (result.failedStage) {
      stats.errorCount++;
      console.log(`에러: ${result.failedStage} ${MAX_ATTEMPTS}회 모두 실패`);
      stats.failures.push({ memo: testCase.memo, expected: testCase.expected, actual: ["(에러 발생)"] });
      // 기존 동작과 동일하게, 에러 케이스는 Final Match Rate/엣지케이스/기타 지표
      // 분모에서 전부 제외한다(실행이 끝까지 안 됐으니 "같은 실행 결과"가 아님).
      continue;
    }

    stats.schemaFailures += result.schemaFailures;
    stats.totalPromptTokens += result.totalPromptTokens;
    stats.totalOutputTokens += result.totalOutputTokens;
    stats.totalDurationMs += result.totalDurationMs;

    const items = result.items;

    // ---- 1단계 Candidate Recall + 2단계 Category Accuracy ----
    // (1단계에서 못 찾은 expected item은 2단계 평가 대상에서 제외한다.)
    for (const exp of testCase.expected) {
      stats.candidateRecallTotal++;
      const found = result.candidates.some((c) => matchesExpectedName(c.name, exp));
      if (!found) {
        stats.candidateRecallMisses.push({ memo: testCase.memo, name: exp.name, category: exp.category });
        continue;
      }
      stats.candidateRecallHits++;

      stats.categoryTotal++;
      const expectedCategoryEn = CATEGORY_KO_TO_EN[exp.category] ?? exp.category;
      const classifiedHits = result.classified.filter((c) => matchesExpectedName(c.name, exp));
      const correctHit = classifiedHits.find((c) => c.category === expectedCategoryEn);
      if (correctHit) {
        stats.categoryCorrect++;
      } else if (classifiedHits.length > 0) {
        const confusionKey = `${exp.category} → ${CATEGORY_EN_TO_KO[classifiedHits[0].category]}`;
        stats.categoryConfusion.set(confusionKey, (stats.categoryConfusion.get(confusionKey) ?? 0) + 1);
      }
    }

    // ---- 2.5단계 Collectibility (ACTIVITY로 분류되어 2.5단계에 들어간 후보만) ----
    for (const v of result.activityVerdicts) {
      const matchesExpectedActivity = testCase.expected.some(
        (exp) => exp.category === "활동" && matchesExpectedName(v.name, exp),
      );
      if (matchesExpectedActivity) {
        if (v.result === "COLLECTIBLE") stats.collectTp++;
        else stats.collectFn++;
      } else if (v.result === "NOT_COLLECTIBLE") {
        stats.collectTn++;
      } else {
        stats.collectFp++;
      }
    }

    // ---- Final Selector (Selector 입력 vs 선택 결과) ----
    const selectedIdSet = new Set(result.selectedIds);
    const selectedCandidates = result.selectorInput.filter((c) => selectedIdSet.has(c.id));
    stats.selectorEvaluatedCases++;
    if (result.selectorInput.length > 0) stats.selectorRanCases++;
    stats.selectorInputTotal += result.selectorInput.length;
    stats.selectorSelectedTotal += selectedCandidates.length;
    const selectorDropped: string[] = [];
    for (const exp of testCase.expected) {
      const inInput = result.selectorInput.filter((c) => matchesExpectedItem(c, exp));
      if (inInput.length === 0) {
        stats.preSelectorFn++;
        continue;
      }
      stats.preSelectorTp++;
      stats.selectorExpectedInInput++;
      if (selectedCandidates.some((c) => matchesExpectedItem(c, exp))) {
        stats.selectorExpectedPreserved++;
      } else {
        const expStr = `${exp.name}(${exp.category})`;
        selectorDropped.push(expStr);
        stats.selectorDroppedExpected.push({
          memo: testCase.memo,
          expected: expStr,
          candidates: inInput.map((c) => `#${c.id} ${c.name}(${c.category})`),
        });
      }
    }
    for (const c of result.selectorInput) {
      if (testCase.expected.some((exp) => matchesExpectedItem(c, exp))) continue;
      stats.preSelectorFp++;
      stats.selectorNonExpectedInInput++;
      if (!selectedIdSet.has(c.id)) stats.selectorNonExpectedRemoved++;
    }

    // ---- 엣지케이스 (기존 로직 그대로) + Precision/Recall용 FP ----
    if (testCase.expected.length === 0) {
      stats.edgeCaseTotal++;
      const pass = items.length === 0;
      if (pass) stats.edgeCasePassed++;
      if (result.selectorInput.length > 0 && selectedCandidates.length === 0) stats.edgeCasesClearedBySelector++;
      console.log(pass ? "    평가 결과: 엣지케이스 통과" : `    평가 결과: 엣지케이스 실패 (${items.length}개)`);
      stats.fp += items.length; // expected가 없으니 나온 아이템은 전부 FP
      if (!pass) {
        const actualStrs = items.map((it) => `${it.name}(${it.category})`);
        stats.failedEdgeCases.push({ memo: testCase.memo, actual: actualStrs });
        stats.failures.push({ memo: testCase.memo, expected: [], actual: actualStrs });
      }
      continue;
    }

    // ---- 기존 Final Match Rate (그대로) + TP/FN/FP ----
    stats.totalExpected += testCase.expected.length;
    let caseMatched = 0;
    for (const exp of testCase.expected) {
      if (isMatched(exp, items)) {
        stats.matchedCount++;
        caseMatched++;
        stats.tp++;
      } else {
        stats.fn++;
      }
    }
    for (const it of items) {
      const matchesSomeExpected = testCase.expected.some(
        (exp) =>
          it.category === (CATEGORY_KO_TO_EN[exp.category] ?? exp.category) && matchesExpectedName(it.name, exp),
      );
      if (!matchesSomeExpected) stats.fp++;
    }

    const pass = caseMatched === testCase.expected.length;
    const verdict = pass ? "통과" : caseMatched > 0 ? "부분" : "실패";
    console.log(`    평가 결과: ${verdict} (${caseMatched}/${testCase.expected.length})`);
    if (!pass) {
      stats.failures.push({
        memo: testCase.memo,
        expected: testCase.expected,
        actual: items.map((it) => `${it.name}(${it.category})`),
        selectorDropped,
      });
    }
  }

  return stats;
}

/** 케이스 하나의 단계별 원본 출력을 전부 찍는다(통과/실패 무관, 평가 코드 전용 로깅). */
function printCaseTrace(memo: string, result: PipelineResult) {
  console.log(`\n  메모: "${memo}"`);
  console.log(`    1단계 candidates: ${JSON.stringify(result.candidates)}`);
  console.log(`    2단계 classified: ${JSON.stringify(result.classified)}`);
  if (result.activityVerdicts.length > 0) {
    console.log(`    2.5단계 activityVerdicts: ${JSON.stringify(result.activityVerdicts)}`);
  }
  if (result.selectorInput.length > 0) {
    console.log(`    Final Selector 입력: ${JSON.stringify(result.selectorInput)}`);
    if (result.failedStage !== "Final Selector") {
      const selectedIdSet = new Set(result.selectedIds);
      const brief = ({ id, name, category }: SelectorCandidate) => ({ id, name, category });
      const selectedBrief = result.selectorInput.filter((c) => selectedIdSet.has(c.id)).map(brief);
      const removedBrief = result.selectorInput.filter((c) => !selectedIdSet.has(c.id)).map(brief);
      console.log(`    Final Selector 선택: ${JSON.stringify(selectedBrief)}`);
      console.log(`    Final Selector 제거: ${JSON.stringify(removedBrief)}`);
    }
  }
  console.log(`    3단계 최종 items: ${JSON.stringify(result.items)}`);
  if (result.failedStage) {
    console.log(`    (주의: ${result.failedStage}에서 schema validation 최종 실패, 이후 단계 미실행)`);
  }
}

function printModelReport(stats: ModelStats) {
  console.log(`\n--- ${stats.model} 실패/부분 실패 케이스 ---`);
  for (const f of stats.failures) {
    console.log(`- "${f.memo}"`);
    console.log(`    정답: ${f.expected.map((e) => `${e.name}(${e.category})`).join(", ") || "(없음)"}`);
    console.log(`    실제: ${f.actual.join(", ") || "(없음)"}`);
    if (f.selectorDropped && f.selectorDropped.length > 0) {
      console.log(`    Selector가 제거한 정답: ${f.selectorDropped.join(", ")}`);
    }
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

/**
 * 기존 Final Match Rate/엣지케이스 통과율 외에 추가로 수집한 확장 지표를 출력한다.
 * Precision/Recall/F1, 단계별 Candidate Recall/Category Accuracy/Collectibility,
 * schema validation 통계, 단계별 레이턴시 분포.
 */
function printExtendedMetrics(stats: ModelStats) {
  console.log(`\n=== ${stats.model} 확장 평가 지표 ===`);

  const precision = stats.tp + stats.fp > 0 ? stats.tp / (stats.tp + stats.fp) : 0;
  const recall = stats.tp + stats.fn > 0 ? stats.tp / (stats.tp + stats.fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  console.log(`\n[Precision / Recall / F1] (micro-average, 전체 케이스 TP/FP/FN 합산)`);
  console.log(`  TP=${stats.tp}  FP=${stats.fp}  FN=${stats.fn}`);
  console.log(
    `  Precision=${(precision * 100).toFixed(1)}%  Recall=${(recall * 100).toFixed(1)}%  F1=${(f1 * 100).toFixed(1)}%`,
  );

  const candidateRecallPct = stats.candidateRecallTotal
    ? (stats.candidateRecallHits / stats.candidateRecallTotal) * 100
    : 0;
  console.log(`\n[1단계 Candidate Recall]`);
  console.log(
    `  ${stats.candidateRecallHits}/${stats.candidateRecallTotal} (${candidateRecallPct.toFixed(1)}%), ` +
      `누락 ${stats.candidateRecallMisses.length}건`,
  );
  for (const m of stats.candidateRecallMisses) {
    console.log(`    - "${m.memo}" → 정답 "${m.name}(${m.category})" 후보에 없음`);
  }

  const categoryAccuracyPct = stats.categoryTotal ? (stats.categoryCorrect / stats.categoryTotal) * 100 : 0;
  console.log(`\n[2단계 Category Accuracy] (1단계에서 발견된 expected candidate만 대상)`);
  console.log(`  ${stats.categoryCorrect}/${stats.categoryTotal} (${categoryAccuracyPct.toFixed(1)}%)`);
  if (stats.categoryConfusion.size > 0) {
    console.log("  category confusion:");
    const sorted = [...stats.categoryConfusion.entries()].sort((a, b) => b[1] - a[1]);
    for (const [pair, count] of sorted) {
      console.log(`    - ${pair}: ${count}`);
    }
  }

  const collectTotal = stats.collectTp + stats.collectTn + stats.collectFp + stats.collectFn;
  const collectAccuracyPct = collectTotal ? ((stats.collectTp + stats.collectTn) / collectTotal) * 100 : 0;
  console.log(`\n[2.5단계 Collectibility] (ACTIVITY로 분류되어 2.5단계에 들어간 후보만 대상)`);
  console.log(
    `  TP=${stats.collectTp}  TN=${stats.collectTn}  FP=${stats.collectFp}  FN=${stats.collectFn}  ` +
      `accuracy=${collectAccuracyPct.toFixed(1)}%`,
  );

  console.log(`\n[엣지케이스 실패 상세] ${stats.failedEdgeCases.length}건`);
  for (const f of stats.failedEdgeCases) {
    console.log(`  - "${f.memo}" → ${f.actual.join(", ") || "(없음)"}`);
  }

  const pct = (num: number, den: number) => (den ? `${((num / den) * 100).toFixed(1)}%` : "-");
  console.log(`\n[Final Selector] ${FINAL_SELECTOR_ENABLED ? "" : "(FINAL_SELECTOR=off — 입력 전체를 그대로 통과시킴)"}`);
  console.log(
    `  Avg Selector Input Items / Case: ${(stats.selectorInputTotal / (stats.selectorEvaluatedCases || 1)).toFixed(2)} ` +
      `(${stats.selectorInputTotal}개 / ${stats.selectorEvaluatedCases}케이스, Selector 실행 ${stats.selectorRanCases}케이스) ` +
      `— Selector 미적용 시 최종 아이템 수에 해당`,
  );
  console.log(
    `  Avg Selected Items / Case:       ${(stats.selectorSelectedTotal / (stats.selectorEvaluatedCases || 1)).toFixed(2)} ` +
      `(${stats.selectorSelectedTotal}개)`,
  );
  console.log(
    `  Selector Input / Selected / Removed Count: ${stats.selectorInputTotal} / ${stats.selectorSelectedTotal} / ` +
      `${stats.selectorInputTotal - stats.selectorSelectedTotal}`,
  );
  console.log(
    `  Selector Keep Rate:              ${stats.selectorSelectedTotal}/${stats.selectorInputTotal} ` +
      `(${pct(stats.selectorSelectedTotal, stats.selectorInputTotal)})`,
  );
  console.log(
    `  Expected Item Preservation Rate: ${stats.selectorExpectedPreserved}/${stats.selectorExpectedInInput} ` +
      `(${pct(stats.selectorExpectedPreserved, stats.selectorExpectedInInput)})`,
  );
  console.log(
    `  Non-expected Removal Rate:       ${stats.selectorNonExpectedRemoved}/${stats.selectorNonExpectedInInput} ` +
      `(${pct(stats.selectorNonExpectedRemoved, stats.selectorNonExpectedInInput)})`,
  );
  console.log(
    `  엣지케이스 중 Selector가 후보를 전부 제거한 케이스: ${stats.edgeCasesClearedBySelector}/${stats.edgeCaseTotal}`,
  );
  const { preSelectorTp: preTp, preSelectorFp: preFp, preSelectorFn: preFn } = stats;
  const prePrecision = preTp + preFp > 0 ? preTp / (preTp + preFp) : 0;
  const preRecall = preTp + preFn > 0 ? preTp / (preTp + preFn) : 0;
  const preF1 = prePrecision + preRecall ? (2 * prePrecision * preRecall) / (prePrecision + preRecall) : 0;
  console.log(
    `  Selector 미적용 가정(같은 실행의 Selector 입력 기준): TP=${stats.preSelectorTp}  FP=${stats.preSelectorFp}  ` +
      `FN=${stats.preSelectorFn}  Precision=${(prePrecision * 100).toFixed(1)}%  Recall=${(preRecall * 100).toFixed(1)}%  ` +
      `F1=${(preF1 * 100).toFixed(1)}%`,
  );
  console.log(
    `  Selector 적용 최종:                                  Precision=${(precision * 100).toFixed(1)}%  ` +
      `Recall=${(recall * 100).toFixed(1)}%  F1=${(f1 * 100).toFixed(1)}%`,
  );
  console.log(
    `  기록된 baseline:                                     Precision=${BASELINE_PRF.precision}%  ` +
      `Recall=${BASELINE_PRF.recall}%  F1=${BASELINE_PRF.f1}%`,
  );
  console.log(`  Selector가 제거한 정답 ${stats.selectorDroppedExpected.length}건:`);
  for (const d of stats.selectorDroppedExpected) {
    console.log(`    - "${d.memo}" → 정답 "${d.expected}" (제거된 후보: ${d.candidates.join(", ")})`);
  }

  const { stage1, stage2, stage25, finalSelector, stage3 } = stats.stageCallStats;
  const validRate = (s: StageCallStats) => (s.totalCalls ? (s.validCalls / s.totalCalls) * 100 : 0);
  console.log(`\n[Schema Validation]`);
  console.log(`  stage1 schema valid rate:   ${stage1.validCalls}/${stage1.totalCalls} (${validRate(stage1).toFixed(1)}%)`);
  console.log(`  stage2 schema valid rate:   ${stage2.validCalls}/${stage2.totalCalls} (${validRate(stage2).toFixed(1)}%)`);
  console.log(`  stage2.5 schema valid rate: ${stage25.validCalls}/${stage25.totalCalls} (${validRate(stage25).toFixed(1)}%)`);
  console.log(
    `  finalSelector schema valid rate: ${finalSelector.validCalls}/${finalSelector.totalCalls} ` +
      `(${validRate(finalSelector).toFixed(1)}%)  retry count: ${finalSelector.retries}  ` +
      `final failure count: ${finalSelector.finalFailures}`,
  );
  console.log(`  stage3 schema valid rate:   ${stage3.validCalls}/${stage3.totalCalls} (${validRate(stage3).toFixed(1)}%)`);
  const totalCalls =
    stage1.totalCalls + stage2.totalCalls + stage25.totalCalls + finalSelector.totalCalls + stage3.totalCalls;
  const totalValid =
    stage1.validCalls + stage2.validCalls + stage25.validCalls + finalSelector.validCalls + stage3.validCalls;
  const totalRetries = stage1.retries + stage2.retries + stage25.retries + finalSelector.retries + stage3.retries;
  const totalFinalFailures =
    stage1.finalFailures +
    stage2.finalFailures +
    stage25.finalFailures +
    finalSelector.finalFailures +
    stage3.finalFailures;
  console.log(
    `  전체 호출 수: ${totalCalls}  schema validation 실패 수: ${totalCalls - totalValid}  ` +
      `retry 수: ${totalRetries}  최종 실패 수: ${totalFinalFailures}`,
  );

  const summarize = (nums: number[]) => ({
    avg: avg(nums),
    p50: percentile(nums, 50),
    p95: percentile(nums, 95),
    max: nums.length ? Math.max(...nums) : 0,
  });
  const l1 = summarize(stats.latencies.stage1);
  const l2 = summarize(stats.latencies.stage2);
  const l25 = summarize(stats.latencies.stage25);
  const lfs = summarize(stats.latencies.finalSelector);
  const l3 = summarize(stats.latencies.stage3);
  const lTotal = summarize(stats.latencies.total);
  console.log(`\n[Latency (ms)]`);
  console.log(`  Stage1   avg=${l1.avg.toFixed(0)}  p50=${l1.p50}  p95=${l1.p95}  max=${l1.max}`);
  console.log(`  Stage2   avg=${l2.avg.toFixed(0)}  p50=${l2.p50}  p95=${l2.p95}  max=${l2.max}`);
  console.log(`  Stage2.5 avg=${l25.avg.toFixed(0)}  p50=${l25.p50}  p95=${l25.p95}  max=${l25.max}`);
  console.log(`  FinalSelector avg=${lfs.avg.toFixed(0)}  p50=${lfs.p50}  p95=${lfs.p95}  max=${lfs.max}`);
  console.log(`  Stage3   avg=${l3.avg.toFixed(0)}  p50=${l3.p50}  p95=${l3.p95}  max=${l3.max}`);
  console.log(`  Total    avg=${lTotal.avg.toFixed(0)}  p50=${lTotal.p50}  p95=${lTotal.p95}  max=${lTotal.max}`);
}

async function main() {
  const models = process.argv[2] ? process.argv[2].split(",") : DEFAULT_MODELS;
  const limit = process.argv[3] ? Number(process.argv[3]) : DEFAULT_LIMIT;
  const cases = DATASET.slice(0, limit);

  console.log(
    `모델 ${models.length}개 x 케이스 ${cases.length}개 비교 시작 (데이터셋: ${DATASET.length}개): ${models.join(", ")}`,
  );
  console.log(`Final Selector: ${FINAL_SELECTOR_ENABLED ? "on" : "off (baseline)"}`);

  const allStats: ModelStats[] = [];
  for (const model of models) {
    console.log(`\n### ${model} 시작 ###`);
    const stats = await runEval(model, cases);
    allStats.push(stats);
    printModelReport(stats);
    printExtendedMetrics(stats);
    await unloadModel(model);
  }

  printComparisonTable(allStats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
