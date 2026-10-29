# 아이템 추출 파이프라인 (POC, v0.5.2 기준)

`poc/extract-items.ts`의 현재 흐름을 정리한다. 평가 스크립트 `poc/run-eval.ts`도 같은 파이프라인을 그대로 복제해서 돈다.
모델은 로컬 Ollama다.
- `extract-items.ts` 기본값은 `gemma3:4b`이고, `OLLAMA_MODEL`로 바꿀 수 있다.
- 평가 실험은 `gemma3:4b-it-q8_0`으로 돌렸다.

모든 LLM 단계는 같은 `callWithRetry` 루프를 쓴다.

## 1. 전체 흐름

```mermaid
flowchart TD
    MEMO["행복 메모 (원문)"] --> S1

    S1["1단계 후보 추출 (recall 중심)<br/>필터링 없이 최대한 빠짐없이 뽑는다"]
    S1 -->|"candidates: {name, evidence}[]"| C1{"후보가 있나?"}
    C1 -->|없음| NONE["최종 아이템 없음"]
    C1 -->|있음| S2

    S2["2단계 분류 (ontology만)<br/>후보마다 category 1개 부여"]
    S2 -->|"items: {name, evidence, category}[]"| KEEP{"code: KEEP_CATEGORIES?<br/>FOOD / PLACE / OBJECT /<br/>NATURE / ANIMAL / ACTIVITY"}
    KEEP -->|"PERSON / EMOTION_REACTION /<br/>SENSORY / GENERIC / OTHER"| DROP2["제외"]
    KEEP -->|ACTIVITY| S25
    KEEP -->|"ACTIVITY 외 KEEP"| MERGE

    S25["2.5단계 ACTIVITY 수집 가치 판정 (제품 정책)<br/>원문 + 활동 후보"]
    S25 -->|COLLECTIBLE| MERGE
    S25 -->|NOT_COLLECTIBLE| DROP25["제외"]

    MERGE["finalKept = 비활동 KEEP + COLLECTIBLE 활동"] --> C2{"남은 후보가 있나?"}
    C2 -->|없음| NONE
    C2 -->|있음| ID["code: id 부여 (1..n)<br/>{id, name, category, evidence}"]

    ID --> FS["Final Selector<br/>원문 + 후보 전체를 보고<br/>명백히 불필요한 후보만 제거"]
    FS -->|"selected_ids: number[]"| FILTER["code: 선택된 id로 원본 후보 필터링<br/>(name/category/evidence 수정 없음)"]
    FILTER --> C3{"선택된 후보가 있나?"}
    C3 -->|없음| NONE
    C3 -->|있음| S3

    S3["3단계 구체화 (enrichment)<br/>생존 여부는 다시 판단하지 않음"]
    S3 -->|"items: {name, evidence, category,<br/>visual_description, uniqueness}[]"| OUT["최종 아이템<br/>→ (향후) 아이콘 생성 · 보관함 지급"]

    classDef llm fill:#e8f0fe,stroke:#4a6fd1,color:#1a2b5c;
    classDef code fill:#f1f3f4,stroke:#80868b,color:#202124;
    classDef drop fill:#fce8e6,stroke:#d93025,color:#5c1a14;
    class S1,S2,S25,FS,S3 llm;
    class KEEP,MERGE,ID,FILTER,C1,C2,C3 code;
    class DROP2,DROP25,NONE drop;
```

- 파란색: LLM 호출. 회색: 코드 판정. 빨간색: 제외/종료.
- 각 단계의 책임
  - **1단계**: 모든 후보를 빠짐없이 뽑는다 (recall). 사람/감정/감각 표현도 일단 포함한다.
  - **2단계**: 의미 분류만 한다. "아이템으로 쓸 만한가"는 묻지 않는다. 유지/제외는 모델이 아니라 code가 `KEEP_CATEGORIES`로 판정한다.
  - **2.5단계**: 제품 정책(COLLECTIBLE 여부)은 여기서만 다루고, 대상은 ACTIVITY뿐이다. 전 카테고리로 넓혀 봤다가 엣지케이스가 무너져서 되돌렸다.
  - **Final Selector**: 중복 표현, 조각 표현, 잘못 자른 후보, 단순 배경을 제거한다. 새 후보를 만들거나 기존 후보를 수정하지 않고 id만 고른다.
  - **3단계**: 살아남은 아이템에 아이콘용 `visual_description`과 `uniqueness`(GENERIC / SPECIFIC / DISTINCTIVE)를 붙인다.

## 2. 단계별 입출력

```mermaid
sequenceDiagram
    autonumber
    participant App as extract-items.ts (code)
    participant LLM as Ollama (gemma3:4b)

    App->>LLM: 1단계 — memo
    LLM-->>App: {candidates: [{name, evidence}]}

    App->>LLM: 2단계 — {candidates}
    LLM-->>App: {items: [{name, evidence, category}]}
    Note over App: KEEP_CATEGORIES 필터 후<br/>ACTIVITY / 비활동 분리

    opt ACTIVITY 후보가 있을 때만
        App->>LLM: 2.5단계 — {memo, activities: [{name, evidence}]}
        LLM-->>App: {activities: [{name, result: COLLECTIBLE | NOT_COLLECTIBLE}]}
    end
    Note over App: finalKept 합치고 id 부여

    App->>LLM: Final Selector — {original_text, candidates: [{id, name, category, evidence}]}
    LLM-->>App: {selected_ids: [...]}
    Note over App: 선택 id로 원본 후보 필터링

    App->>LLM: 3단계 — {items: [{name, evidence, category}]}
    LLM-->>App: {items: [{..., visual_description, uniqueness}]}
```

## 3. 공통 호출 구조 — `callWithRetry`

모든 LLM 단계(1, 2, 2.5, Final Selector, 3)가 같은 루프를 쓴다. 로컬 모델은 스키마를 어길 때 앱이 직접 방어해야 하기 때문이다.

```mermaid
flowchart LR
    START["단계 호출<br/>(system prompt + JSON Schema + 입력)"] --> CALL["Ollama /api/chat<br/>format = JSON Schema<br/>temperature 0"]
    CALL --> PARSE{"JSON.parse 성공?"}
    PARSE -->|실패| RETRY{"시도 < 4?<br/>(MAX_ATTEMPTS)"}
    PARSE -->|성공| ZOD{"Zod 검증 통과?"}
    ZOD -->|실패| RETRY
    ZOD -->|통과| OK["data 반환"]
    RETRY -->|예| CALL
    RETRY -->|아니오| FAIL["에러 throw<br/>(마지막 원본 응답 로그)"]
```

Final Selector는 호출할 때마다 스키마를 동적으로 만든다.
- JSON Schema: `selected_ids.items`에 `enum: [입력 id들]`
- Zod `superRefine`: **중복 id**와 **입력에 없는 id**를 거부한다. 거부되면 재시도로 이어진다.

## 4. 단계별 현재 성능 (500개, v0.5.2)

출처: `poc/eval-run-500-final-selector-v0.5.2.log`, `poc/eval-results-v0.5.2-final-selector-500.md`

| 단계 | 지표 | 값 |
|---|---|---|
| 1단계 | Candidate Recall | 551/562 (98.0%) |
| 2단계 | Category Accuracy | 492/551 (89.3%) |
| 2.5단계 | Collectibility accuracy | 80.4% |
| Final Selector | Expected Preservation / Non-expected Removal | 89.1% / 54.5% |
| 최종 | Precision / Recall / F1 | 68.2% / 76.9% / 72.3% |
| 최종 | 엣지케이스 통과 | 59/68 (86.8%) |
| 전 단계 | Schema 최종 실패 | 0 / 2,061 호출 |

## 5. 아직 이 파이프라인에 없는 것

AGENTS.md의 "시스템 파이프라인 (계획)"에 해당하는 부분은 아직 POC 범위 밖이다.

```mermaid
flowchart LR
    A["메모 저장"] -.->|"비동기 이벤트 (Kafka 등)"| B["아이템 추출<br/>(이 문서의 파이프라인)"]
    B -.-> C["아이템 지급"]
    C -.-> D["아이콘 생성<br/>(text-to-image)"]
    D -.-> E["보관함 반영"]
    C -.-> F["펫 상태 / 집계 업데이트"]
```

- POC에서는 동기 스크립트로 개념만 검증한다.
- 재시도 + DLQ, 멱등성, Circuit Breaker, 아이콘 생성 파이프라인은 미착수다.
- "활동 → 대표 오브젝트" 매핑(요가 → 요가매트 등)은 추출 단계에 넣지 않는다. 아이콘 생성 단계나 별도 큐레이션 테이블에서 처리한다.
