/**
 * 아이템 추출 POC용 평가 데이터셋 (500개).
 * 각 메모에 "정답(expected)"을 같이 넣어서, 모델 출력과 기계적으로 비교해
 * 정확도를 잴 수 있게 한다 (콘솔에 찍어놓고 눈으로 보는 것보다 재현 가능함).
 *
 * 기존 100개에 음식/장소/자연/사물/동물/활동 각 50개, 복합 50개,
 * 엣지 케이스 50개를 추가해 총 500개로 확장했다. 특정 실패 패턴에 치우치지 않고
 * 전체 카테고리와 다중 아이템/빈 배열 상황을 폭넓게 포함한다.
 * 의도적으로 "명확한 아이템이 없는" 케이스(expected: [])도 섞었다 —
 * 후자는 모델이 억지로 아이템을 만들어내지 않고 items를 적게/비워
 * 반환하는지 확인하기 위한 것.
 *
 * 사람(친구/가족 등 실존 인물)은 아이템 카테고리에서 제외했다 (AGENTS.md
 * "사람_동물 분리" 결정 참고) — 그래서 사람만 등장하고 다른 구체물이 없는
 * 메모는 expected: []가 정답이다 (엣지 케이스와 동일하게 취급).
 *
 * 정답 name은 "정답 라벨"이지 모델이 뱉어야 할 정확한 문자열이 아니다.
 * 채점할 때는 완전 일치 대신 부분 일치/포함 관계로 비교하는 걸 추천한다
 * (예: 정답 "치킨" vs 모델 출력 "후라이드 치킨"도 매치로 인정).
 *
 * 사용법: extract-items.ts에서
 *   import { TEST_CASES } from "./test-memos.js";
 *   TEST_CASES.map((c) => c.memo) // 메모 텍스트만 필요할 때
 */

export type ItemCategory =
  | "음식"
  | "장소"
  | "자연"
  | "사물"
  | "동물"
  | "활동"
  | "기타";

export interface ExpectedItem {
  name: string;
  /** 원문에 등장하는 표현만 다른 같은 개념(예: "수영"의 "자유형"). 서로 다른
   * 개념(예: "국밥"과 "국밥집")에는 쓰지 않는다 — 그런 건 모델이 잘못 뽑은
   * 것으로 계속 잡아야 한다. */
  aliases?: string[];
  category: ItemCategory;
}

export interface TestCase {
  memo: string;
  /** 억지로 채우지 않는 게 정답인 엣지 케이스는 빈 배열([]). */
  expected: ExpectedItem[];
}

export const TEST_CASES: TestCase[] = [
  // --- 음식 (18) ---
  {
    memo: "비 오는 날 창가에 앉아서 따뜻한 라떼 마시면서 좋아하는 책 읽었어.",
    expected: [
      { name: "라떼", category: "음식" },
      { name: "책", category: "사물" },
    ],
  },
  {
    memo: "엄마가 끓여준 된장찌개 먹으니까 집 생각나서 마음이 따뜻해졌다.",
    expected: [{ name: "된장찌개", category: "음식" }],
  },
  {
    memo: "친구 생일이라 다 같이 딸기 케이크 잘랐는데 다들 좋아해서 뿌듯했다.",
    expected: [{ name: "딸기 케이크", category: "음식" }],
  },
  {
    memo: "편의점에서 산 삼각김밥이었는데 참치마요가 그날따라 유독 맛있었다.",
    expected: [{ name: "참치마요 삼각김밥", category: "음식" }],
  },
  {
    memo: "할머니가 손수 부쳐주신 김치전에 막걸리 한 잔 곁들이니 최고였다.",
    expected: [
      { name: "김치전", category: "음식" },
      { name: "막걸리", category: "음식" },
    ],
  },
  {
    memo: "야근하고 집 가는 길에 사 먹은 붕어빵이 그날의 유일한 위로였다.",
    expected: [{ name: "붕어빵", category: "음식" }],
  },
  {
    memo: "첫눈 오는 날 포장마차에서 어묵 국물 마시니까 몸이 사르르 녹았다.",
    expected: [
      { name: "어묵 국물", category: "음식" },
      { name: "첫눈", category: "자연" },
    ],
  },
  {
    memo: "여행 가서 먹은 흑돼지 구이가 인생 최고의 맛이었다.",
    expected: [{ name: "흑돼지 구이", category: "음식" }],
  },
  {
    memo: "새벽에 몰래 먹은 초코라떼 한 잔이 그렇게 달콤할 수가 없었다.",
    expected: [{ name: "초코라떼", category: "음식" }],
  },
  {
    memo: "아빠가 구워준 삼겹살에 상추쌈 싸 먹는데 웃음이 끊이질 않았다.",
    expected: [{ name: "삼겹살", category: "음식" }],
  },
  {
    memo: "카페에서 처음 시켜본 흑임자라떼가 취향 저격이었다.",
    expected: [{ name: "흑임자라떼", category: "음식" }],
  },
  {
    memo: "명절에 온 가족이 둘러앉아 만든 만두를 쪄 먹으니 뿌듯했다.",
    expected: [{ name: "만두", category: "음식" }],
  },
  {
    memo: "시험 끝나고 친구들이랑 먹은 마라탕이 스트레스를 싹 날려줬다.",
    expected: [{ name: "마라탕", category: "음식" }],
  },
  {
    memo: "여름밤 평상에 앉아 먹은 수박 한 조각이 그렇게 시원할 수 없었다.",
    expected: [
      { name: "수박", category: "음식" },
      { name: "평상", category: "사물" },
    ],
  },
  {
    memo: "혼자 여행 갔다가 우연히 들어간 국밥집 국물이 진짜 감동이었다.",
    expected: [{ name: "국밥", category: "음식" }],
  },
  {
    memo: "크리스마스에 구운 통닭 냄새가 집안 가득 퍼졌던 게 기억에 남는다.",
    expected: [{ name: "통닭", category: "음식" }],
  },
  {
    memo: "동생이 처음으로 구워준 계란말이가 조금 탔지만 그게 더 웃겼다.",
    expected: [{ name: "계란말이", category: "음식" }],
  },
  {
    memo: "퇴근길에 산 붕어빵 세 마리를 나눠 먹으며 동료랑 얘기했다.",
    expected: [{ name: "붕어빵", category: "음식" }],
  },

  // --- 장소 (15) ---
  {
    memo: "오랜만에 간 동네 놀이터 그네에 앉아서 어릴 적 생각이 났다.",
    expected: [
      { name: "놀이터", category: "장소" },
      { name: "그네", category: "사물" },
    ],
  },
  {
    memo: "여행 중 우연히 들어간 작은 서점에서 시간 가는 줄 몰랐다.",
    expected: [{ name: "서점", category: "장소" }],
  },
  {
    memo: "옥상에 올라가서 도시 야경을 봤는데 마음이 뻥 뚫리는 기분이었다.",
    expected: [{ name: "야경", category: "장소" }],
  },
  {
    memo: "오래된 골목 사이 카페에서 낡은 나무 테이블에 앉아 커피를 마셨다.",
    expected: [
      { name: "카페", category: "장소" },
      { name: "커피", category: "음식" },
    ],
  },
  {
    memo: "바다가 보이는 벤치에 앉아 한참을 아무 말 없이 있었다.",
    expected: [
      { name: "바다", category: "자연" },
      { name: "벤치", category: "사물" },
    ],
  },
  {
    memo: "대학 때 자주 가던 도서관 열람실 냄새가 그대로였다.",
    expected: [{ name: "도서관", category: "장소" }],
  },
  {
    memo: "새로 생긴 루프탑 바에서 친구들과 노을을 배경으로 사진을 찍었다.",
    expected: [
      { name: "루프탑 바", category: "장소" },
      { name: "노을", category: "자연" },
    ],
  },
  {
    memo: "시골 할머니 댁 마당에 핀 봉숭아를 보니 어릴 적이 생각났다.",
    expected: [{ name: "봉숭아", category: "자연" }],
  },
  {
    memo: "등산 정상에서 본 구름바다가 힘들었던 걸 다 잊게 해줬다.",
    expected: [{ name: "구름바다", category: "자연" }],
  },
  {
    memo: "오래된 목욕탕 벽화를 보고 어릴 적 추억이 떠올라 웃음이 났다.",
    expected: [{ name: "목욕탕 벽화", category: "사물" }],
  },
  {
    memo: "작은 동네 빵집 앞을 지나는데 고소한 빵 냄새가 발걸음을 멈추게 했다.",
    expected: [
      { name: "빵집", category: "장소" },
      { name: "빵", category: "음식" },
    ],
  },
  {
    memo: "캠핑장에서 텐트 밖으로 보이는 별이 도시에서 본 것과 완전히 달랐다.",
    expected: [
      { name: "별", category: "자연" },
      { name: "텐트", category: "사물" },
    ],
  },
  {
    memo: "학교 앞 분식집이 아직도 그대로 있어서 반가웠다.",
    expected: [{ name: "분식집", category: "장소" }],
  },
  {
    memo: "처음 가본 온천에서 창밖 설경을 보며 몸을 녹였다.",
    expected: [
      { name: "온천", category: "장소" },
      { name: "설경", category: "자연" },
    ],
  },
  {
    memo: "놀이공원 회전목마 앞에서 아이처럼 신나서 뛰어다녔다.",
    expected: [{ name: "회전목마", category: "사물" }],
  },

  // --- 자연 (15) ---
  {
    memo: "퇴근하고 강아지랑 산책하는데 하늘에 별이 엄청 많았다.",
    expected: [
      { name: "별", category: "자연" },
      { name: "강아지", category: "동물" },
    ],
  },
  {
    memo: "아침 산책길에 핀 벚꽃이 바람에 흩날리는 걸 한참 바라봤다.",
    expected: [{ name: "벚꽃", category: "자연" }],
  },
  {
    memo: "비 그친 뒤 뜬 무지개를 보고 나도 모르게 소리를 질렀다.",
    expected: [{ name: "무지개", category: "자연" }],
  },
  {
    memo: "새벽 안개 낀 호수를 걷는데 세상에 나 혼자만 있는 것 같았다.",
    expected: [
      { name: "안개", category: "자연" },
      { name: "호수", category: "자연" },
    ],
  },
  {
    memo: "창문 열자마자 들어온 시원한 밤바람이 하루의 피로를 씻어줬다.",
    expected: [{ name: "밤바람", category: "자연" }],
  },
  {
    memo: "첫눈이 소복이 쌓인 아침, 아무도 안 밟은 눈길을 처음 걸었다.",
    expected: [{ name: "첫눈", category: "자연" }],
  },
  {
    memo: "가을 단풍이 절정이라 온 산이 붉게 물든 걸 보고 감탄했다.",
    expected: [{ name: "단풍", category: "자연" }],
  },
  {
    memo: "바닷가에서 파도 소리를 들으며 한참을 앉아 있었다.",
    expected: [{ name: "파도", category: "자연" }],
  },
  {
    memo: "새벽에 일어나 본 별똥별 하나에 소원을 빌었다.",
    expected: [{ name: "별똥별", category: "자연" }],
  },
  {
    memo: "여름 소나기가 지나간 뒤 흙냄새가 진하게 올라왔다.",
    // "냄새"는 ontology상 SENSORY(형체 없는 감각)로 DROP 대상이라 — 아이템
    // 추출 정책과 일관되게 정답도 빈 배열로 둔다.
    expected: [],
  },
  {
    memo: "노을이 지는 하늘이 그날따라 유난히 주황빛이었다.",
    expected: [{ name: "노을", category: "자연" }],
  },
  {
    memo: "겨울 아침 창문에 낀 성에 모양이 신기해서 한참 들여다봤다.",
    expected: [{ name: "성에", category: "자연" }],
  },
  {
    memo: "봄바람에 흩날리는 벚꽃잎을 손으로 잡아보려다 계속 놓쳤다.",
    expected: [{ name: "벚꽃잎", category: "자연" }],
  },
  {
    memo: "산 정상에서 마신 물이 그렇게 시원할 수 없었다.",
    expected: [{ name: "물", category: "음식" }],
  },
  {
    memo: "밤하늘에 뜬 보름달이 유독 크고 밝아 보였다.",
    expected: [{ name: "보름달", category: "자연" }],
  },

  // --- 사물 (15) ---
  {
    memo: "옛날에 쓰던 필름 카메라를 꺼내서 오랜만에 사진을 찍었다.",
    expected: [{ name: "필름 카메라", category: "사물" }],
  },
  {
    memo: "낡은 일기장을 정리하다 어릴 적 그림을 발견하고 웃음이 났다.",
    expected: [
      { name: "일기장", category: "사물" },
      { name: "그림", category: "사물" },
    ],
  },
  {
    memo: "할아버지가 물려주신 손목시계를 처음으로 차 봤다.",
    expected: [{ name: "손목시계", category: "사물" }],
  },
  {
    memo: "새로 산 노란 우산을 쓰고 비 오는 거리를 걸었다.",
    expected: [{ name: "노란 우산", category: "사물" }],
  },
  {
    memo: "오래된 라디오에서 흘러나온 옛날 노래에 마음이 몽글해졌다.",
    expected: [{ name: "라디오", category: "사물" }],
  },
  {
    memo: "첫 월급으로 산 립스틱을 화장대에 올려두고 계속 쳐다봤다.",
    expected: [{ name: "립스틱", category: "사물" }],
  },
  {
    memo: "친구가 준 손편지를 서랍 속에서 다시 꺼내 읽어봤다.",
    expected: [{ name: "손편지", category: "사물" }],
  },
  {
    memo: "어릴 적 갖고 놀던 낡은 곰인형을 다락에서 발견했다.",
    expected: [{ name: "곰인형", category: "사물" }],
  },
  {
    memo: "새로 산 만년필로 처음 쓴 문장이 마음에 들었다.",
    expected: [{ name: "만년필", category: "사물" }],
  },
  {
    memo: "오래 신은 운동화 밑창이 다 닳은 걸 보고 그동안의 발걸음이 떠올랐다.",
    expected: [{ name: "운동화", category: "사물" }],
  },
  {
    memo: "여행지에서 산 작은 도자기 인형을 선반에 올려뒀다.",
    expected: [{ name: "도자기 인형", category: "사물" }],
  },
  {
    memo: "첫 캠핑 때 산 랜턴을 오랜만에 다시 켜봤다.",
    expected: [{ name: "랜턴", category: "사물" }],
  },
  {
    memo: "아빠가 쓰던 낡은 만능키를 정리하다 발견했다.",
    expected: [{ name: "만능키", category: "사물" }],
  },
  {
    memo: "오래된 LP판을 턴테이블에 올리고 지지직 소리를 들었다.",
    expected: [{ name: "LP판", category: "사물" }],
  },
  {
    memo: "새로 산 니트 스웨터가 그날따라 유독 따뜻하게 느껴졌다.",
    expected: [{ name: "니트 스웨터", category: "사물" }],
  },

  // --- 동물(5) + 사람만 등장(아이템 없음, 7) + 복합(3) — 원래 "사람_동물" 15개 ---
  {
    memo: "오랜만에 옛날 친구를 만나서 옛날 이야기하면서 엄청 웃었다.",
    expected: [],
  },
  {
    memo: "아기 조카가 처음으로 내 이름을 부르는 걸 듣고 울컥했다.",
    expected: [],
  },
  {
    memo: "길고양이가 무릎 위에 올라와 잠든 걸 한참 지켜봤다.",
    expected: [{ name: "길고양이", category: "동물" }],
  },
  {
    memo: "할머니가 손을 꼭 잡아주시는데 그 온기가 오래 남았다.",
    expected: [],
  },
  {
    memo: "강아지가 산책 내내 꼬리를 흔들며 옆에 붙어 있었다.",
    expected: [{ name: "강아지", category: "동물" }],
  },
  {
    memo: "동생이 몰래 준비한 깜짝 선물에 눈물이 났다.",
    expected: [{ name: "선물", category: "사물" }],
  },
  {
    memo: "친구가 힘든 얘기를 다 들어주고 안아줬을 때 위로가 됐다.",
    expected: [],
  },
  {
    memo: "처음 만난 유기견이 낯가림 없이 다가와 손을 핥았다.",
    expected: [{ name: "유기견", category: "동물" }],
  },
  {
    memo: "아빠가 오랜만에 서툰 요리를 해주셔서 웃음이 났다.",
    expected: [],
  },
  {
    memo: "새로 사귄 친구와 밤새 통화하면서 시간 가는 줄 몰랐다.",
    expected: [],
  },
  {
    memo: "앵무새가 처음으로 내 이름을 따라 말해서 신기했다.",
    expected: [{ name: "앵무새", category: "동물" }],
  },
  {
    memo: "할아버지가 옛날 사진첩을 꺼내 하나하나 설명해주셨다.",
    expected: [{ name: "사진첩", category: "사물" }],
  },
  {
    memo: "여행지에서 만난 낯선 여행자와 밤새 이야기를 나눴다.",
    expected: [],
  },
  {
    memo: "조카가 그려준 삐뚤빼뚤한 우리 가족 그림을 냉장고에 붙였다.",
    expected: [{ name: "그림", category: "사물" }],
  },
  {
    memo: "고양이가 처음으로 내 무릎에서 골골 소리를 냈다.",
    expected: [{ name: "고양이", category: "동물" }],
  },

  // --- 활동 (12) ---
  {
    memo: "오랜만에 자전거를 타고 한강을 달리는데 바람이 시원했다.",
    expected: [{ name: "자전거", category: "활동" }],
  },
  {
    memo: "친구들이랑 밤새 보드게임을 하면서 시간 가는 줄 몰랐다.",
    expected: [{ name: "보드게임", category: "활동" }],
  },
  {
    memo: "처음으로 도전한 클라이밍에서 정상까지 올라갔을 때 짜릿했다.",
    expected: [{ name: "클라이밍", category: "활동" }],
  },
  {
    memo: "요가 수업 끝나고 몸이 개운해진 느낌이 오래갔다.",
    expected: [{ name: "요가", category: "활동" }],
  },
  {
    memo: "오랜만에 노래방에서 목이 쉴 때까지 소리 지르며 놀았다.",
    expected: [{ name: "노래방", category: "장소" }],
  },
  {
    memo: "서툴게 구운 빵이지만 처음으로 완성했을 때 뿌듯했다.",
    expected: [{ name: "베이킹", aliases: ["빵 굽기"], category: "활동" }],
  },
  {
    memo: "밤늦게까지 그림을 그리다 완성작을 보고 혼자 뿌듯해했다.",
    expected: [{ name: "그림", category: "활동" }],
  },
  {
    memo: "오랜만에 수영장에서 자유형을 완주했을 때 성취감이 컸다.",
    expected: [{ name: "수영", aliases: ["자유형"], category: "활동" }],
  },
  {
    memo: "친구와 처음으로 도예 체험을 했는데 생각보다 재미있었다.",
    expected: [{ name: "도예", category: "활동" }],
  },
  {
    memo: "새벽까지 게임을 하다 마지막 판을 이겼을 때 소리를 질렀다.",
    expected: [{ name: "게임", category: "활동" }],
  },
  {
    memo: "처음으로 혼자 여행 계획을 짜고 떠났을 때 뿌듯함이 컸다.",
    expected: [{ name: "여행", category: "활동" }],
  },
  {
    memo: "오랜만에 피아노 앞에 앉아 예전에 치던 곡을 다시 쳤다.",
    // "자전거를 타다"/"그림을 그리다"와 같은 기준(행위 자체가 활동)으로 통일 —
    // 전엔 "사물"(피아노라는 물건)로 잡혀 있었다.
    expected: [{ name: "피아노 연주", aliases: ["피아노"], category: "활동" }],
  },

  // --- 엣지 케이스: 명확한 아이템이 없거나 애매함 (10) ---
  // 정답은 전부 빈 배열 — 모델이 억지로 아이템을 만들어내지 않아야 정답.
  { memo: "오늘 하루 종일 아무것도 안 하고 그냥 누워만 있었는데 그게 행복이었다.", expected: [] },
  { memo: "오랜만에 마음이 편안해서 그냥 좋았다.", expected: [] },
  { memo: "딱히 특별한 일은 없었지만 왠지 기분 좋은 하루였다.", expected: [] },
  { memo: "그냥 아무 생각 없이 멍하니 시간을 보냈는데 좋았다.", expected: [] },
  { memo: "오랜만에 늦잠을 잤는데 그게 그렇게 행복할 수가 없었다.", expected: [] },
  { memo: "별일 없이 조용히 하루를 마무리한 게 오히려 편안했다.", expected: [] },
  { memo: "오늘따라 기분이 좋았는데 이유는 잘 모르겠다.", expected: [] },
  { memo: "그냥 평범한 하루였는데 마음이 유난히 가벼웠다.", expected: [] },
  { memo: "아무 약속도 없는 주말 오후가 오랜만에 여유로웠다.", expected: [] },
  { memo: "오랜만에 아무 걱정 없이 푹 쉰 것 같아서 좋았다.", expected: [] },

  // --- 추가 음식 (50) ---
  {
    memo: "퇴근 후 처음 가본 식당에서 크림파스타를 먹었는데 소스가 정말 부드러웠다.",
    expected: [{ name: "크림파스타", category: "음식" }],
  },
  {
    memo: "비 오는 저녁에 김치볶음밥을 만들어 먹으니 괜히 든든했다.",
    expected: [{ name: "김치볶음밥", category: "음식" }],
  },
  {
    memo: "오랜만에 시장에서 떡볶이를 먹었는데 매콤한 맛이 딱 좋았다.",
    expected: [{ name: "떡볶이", category: "음식" }],
  },
  {
    memo: "더운 오후에 아이스아메리카노 한 잔 마시니 정신이 번쩍 들었다.",
    expected: [{ name: "아이스아메리카노", category: "음식" }],
  },
  {
    memo: "편의점에서 산 딸기우유가 생각보다 달지 않아서 좋았다.",
    expected: [{ name: "딸기우유", category: "음식" }],
  },
  {
    memo: "조용한 오후에 바닐라라떼를 천천히 마시며 쉬었다.",
    expected: [{ name: "바닐라라떼", category: "음식" }],
  },
  {
    memo: "오랜만에 먹은 초밥이 하나하나 신선해서 기분이 좋았다.",
    expected: [{ name: "초밥", category: "음식" }],
  },
  {
    memo: "쌀쌀한 날 뜨끈한 갈비탕 한 그릇을 비우니 몸이 풀렸다.",
    expected: [{ name: "갈비탕", category: "음식" }],
  },
  {
    memo: "더운 날 먹은 비빔냉면이 새콤매콤해서 입맛이 돌았다.",
    expected: [{ name: "비빔냉면", category: "음식" }],
  },
  {
    memo: "겨울 골목에서 갓 구운 호떡을 먹으니 손까지 따뜻해졌다.",
    expected: [{ name: "호떡", category: "음식" }],
  },
  {
    memo: "밤에 군고구마를 반으로 갈라 먹는데 달콤해서 좋았다.",
    expected: [{ name: "군고구마", category: "음식" }],
  },
  {
    memo: "점심에 간단히 먹은 샌드위치가 의외로 든든했다.",
    expected: [{ name: "샌드위치", category: "음식" }],
  },
  {
    memo: "집에서 만든 카레를 먹으니 익숙한 향이 편안했다.",
    expected: [{ name: "카레", category: "음식" }],
  },
  {
    memo: "비 오는 날 뜨거운 우동 국물을 마시니 기분이 차분해졌다.",
    expected: [{ name: "우동", category: "음식" }],
  },
  {
    memo: "주말에 부친 감자전이 바삭하게 잘 익어서 뿌듯했다.",
    expected: [{ name: "감자전", category: "음식" }],
  },
  {
    memo: "처음 사 본 에그타르트가 겉은 바삭하고 속은 부드러웠다.",
    expected: [{ name: "에그타르트", category: "음식" }],
  },
  {
    memo: "식사 후 먹은 티라미수가 너무 달지 않아 딱 좋았다.",
    expected: [{ name: "티라미수", category: "음식" }],
  },
  {
    memo: "햇빛 좋은 날 레몬에이드를 마시니 상큼해서 기분이 났다.",
    expected: [{ name: "레몬에이드", category: "음식" }],
  },
  {
    memo: "오랜만에 먹은 수제버거가 육즙이 가득해서 만족스러웠다.",
    expected: [{ name: "수제버거", category: "음식" }],
  },
  {
    memo: "점심에 먹은 쌀국수 국물이 깔끔해서 끝까지 다 마셨다.",
    expected: [{ name: "쌀국수", category: "음식" }],
  },
  {
    memo: "선물 받은 마카롱을 하나 먹었는데 색도 예쁘고 맛도 좋았다.",
    expected: [{ name: "마카롱", category: "음식" }],
  },
  {
    memo: "조용한 밤에 따뜻한 녹차를 마시며 하루를 정리했다.",
    expected: [{ name: "녹차", category: "음식" }],
  },
  {
    memo: "목이 칼칼할 때 마신 유자차가 달콤하고 따뜻했다.",
    expected: [{ name: "유자차", category: "음식" }],
  },
  {
    memo: "냉장고에 있던 청포도를 먹었는데 아삭하고 시원했다.",
    expected: [{ name: "청포도", category: "음식" }],
  },
  {
    memo: "잘 익은 복숭아를 한입 베어 물었는데 향이 진해서 좋았다.",
    expected: [{ name: "복숭아", category: "음식" }],
  },
  {
    memo: "겨울밤 이불 속에서 귤을 까먹는 시간이 편안했다.",
    expected: [{ name: "귤", category: "음식" }],
  },
  {
    memo: "처음 산 체리가 생각보다 달고 탱탱해서 기분이 좋았다.",
    expected: [{ name: "체리", category: "음식" }],
  },
  {
    memo: "아침에 블루베리 요거트를 먹으니 상큼하게 하루를 시작했다.",
    expected: [{ name: "블루베리 요거트", category: "음식" }],
  },
  {
    memo: "직접 만든 오므라이스 모양이 예쁘게 나와서 괜히 뿌듯했다.",
    expected: [{ name: "오므라이스", category: "음식" }],
  },
  {
    memo: "치즈가 길게 늘어나는 치즈돈가스를 먹으며 웃음이 났다.",
    expected: [{ name: "치즈돈가스", category: "음식" }],
  },
  {
    memo: "친구들과 철판 닭갈비를 볶아 먹으니 오랜만에 제대로 먹은 느낌이었다.",
    expected: [{ name: "닭갈비", category: "음식" }],
  },
  {
    memo: "점심에 먹은 잔치국수가 담백해서 속이 편했다.",
    expected: [{ name: "잔치국수", category: "음식" }],
  },
  {
    memo: "한여름에 차가운 콩국수를 먹으니 더위가 잠깐 잊혔다.",
    expected: [{ name: "콩국수", category: "음식" }],
  },
  {
    memo: "아침에 토마토주스를 마시니 입안이 깔끔했다.",
    expected: [{ name: "토마토주스", category: "음식" }],
  },
  {
    memo: "처음 먹어본 아포가토의 쌉쌀하고 달콤한 조합이 마음에 들었다.",
    expected: [{ name: "아포가토", category: "음식" }],
  },
  {
    memo: "카페에서 먹은 치즈케이크가 꾸덕해서 오래 기억에 남았다.",
    expected: [{ name: "치즈케이크", category: "음식" }],
  },
  {
    memo: "갓 나온 감자튀김을 먹는데 바삭해서 계속 손이 갔다.",
    expected: [{ name: "감자튀김", category: "음식" }],
  },
  {
    memo: "시장 닭강정을 사 와서 먹는데 달콤매콤해서 맛있었다.",
    expected: [{ name: "닭강정", category: "음식" }],
  },
  {
    memo: "명절에 먹은 잡채가 따뜻하고 간이 딱 맞았다.",
    expected: [{ name: "잡채", category: "음식" }],
  },
  {
    memo: "생일 아침에 먹은 미역국이 유난히 따뜻하게 느껴졌다.",
    expected: [{ name: "미역국", category: "음식" }],
  },
  {
    memo: "추운 저녁에 부대찌개를 끓여 먹으니 방 안까지 따뜻해진 느낌이었다.",
    expected: [{ name: "부대찌개", category: "음식" }],
  },
  {
    memo: "얼큰한 순두부찌개를 먹고 나니 속이 든든했다.",
    expected: [{ name: "순두부찌개", category: "음식" }],
  },
  {
    memo: "더운 점심에 시원한 메밀소바를 먹으니 개운했다.",
    expected: [{ name: "메밀소바", category: "음식" }],
  },
  {
    memo: "아침에 갓 구운 크루아상을 먹었는데 결이 바삭해서 좋았다.",
    expected: [{ name: "크루아상", category: "음식" }],
  },
  {
    memo: "빵집에서 산 소금빵이 짭짤하고 고소해서 금방 다 먹었다.",
    expected: [{ name: "소금빵", category: "음식" }],
  },
  {
    memo: "더운 오후에 망고빙수를 나눠 먹으니 더위가 싹 가셨다.",
    expected: [{ name: "망고빙수", category: "음식" }],
  },
  {
    memo: "차와 함께 약과를 먹으니 달콤하고 고소했다.",
    expected: [{ name: "약과", category: "음식" }],
  },
  {
    memo: "식사 후 차가운 식혜를 마시니 입안이 개운했다.",
    expected: [{ name: "식혜", category: "음식" }],
  },
  {
    memo: "뜨거운 콘치즈를 떠먹는데 치즈가 쭉 늘어나서 재미있었다.",
    expected: [{ name: "콘치즈", category: "음식" }],
  },
  {
    memo: "점심으로 먹은 연어덮밥이 신선하고 든든했다.",
    expected: [{ name: "연어덮밥", category: "음식" }],
  },

  // --- 추가 장소 (50) ---
  {
    memo: "주말에 한옥마을을 천천히 걸으며 오래된 지붕들을 구경했다.",
    expected: [{ name: "한옥마을", category: "장소" }],
  },
  {
    memo: "오랜만에 수목원에 가서 조용한 길을 걷는 시간이 좋았다.",
    expected: [{ name: "수목원", category: "장소" }],
  },
  {
    memo: "평일 오후 미술관에서 작품을 천천히 보는 시간이 편안했다.",
    expected: [{ name: "미술관", category: "장소" }],
  },
  {
    memo: "여행 중 들른 박물관에서 오래된 전시물을 구경했다.",
    expected: [{ name: "박물관", category: "장소" }],
  },
  {
    memo: "밤에 천문대에 올라가 별을 보니 시간이 금방 갔다.",
    expected: [{ name: "천문대", category: "장소" }],
  },
  {
    memo: "식물원 안의 따뜻한 공기와 초록빛이 마음에 들었다.",
    expected: [{ name: "식물원", category: "장소" }],
  },
  {
    memo: "전망대에 올라 도시 전체를 내려다보니 시야가 탁 트였다.",
    expected: [{ name: "전망대", category: "장소" }],
  },
  {
    memo: "오랜만에 찾은 기차역에서 여행을 시작하는 기분이 설렜다.",
    expected: [{ name: "기차역", category: "장소" }],
  },
  {
    memo: "아침 일찍 버스터미널에 도착하니 여행 가는 실감이 났다.",
    expected: [{ name: "버스터미널", category: "장소" }],
  },
  {
    memo: "골목의 작은 독립서점에서 책을 고르는 시간이 즐거웠다.",
    expected: [{ name: "독립서점", category: "장소" }],
  },
  {
    memo: "처음 가본 레코드숍에서 오래된 음반들을 구경했다.",
    expected: [{ name: "레코드숍", category: "장소" }],
  },
  {
    memo: "아침 꽃시장에서 여러 꽃을 구경하니 눈이 즐거웠다.",
    expected: [{ name: "꽃시장", category: "장소" }],
  },
  {
    memo: "여행지 재래시장을 천천히 돌아다니며 구경했다.",
    expected: [{ name: "재래시장", category: "장소" }],
  },
  {
    memo: "밤에 야시장에 들러 북적이는 분위기를 즐겼다.",
    expected: [{ name: "야시장", category: "장소" }],
  },
  {
    memo: "사람이 적은 해변을 오래 걸으니 마음이 차분해졌다.",
    expected: [{ name: "해변", category: "장소" }],
  },
  {
    memo: "집 근처 산책로를 걷는데 공기가 맑아서 좋았다.",
    expected: [{ name: "산책로", category: "장소" }],
  },
  {
    memo: "저녁에 호숫가를 따라 천천히 걷는 시간이 평화로웠다.",
    expected: [{ name: "호숫가", category: "장소" }],
  },
  {
    memo: "주말 아침 강변공원에 가서 느긋하게 시간을 보냈다.",
    expected: [{ name: "강변공원", category: "장소" }],
  },
  {
    memo: "햇빛이 비치는 숲길을 걷는데 주변이 조용해서 좋았다.",
    expected: [{ name: "숲길", category: "장소" }],
  },
  {
    memo: "바닷가 등대 근처에서 한참 수평선을 바라봤다.",
    expected: [{ name: "등대", category: "장소" }],
  },
  {
    memo: "작은 정원에 앉아 꽃들을 바라보며 쉬었다.",
    expected: [{ name: "정원", category: "장소" }],
  },
  {
    memo: "해 질 무렵 넓은 광장에서 사람들이 오가는 걸 구경했다.",
    expected: [{ name: "광장", category: "장소" }],
  },
  {
    memo: "오랜만에 예전 캠퍼스를 걸으니 학생 때 기억이 났다.",
    expected: [{ name: "캠퍼스", category: "장소" }],
  },
  {
    memo: "저녁에 학교 운동장을 천천히 돌며 바람을 맞았다.",
    expected: [{ name: "운동장", category: "장소" }],
  },
  {
    memo: "오랜만에 체육관에 들어가니 예전 운동하던 기억이 떠올랐다.",
    expected: [{ name: "체육관", category: "장소" }],
  },
  {
    memo: "아침 일찍 수영장에 가니 사람이 적어서 한적했다.",
    expected: [{ name: "수영장", category: "장소" }],
  },
  {
    memo: "추운 날 찜질방에서 몸을 녹이며 느긋하게 쉬었다.",
    expected: [{ name: "찜질방", category: "장소" }],
  },
  {
    memo: "동네 공방에 들어가 손으로 만든 작품들을 구경했다.",
    expected: [{ name: "공방", category: "장소" }],
  },
  {
    memo: "처음 방문한 도예공방의 흙 냄새와 조용한 분위기가 좋았다.",
    expected: [{ name: "도예공방", category: "장소" }],
  },
  {
    memo: "오래된 사진관에서 흑백 사진들을 구경했다.",
    expected: [{ name: "사진관", category: "장소" }],
  },
  {
    memo: "늦은 밤 조용한 세탁방에서 빨래가 돌아가는 걸 기다렸다.",
    expected: [{ name: "세탁방", category: "장소" }],
  },
  {
    memo: "학교 앞 문구점에 들러 알록달록한 물건들을 구경했다.",
    expected: [{ name: "문구점", category: "장소" }],
  },
  {
    memo: "작은 꽃집에 들어갔더니 가게 안이 화사해서 기분이 좋아졌다.",
    expected: [{ name: "꽃집", category: "장소" }],
  },
  {
    memo: "아침에 동네 빵집에 들르니 갓 구운 빵이 진열돼 있었다.",
    expected: [{ name: "빵집", category: "장소" }],
  },
  {
    memo: "오랜만에 학교 앞 분식집에 가니 예전 생각이 났다.",
    expected: [{ name: "분식집", category: "장소" }],
  },
  {
    memo: "주말에 만화카페에서 좋아하던 만화를 몰아서 읽었다.",
    expected: [{ name: "만화카페", category: "장소" }],
  },
  {
    memo: "조용한 북카페에서 책을 읽으며 오후를 보냈다.",
    expected: [{ name: "북카페", category: "장소" }],
  },
  {
    memo: "해 질 무렵 루프탑에 올라가 도시를 내려다봤다.",
    expected: [{ name: "루프탑", category: "장소" }],
  },
  {
    memo: "여름에 계곡에 가서 발을 담그니 물이 차가워서 시원했다.",
    expected: [{ name: "계곡", category: "장소" }],
  },
  {
    memo: "등산 중 산장에 들러 잠시 쉬니 마음이 놓였다.",
    expected: [{ name: "산장", category: "장소" }],
  },
  {
    memo: "장거리 운전 중 휴게소에 들러 잠깐 쉬었다.",
    expected: [{ name: "휴게소", category: "장소" }],
  },
  {
    memo: "오랜만에 공항에 도착하니 여행 가는 기분이 실감 났다.",
    expected: [{ name: "공항", category: "장소" }],
  },
  {
    memo: "아침 항구에서 배들이 오가는 모습을 한참 바라봤다.",
    expected: [{ name: "항구", category: "장소" }],
  },
  {
    memo: "조용한 선착장에 앉아 물결을 바라보니 마음이 편했다.",
    expected: [{ name: "선착장", category: "장소" }],
  },
  {
    memo: "여행 중 오래된 성당에 들어가 조용히 둘러봤다.",
    expected: [{ name: "성당", category: "장소" }],
  },
  {
    memo: "산속 사찰에 들렀더니 주변이 고요해서 마음이 차분해졌다.",
    expected: [{ name: "사찰", category: "장소" }],
  },
  {
    memo: "저녁에 한강공원에서 오래 앉아 야경을 봤다.",
    expected: [{ name: "한강공원", category: "장소" }],
  },
  {
    memo: "아쿠아리움에서 천천히 헤엄치는 물고기를 보며 시간을 보냈다.",
    expected: [{ name: "아쿠아리움", category: "장소" }],
  },
  {
    memo: "오랜만에 동물원에 가서 여러 동물을 구경했다.",
    expected: [{ name: "동물원", category: "장소" }],
  },
  {
    memo: "날씨가 좋아 식당 테라스에 앉아 천천히 식사했다.",
    expected: [{ name: "식당 테라스", category: "장소" }],
  },

  // --- 추가 자연 (50) ---
  {
    memo: "새벽에 본 해돋이가 붉게 번지는 모습이 인상적이었다.",
    expected: [{ name: "해돋이", category: "자연" }],
  },
  {
    memo: "집에 가는 길에 본 석양이 유난히 붉고 선명했다.",
    expected: [{ name: "석양", category: "자연" }],
  },
  {
    memo: "가을 들판의 억새가 바람에 흔들리는 모습이 예뻤다.",
    expected: [{ name: "억새", category: "자연" }],
  },
  {
    memo: "길가에 핀 코스모스를 보며 천천히 걸었다.",
    expected: [{ name: "코스모스", category: "자연" }],
  },
  {
    memo: "넓게 핀 유채꽃이 노랗게 이어져 있어서 한참 바라봤다.",
    expected: [{ name: "유채꽃", category: "자연" }],
  },
  {
    memo: "보도 옆에 핀 작은 민들레가 눈에 들어와 잠시 멈췄다.",
    expected: [{ name: "민들레", category: "자연" }],
  },
  {
    memo: "정원에 핀 장미가 선명한 색이라 오래 바라봤다.",
    expected: [{ name: "장미", category: "자연" }],
  },
  {
    memo: "비 온 뒤 수국이 더 짙은 색으로 보여서 예뻤다.",
    expected: [{ name: "수국", category: "자연" }],
  },
  {
    memo: "겨울 길가에 핀 동백꽃이 유난히 붉어 눈에 띄었다.",
    expected: [{ name: "동백꽃", category: "자연" }],
  },
  {
    memo: "초봄에 핀 매화를 보니 계절이 바뀌는 게 느껴졌다.",
    expected: [{ name: "매화", category: "자연" }],
  },
  {
    memo: "노랗게 물든 은행잎이 길에 가득 쌓여 있었다.",
    expected: [{ name: "은행잎", category: "자연" }],
  },
  {
    memo: "바삭한 낙엽이 길을 덮고 있어서 걸을 때마다 소리가 났다.",
    expected: [{ name: "낙엽", category: "자연" }],
  },
  {
    memo: "산책하다 주운 솔방울 모양이 반듯해서 한참 들여다봤다.",
    expected: [{ name: "솔방울", category: "자연" }],
  },
  {
    memo: "돌담에 낀 초록 이끼가 촉촉하게 보여서 신기했다.",
    expected: [{ name: "이끼", category: "자연" }],
  },
  {
    memo: "물가에서 반들반들한 조약돌 하나를 발견했다.",
    expected: [{ name: "조약돌", category: "자연" }],
  },
  {
    memo: "햇빛 받은 모래가 반짝이는 걸 한참 바라봤다.",
    expected: [{ name: "모래", category: "자연" }],
  },
  {
    memo: "저녁 바다의 파도가 반복해서 밀려오는 모습이 좋았다.",
    expected: [{ name: "파도", category: "자연" }],
  },
  {
    memo: "잔잔한 호수의 물결이 햇빛에 반짝였다.",
    expected: [{ name: "물결", category: "자연" }],
  },
  {
    memo: "산길 끝에서 만난 폭포가 시원하게 쏟아지고 있었다.",
    expected: [{ name: "폭포", category: "자연" }],
  },
  {
    memo: "맑은 계곡물이 돌 사이로 흐르는 모습이 보기 좋았다.",
    expected: [{ name: "계곡물", category: "자연" }],
  },
  {
    memo: "아침 풀잎에 내려앉은 서리가 햇빛에 반짝였다.",
    expected: [{ name: "서리", category: "자연" }],
  },
  {
    memo: "가로등 아래 떨어지는 눈송이가 천천히 보여서 예뻤다.",
    expected: [{ name: "눈송이", category: "자연" }],
  },
  {
    memo: "갑자기 떨어진 작은 우박 알갱이가 신기해서 창밖을 봤다.",
    expected: [{ name: "우박", category: "자연" }],
  },
  {
    memo: "한낮에 갑자기 내린 소나기가 금방 지나가서 신기했다.",
    expected: [{ name: "소나기", category: "자연" }],
  },
  {
    memo: "비 오기 전 짙은 먹구름이 하늘을 가득 덮었다.",
    expected: [{ name: "먹구름", category: "자연" }],
  },
  {
    memo: "창밖의 구름 모양이 계속 바뀌는 걸 한참 바라봤다.",
    expected: [{ name: "구름", category: "자연" }],
  },
  {
    memo: "높은 하늘에 퍼진 새털구름이 부드럽게 보여서 좋았다.",
    expected: [{ name: "새털구름", category: "자연" }],
  },
  {
    memo: "밤하늘에서 익숙한 별자리를 찾아냈을 때 반가웠다.",
    expected: [{ name: "별자리", category: "자연" }],
  },
  {
    memo: "얇게 뜬 초승달이 또렷해서 한참 바라봤다.",
    expected: [{ name: "초승달", category: "자연" }],
  },
  {
    memo: "귀가길에 본 보름달이 크고 밝아서 사진을 찍었다.",
    expected: [{ name: "보름달", category: "자연" }],
  },
  {
    memo: "달 주변에 생긴 달무리가 신기해서 오래 바라봤다.",
    expected: [{ name: "달무리", category: "자연" }],
  },
  {
    memo: "여행에서 처음 본 오로라가 하늘을 천천히 물들이고 있었다.",
    expected: [{ name: "오로라", category: "자연" }],
  },
  {
    memo: "아침 강가에 낀 안개가 풍경을 흐릿하게 감싸고 있었다.",
    expected: [{ name: "안개", category: "자연" }],
  },
  {
    memo: "비가 그친 뒤 나타난 무지개가 선명해서 기분이 좋아졌다.",
    expected: [{ name: "무지개", category: "자연" }],
  },
  {
    memo: "추운 아침 창가에 생긴 서리꽃 무늬가 섬세해서 신기했다.",
    expected: [{ name: "서리꽃", category: "자연" }],
  },
  {
    memo: "처마 끝에 길게 매달린 고드름이 햇빛에 반짝였다.",
    expected: [{ name: "고드름", category: "자연" }],
  },
  {
    memo: "비 온 다음 날 파란 하늘이 유난히 맑아 보였다.",
    expected: [{ name: "파란 하늘", category: "자연" }],
  },
  {
    memo: "저녁 노을이 분홍색과 주황색으로 번져 오래 바라봤다.",
    expected: [{ name: "노을", category: "자연" }],
  },
  {
    memo: "따뜻한 봄바람이 불어와 계절이 바뀐 게 느껴졌다.",
    expected: [{ name: "봄바람", category: "자연" }],
  },
  {
    memo: "선선한 가을바람이 불어와 걷기 좋은 날이었다.",
    expected: [{ name: "가을바람", category: "자연" }],
  },
  {
    memo: "바람에 흔들리는 대나무가 내는 모습이 시원해 보였다.",
    expected: [{ name: "대나무", category: "자연" }],
  },
  {
    memo: "산길의 큰 소나무가 곧게 서 있는 모습이 인상적이었다.",
    expected: [{ name: "소나무", category: "자연" }],
  },
  {
    memo: "붉게 물든 단풍나무를 보고 잠깐 멈춰 섰다.",
    expected: [{ name: "단풍나무", category: "자연" }],
  },
  {
    memo: "강가의 갈대가 바람에 한쪽으로 흔들리고 있었다.",
    expected: [{ name: "갈대", category: "자연" }],
  },
  {
    memo: "길가에 이름 모를 들꽃이 잔뜩 피어 있었다.",
    expected: [{ name: "들꽃", category: "자연" }],
  },
  {
    memo: "연못에 핀 연꽃이 깨끗하고 선명해 보여서 좋았다.",
    expected: [{ name: "연꽃", category: "자연" }],
  },
  {
    memo: "물 위에 떠 있는 수련이 조용한 풍경과 잘 어울렸다.",
    expected: [{ name: "수련", category: "자연" }],
  },
  {
    memo: "멀리 보이는 산 능선이 선명해서 한참 바라봤다.",
    expected: [{ name: "산", category: "자연" }],
  },
  {
    memo: "언덕에서 내려다본 바다가 햇빛에 반짝여서 아름다웠다.",
    expected: [{ name: "바다", category: "자연" }],
  },
  {
    memo: "전망대에서 바라본 호수가 거울처럼 잔잔했다.",
    expected: [{ name: "호수", category: "자연" }],
  },

  // --- 추가 사물 (50) ---
  {
    memo: "오래 쓰던 머그컵에 차를 따라 마시니 익숙해서 좋았다.",
    expected: [{ name: "머그컵", category: "사물" }],
  },
  {
    memo: "새로 산 텀블러를 처음 들고 나가니 괜히 기분이 좋았다.",
    expected: [{ name: "텀블러", category: "사물" }],
  },
  {
    memo: "새 노트 첫 장에 글을 쓰는데 종이 감촉이 좋았다.",
    expected: [{ name: "노트", category: "사물" }],
  },
  {
    memo: "작년 다이어리를 넘겨보다가 예전 기록을 발견했다.",
    expected: [{ name: "다이어리", category: "사물" }],
  },
  {
    memo: "오랜만에 연필로 글씨를 쓰니 사각거리는 느낌이 좋았다.",
    expected: [{ name: "연필", category: "사물" }],
  },
  {
    memo: "색연필을 가지런히 펼쳐 놓으니 색이 예뻐서 한참 봤다.",
    expected: [{ name: "색연필", category: "사물" }],
  },
  {
    memo: "빈 스케치북 첫 장을 펼치니 뭔가 시작하는 기분이 들었다.",
    expected: [{ name: "스케치북", category: "사물" }],
  },
  {
    memo: "여행지에서 산 엽서를 책상에 세워두니 풍경이 떠올랐다.",
    expected: [{ name: "엽서", category: "사물" }],
  },
  {
    memo: "서랍에서 오래된 우표를 발견하고 한참 들여다봤다.",
    expected: [{ name: "우표", category: "사물" }],
  },
  {
    memo: "가방에 새 키링을 달았더니 작은 변화인데도 마음에 들었다.",
    expected: [{ name: "키링", category: "사물" }],
  },
  {
    memo: "새 에코백을 들고 장을 보러 가니 가볍고 편했다.",
    expected: [{ name: "에코백", category: "사물" }],
  },
  {
    memo: "오래 쓰던 백팩을 정리하다 여행표를 발견했다.",
    expected: [{ name: "백팩", category: "사물" }],
  },
  {
    memo: "햇빛 좋은 날 좋아하는 모자를 쓰고 나갔다.",
    expected: [{ name: "모자", category: "사물" }],
  },
  {
    memo: "추운 아침 부드러운 목도리를 두르니 금방 따뜻해졌다.",
    expected: [{ name: "목도리", category: "사물" }],
  },
  {
    memo: "눈 오는 날 새 장갑을 끼니 손이 따뜻했다.",
    expected: [{ name: "장갑", category: "사물" }],
  },
  {
    memo: "새 운동화를 신고 처음 걸었는데 발이 편했다.",
    expected: [{ name: "운동화", category: "사물" }],
  },
  {
    memo: "집에서 푹신한 슬리퍼를 신으니 발이 편안했다.",
    expected: [{ name: "슬리퍼", category: "사물" }],
  },
  {
    memo: "오래된 시계를 닦다가 작은 흠집들이 눈에 들어왔다.",
    expected: [{ name: "시계", category: "사물" }],
  },
  {
    memo: "새 안경을 쓰니 세상이 더 선명하게 보여 신기했다.",
    expected: [{ name: "안경", category: "사물" }],
  },
  {
    memo: "좋아하는 헤드폰을 쓰고 음악을 들으니 주변이 조용해졌다.",
    expected: [{ name: "헤드폰", category: "사물" }],
  },
  {
    memo: "새 이어폰으로 처음 음악을 들었는데 소리가 또렷했다.",
    expected: [{ name: "이어폰", category: "사물" }],
  },
  {
    memo: "작은 스피커로 음악을 틀어놓으니 방 분위기가 달라졌다.",
    expected: [{ name: "스피커", category: "사물" }],
  },
  {
    memo: "턴테이블에 음반을 올리고 천천히 돌아가는 걸 바라봤다.",
    expected: [{ name: "턴테이블", category: "사물" }],
  },
  {
    memo: "폴라로이드 카메라로 찍은 사진이 바로 나와서 신기했다.",
    expected: [{ name: "폴라로이드 카메라", category: "사물" }],
  },
  {
    memo: "오래된 사진앨범을 펼치니 잊고 있던 장면들이 떠올랐다.",
    expected: [{ name: "사진앨범", category: "사물" }],
  },
  {
    memo: "책상 위 작은 액자 속 사진을 보며 잠깐 웃었다.",
    expected: [{ name: "액자", category: "사물" }],
  },
  {
    memo: "밤에 스탠드 조명만 켜두니 방이 아늑해졌다.",
    expected: [{ name: "스탠드 조명", category: "사물" }],
  },
  {
    memo: "저녁에 캔들을 켜두니 작은 불빛이 편안했다.",
    expected: [{ name: "캔들", category: "사물" }],
  },
  {
    memo: "창가 화병에 꽃을 꽂아두니 방이 화사해졌다.",
    expected: [{ name: "화병", category: "사물" }],
  },
  {
    memo: "새 쿠션을 소파에 놓으니 거실 분위기가 달라졌다.",
    expected: [{ name: "쿠션", category: "사물" }],
  },
  {
    memo: "쌀쌀한 밤 담요를 덮으니 금방 따뜻해졌다.",
    expected: [{ name: "담요", category: "사물" }],
  },
  {
    memo: "책 사이에서 예전에 쓰던 책갈피를 발견했다.",
    expected: [{ name: "책갈피", category: "사물" }],
  },
  {
    memo: "낡은 필통을 정리하다 오래된 메모를 발견했다.",
    expected: [{ name: "필통", category: "사물" }],
  },
  {
    memo: "오랜만에 만년필로 편지를 쓰니 글씨를 천천히 쓰게 됐다.",
    expected: [{ name: "만년필", category: "사물" }],
  },
  {
    memo: "서랍 속 USB를 정리하다 예전 사진 파일을 발견했다.",
    expected: [{ name: "USB", category: "사물" }],
  },
  {
    memo: "오래된 게임기를 켜보니 예전 화면이 그대로 떠서 반가웠다.",
    expected: [{ name: "게임기", category: "사물" }],
  },
  {
    memo: "주말에 퍼즐 조각을 하나씩 맞추다 보니 시간이 금방 갔다.",
    expected: [{ name: "퍼즐", category: "사물" }],
  },
  {
    memo: "오르골을 돌렸더니 익숙한 멜로디가 흘러나왔다.",
    expected: [{ name: "오르골", category: "사물" }],
  },
  {
    memo: "햇빛을 받은 유리병이 반짝여서 예뻤다.",
    expected: [{ name: "유리병", category: "사물" }],
  },
  {
    memo: "직접 산 도자기 컵에 커피를 마시니 손에 닿는 느낌이 좋았다.",
    expected: [{ name: "도자기 컵", category: "사물" }],
  },
  {
    memo: "작은 바구니에 물건을 정리해두니 책상이 깔끔해졌다.",
    expected: [{ name: "바구니", category: "사물" }],
  },
  {
    memo: "갑자기 비가 와서 좋아하는 우산을 꺼내 썼다.",
    expected: [{ name: "우산", category: "사물" }],
  },
  {
    memo: "오래된 손거울을 닦으니 다시 반짝였다.",
    expected: [{ name: "손거울", category: "사물" }],
  },
  {
    memo: "나무 빗으로 머리를 빗으니 촉감이 부드러웠다.",
    expected: [{ name: "빗", category: "사물" }],
  },
  {
    memo: "예전 향수병을 발견하고 모양을 한참 바라봤다.",
    expected: [{ name: "향수병", category: "사물" }],
  },
  {
    memo: "오래된 라디오를 켜니 익숙한 잡음과 함께 방송이 나왔다.",
    expected: [{ name: "라디오", category: "사물" }],
  },
  {
    memo: "주전자에 물이 끓는 모습을 보며 차를 준비했다.",
    expected: [{ name: "주전자", category: "사물" }],
  },
  {
    memo: "예쁜 도시락통에 점심을 담으니 괜히 기대됐다.",
    expected: [{ name: "도시락통", category: "사물" }],
  },
  {
    memo: "등산길에 보온병을 열어 따뜻한 차를 마셨다.",
    expected: [{ name: "보온병", category: "사물" }],
  },
  {
    memo: "캠핑 밤에 랜턴을 켜니 텐트 주변이 환해졌다.",
    expected: [{ name: "랜턴", category: "사물" }],
  },

  // --- 추가 동물 (50) ---
  {
    memo: "산책길에서 작은 고슴도치를 보고 조심히 지나갔다.",
    expected: [{ name: "고슴도치", category: "동물" }],
  },
  {
    memo: "풀밭에서 토끼가 뛰어가는 모습을 보고 한참 바라봤다.",
    expected: [{ name: "토끼", category: "동물" }],
  },
  {
    memo: "공원에서 다람쥐가 나무를 오르는 걸 보고 웃었다.",
    expected: [{ name: "다람쥐", category: "동물" }],
  },
  {
    memo: "산길에서 청설모가 빠르게 지나가는 모습을 봤다.",
    expected: [{ name: "청설모", category: "동물" }],
  },
  {
    memo: "숲 가장자리에서 사슴을 발견하고 조용히 바라봤다.",
    expected: [{ name: "사슴", category: "동물" }],
  },
  {
    memo: "목장에서 알파카가 천천히 다가와서 신기했다.",
    expected: [{ name: "알파카", category: "동물" }],
  },
  {
    memo: "넓은 초원에서 양들이 모여 있는 모습이 평화로웠다.",
    expected: [{ name: "양", category: "동물" }],
  },
  {
    memo: "농장에서 염소가 울타리 너머로 얼굴을 내밀었다.",
    expected: [{ name: "염소", category: "동물" }],
  },
  {
    memo: "승마장에서 말이 천천히 걷는 모습을 보니 멋있었다.",
    expected: [{ name: "말", category: "동물" }],
  },
  {
    memo: "목장에서 젖소들이 풀을 뜯는 모습을 한참 구경했다.",
    expected: [{ name: "젖소", category: "동물" }],
  },
  {
    memo: "수족관에서 수달이 물속을 빠르게 헤엄치는 게 귀여웠다.",
    expected: [{ name: "수달", category: "동물" }],
  },
  {
    memo: "해달이 물 위에 누워 떠 있는 모습을 보고 웃었다.",
    expected: [{ name: "해달", category: "동물" }],
  },
  {
    memo: "물개가 물속으로 미끄러지듯 들어가는 모습이 재미있었다.",
    expected: [{ name: "물개", category: "동물" }],
  },
  {
    memo: "펭귄들이 줄지어 걷는 모습을 보고 한참 웃었다.",
    expected: [{ name: "펭귄", category: "동물" }],
  },
  {
    memo: "바다에서 돌고래가 수면 위로 올라오는 걸 처음 봤다.",
    expected: [{ name: "돌고래", category: "동물" }],
  },
  {
    memo: "멀리서 고래가 숨을 내뿜는 모습을 보고 감탄했다.",
    expected: [{ name: "고래", category: "동물" }],
  },
  {
    memo: "아쿠아리움에서 상어가 천천히 지나가는 모습이 인상적이었다.",
    expected: [{ name: "상어", category: "동물" }],
  },
  {
    memo: "조명 아래 해파리가 천천히 움직이는 모습이 아름다웠다.",
    expected: [{ name: "해파리", category: "동물" }],
  },
  {
    memo: "작은 연못의 금붕어들이 몰려다니는 걸 구경했다.",
    expected: [{ name: "금붕어", category: "동물" }],
  },
  {
    memo: "연못에서 큰 잉어가 천천히 헤엄치는 걸 봤다.",
    expected: [{ name: "잉어", category: "동물" }],
  },
  {
    memo: "거북이가 바위 위에서 햇빛을 쬐는 모습이 귀여웠다.",
    expected: [{ name: "거북이", category: "동물" }],
  },
  {
    memo: "비 온 뒤 길가에서 작은 개구리를 발견했다.",
    expected: [{ name: "개구리", category: "동물" }],
  },
  {
    memo: "따뜻한 돌 위에 앉아 있는 도마뱀을 보고 신기했다.",
    expected: [{ name: "도마뱀", category: "동물" }],
  },
  {
    memo: "비 오는 날 벽을 천천히 올라가는 달팽이를 봤다.",
    expected: [{ name: "달팽이", category: "동물" }],
  },
  {
    memo: "꽃밭에서 나비가 이 꽃 저 꽃 옮겨 다니는 걸 바라봤다.",
    expected: [{ name: "나비", category: "동물" }],
  },
  {
    memo: "가을 하늘에 잠자리가 많이 날아다니는 게 반가웠다.",
    expected: [{ name: "잠자리", category: "동물" }],
  },
  {
    memo: "잎 위에 앉은 무당벌레를 발견하고 사진을 찍었다.",
    expected: [{ name: "무당벌레", category: "동물" }],
  },
  {
    memo: "꽃 주변을 바쁘게 오가는 벌을 한참 바라봤다.",
    expected: [{ name: "벌", category: "동물" }],
  },
  {
    memo: "창가에 앉은 참새가 고개를 갸웃거리는 모습이 귀여웠다.",
    expected: [{ name: "참새", category: "동물" }],
  },
  {
    memo: "광장에서 비둘기들이 한꺼번에 날아오르는 모습을 봤다.",
    expected: [{ name: "비둘기", category: "동물" }],
  },
  {
    memo: "아침에 창밖 나무에 앉은 까치를 보고 하루를 시작했다.",
    expected: [{ name: "까치", category: "동물" }],
  },
  {
    memo: "해 질 무렵 까마귀들이 하늘을 가로질러 날아갔다.",
    expected: [{ name: "까마귀", category: "동물" }],
  },
  {
    memo: "봄에 돌아온 제비가 처마 근처를 날아다니는 걸 봤다.",
    expected: [{ name: "제비", category: "동물" }],
  },
  {
    memo: "밤 숲에서 부엉이를 발견하고 조용히 바라봤다.",
    expected: [{ name: "부엉이", category: "동물" }],
  },
  {
    memo: "동물원에서 큰 눈의 올빼미가 가만히 앉아 있었다.",
    expected: [{ name: "올빼미", category: "동물" }],
  },
  {
    memo: "앵무새가 짧은 말을 따라 하는 걸 듣고 웃었다.",
    expected: [{ name: "앵무새", category: "동물" }],
  },
  {
    memo: "작은 카나리아가 맑게 우는 소리를 들었다.",
    expected: [{ name: "카나리아", category: "동물" }],
  },
  {
    memo: "연못에서 오리들이 줄지어 헤엄치는 모습이 귀여웠다.",
    expected: [{ name: "오리", category: "동물" }],
  },
  {
    memo: "호수 위를 천천히 움직이는 백조가 우아해 보였다.",
    expected: [{ name: "백조", category: "동물" }],
  },
  {
    memo: "하늘을 줄지어 날아가는 기러기를 올려다봤다.",
    expected: [{ name: "기러기", category: "동물" }],
  },
  {
    memo: "공원에서 만난 강아지가 꼬리를 흔들며 다가왔다.",
    expected: [{ name: "강아지", category: "동물" }],
  },
  {
    memo: "골목 고양이가 햇볕 아래 몸을 말고 자고 있었다.",
    expected: [{ name: "고양이", category: "동물" }],
  },
  {
    memo: "마당의 진돗개가 반갑게 달려와 꼬리를 흔들었다.",
    expected: [{ name: "진돗개", category: "동물" }],
  },
  {
    memo: "작은 푸들이 산책하며 통통 뛰는 모습이 귀여웠다.",
    expected: [{ name: "푸들", category: "동물" }],
  },
  {
    memo: "웰시코기가 짧은 다리로 뛰어가는 모습을 보고 웃었다.",
    expected: [{ name: "웰시코기", category: "동물" }],
  },
  {
    memo: "햄스터가 볼에 먹이를 가득 넣는 모습이 귀여웠다.",
    expected: [{ name: "햄스터", category: "동물" }],
  },
  {
    memo: "기니피그가 건초를 먹는 모습을 조용히 구경했다.",
    expected: [{ name: "기니피그", category: "동물" }],
  },
  {
    memo: "친칠라가 털을 부풀리고 앉아 있는 모습이 신기했다.",
    expected: [{ name: "친칠라", category: "동물" }],
  },
  {
    memo: "미어캣이 두 발로 서서 주변을 살피는 모습이 재미있었다.",
    expected: [{ name: "미어캣", category: "동물" }],
  },
  {
    memo: "라쿤이 앞발로 먹이를 만지작거리는 모습을 봤다.",
    expected: [{ name: "라쿤", category: "동물" }],
  },

  // --- 추가 활동 (50) ---
  {
    memo: "아침에 러닝을 하고 나니 머리가 맑아졌다.",
    expected: [{ name: "러닝", category: "활동" }],
  },
  {
    memo: "주말에 등산을 해서 정상까지 올라가니 뿌듯했다.",
    expected: [{ name: "등산", category: "활동" }],
  },
  {
    memo: "숲길에서 트레킹을 하며 천천히 풍경을 즐겼다.",
    expected: [{ name: "트레킹", category: "활동" }],
  },
  {
    memo: "저녁에 동네 산책을 하니 하루가 차분하게 마무리됐다.",
    expected: [{ name: "산책", category: "활동" }],
  },
  {
    memo: "오랜만에 수영을 하고 나니 온몸이 개운했다.",
    expected: [{ name: "수영", category: "활동" }],
  },
  {
    memo: "아침 요가를 마치고 나니 몸이 한결 가벼웠다.",
    expected: [{ name: "요가", category: "활동" }],
  },
  {
    memo: "처음 해본 필라테스 동작을 끝내고 성취감이 들었다.",
    expected: [{ name: "필라테스", category: "활동" }],
  },
  {
    memo: "클라이밍 코스를 끝까지 올라가서 기분이 좋았다.",
    expected: [{ name: "클라이밍", category: "활동" }],
  },
  {
    memo: "친구들과 볼링을 치며 점수를 겨루는 게 재미있었다.",
    expected: [{ name: "볼링", category: "활동" }],
  },
  {
    memo: "저녁에 배드민턴을 치고 땀을 빼니 개운했다.",
    expected: [{ name: "배드민턴", category: "활동" }],
  },
  {
    memo: "주말 아침 테니스를 치며 오래 움직였다.",
    expected: [{ name: "테니스", category: "활동" }],
  },
  {
    memo: "점심시간에 탁구를 치며 잠깐 기분 전환을 했다.",
    expected: [{ name: "탁구", category: "활동" }],
  },
  {
    memo: "오랜만에 농구를 하며 땀을 잔뜩 흘렸다.",
    expected: [{ name: "농구", category: "활동" }],
  },
  {
    memo: "친구들과 축구를 하고 나니 다리가 아팠지만 즐거웠다.",
    expected: [{ name: "축구", category: "활동" }],
  },
  {
    memo: "집 앞에서 줄넘기를 하며 오래간만에 몸을 움직였다.",
    expected: [{ name: "줄넘기", category: "활동" }],
  },
  {
    memo: "강변에서 자전거를 타며 시원한 바람을 맞았다.",
    expected: [{ name: "자전거", category: "활동" }],
  },
  {
    memo: "처음 롤러스케이트를 타고 천천히 한 바퀴 돌았다.",
    expected: [{ name: "롤러스케이트", category: "활동" }],
  },
  {
    memo: "공원에서 스케이트보드를 연습하다 처음으로 균형을 잡았다.",
    expected: [{ name: "스케이트보드", category: "활동" }],
  },
  {
    memo: "겨울에 스키를 타고 긴 슬로프를 내려오니 짜릿했다.",
    expected: [{ name: "스키", category: "활동" }],
  },
  {
    memo: "처음 스노보드로 턴에 성공해서 정말 뿌듯했다.",
    expected: [{ name: "스노보드", category: "활동" }],
  },
  {
    memo: "바다에서 서핑을 하다가 처음으로 파도를 제대로 탔다.",
    expected: [{ name: "서핑", category: "활동" }],
  },
  {
    memo: "잔잔한 호수에서 카약을 타며 천천히 노를 저었다.",
    expected: [{ name: "카약", category: "활동" }],
  },
  {
    memo: "아침 일찍 낚시를 하며 조용히 물을 바라봤다.",
    expected: [{ name: "낚시", category: "활동" }],
  },
  {
    memo: "주말에 캠핑을 하며 밤늦게까지 밖에서 시간을 보냈다.",
    expected: [{ name: "캠핑", category: "활동" }],
  },
  {
    memo: "잔디밭에서 피크닉을 하며 느긋한 오후를 보냈다.",
    expected: [{ name: "피크닉", category: "활동" }],
  },
  {
    memo: "카페에서 독서를 하며 한 챕터를 끝까지 읽었다.",
    expected: [{ name: "독서", category: "활동" }],
  },
  {
    memo: "밤에 조용히 글쓰기를 하며 생각을 정리했다.",
    expected: [{ name: "글쓰기", category: "활동" }],
  },
  {
    memo: "오랜만에 일기 쓰기를 하며 하루를 돌아봤다.",
    expected: [{ name: "일기 쓰기", category: "활동" }],
  },
  {
    memo: "주말에 드로잉을 하며 좋아하는 풍경을 그렸다.",
    expected: [{ name: "드로잉", category: "활동" }],
  },
  {
    memo: "처음 수채화를 그려봤는데 색이 번지는 게 재미있었다.",
    expected: [{ name: "수채화", category: "활동" }],
  },
  {
    memo: "도예 수업에서 작은 그릇 하나를 완성했다.",
    expected: [{ name: "도예", category: "활동" }],
  },
  {
    memo: "저녁에 뜨개질을 하며 목도리를 조금 더 완성했다.",
    expected: [{ name: "뜨개질", category: "활동" }],
  },
  {
    memo: "천에 자수를 놓으며 작은 무늬를 완성했다.",
    expected: [{ name: "자수", category: "활동" }],
  },
  {
    memo: "주말에 베이킹을 해서 쿠키를 구웠다.",
    expected: [{ name: "베이킹", category: "활동" }],
  },
  {
    memo: "처음 보는 레시피로 요리를 해봤는데 생각보다 잘 됐다.",
    expected: [{ name: "요리", category: "활동" }],
  },
  {
    memo: "해 질 무렵 사진 촬영을 하며 골목을 돌아다녔다.",
    expected: [{ name: "사진 촬영", category: "활동" }],
  },
  {
    memo: "오랜만에 피아노 연주를 하니 손이 조금씩 기억을 찾았다.",
    expected: [{ name: "피아노 연주", category: "활동" }],
  },
  {
    memo: "저녁에 기타 연주를 하며 좋아하는 곡을 끝까지 쳤다.",
    expected: [{ name: "기타 연주", category: "활동" }],
  },
  {
    memo: "혼자 방에서 노래를 부르며 스트레스를 풀었다.",
    expected: [{ name: "노래", category: "활동" }],
  },
  {
    memo: "좋아하는 음악을 틀고 춤을 추니 기분이 한결 나아졌다.",
    expected: [{ name: "춤", category: "활동" }],
  },
  {
    memo: "친구들과 보드게임을 하며 시간 가는 줄 몰랐다.",
    expected: [{ name: "보드게임", category: "활동" }],
  },
  {
    memo: "저녁 내내 퍼즐 맞추기를 하다가 마지막 조각을 끼웠다.",
    expected: [{ name: "퍼즐 맞추기", category: "활동" }],
  },
  {
    memo: "주말에 게임을 하며 어려운 스테이지를 드디어 깼다.",
    expected: [{ name: "게임", category: "활동" }],
  },
  {
    memo: "집에서 영화 감상을 하며 오랜만에 푹 쉬었다.",
    expected: [{ name: "영화 감상", category: "활동" }],
  },
  {
    memo: "휴일에 전시 관람을 하며 천천히 작품을 둘러봤다.",
    expected: [{ name: "전시 관람", category: "활동" }],
  },
  {
    memo: "기대하던 뮤지컬 관람을 마치고 한동안 여운이 남았다.",
    expected: [{ name: "뮤지컬 관람", category: "활동" }],
  },
  {
    memo: "혼자 여행을 떠나 낯선 동네를 하루 종일 돌아다녔다.",
    expected: [{ name: "여행", category: "활동" }],
  },
  {
    memo: "밤에 드라이브를 하며 좋아하는 음악을 들었다.",
    expected: [{ name: "드라이브", category: "활동" }],
  },
  {
    memo: "아침에 플로깅을 하며 동네 골목을 한 바퀴 돌았다.",
    expected: [{ name: "플로깅", category: "활동" }],
  },
  {
    memo: "잠들기 전에 명상을 하니 머릿속이 조금 조용해졌다.",
    expected: [{ name: "명상", category: "활동" }],
  },

  // --- 추가 복합 (50) ---
  {
    memo: "아침 공원 벤치에서 따뜻한 카페라떼를 마시며 책을 읽었다.",
    expected: [
      { name: "공원", category: "장소" },
      { name: "카페라떼", category: "음식" },
      { name: "책", category: "사물" },
    ],
  },
  {
    memo: "해변에서 조개껍데기를 주워 작은 유리병에 담아 왔다.",
    expected: [
      { name: "해변", category: "장소" },
      { name: "조개껍데기", category: "자연" },
      { name: "유리병", category: "사물" },
    ],
  },
  {
    memo: "캠핑장에서 랜턴을 켜고 별을 보며 따뜻한 코코아를 마셨다.",
    expected: [
      { name: "캠핑장", category: "장소" },
      { name: "랜턴", category: "사물" },
      { name: "별", category: "자연" },
      { name: "코코아", category: "음식" },
    ],
  },
  {
    memo: "한옥마을을 걷다가 작은 찻집에서 유자차를 마셨다.",
    expected: [
      { name: "한옥마을", category: "장소" },
      { name: "찻집", category: "장소" },
      { name: "유자차", category: "음식" },
    ],
  },
  {
    memo: "산책로에서 강아지와 걷다가 노을을 한참 바라봤다.",
    expected: [
      { name: "산책로", category: "장소" },
      { name: "강아지", category: "동물" },
      { name: "노을", category: "자연" },
    ],
  },
  {
    memo: "동물원에서 펭귄을 보고 기념품으로 작은 키링을 샀다.",
    expected: [
      { name: "동물원", category: "장소" },
      { name: "펭귄", category: "동물" },
      { name: "키링", category: "사물" },
    ],
  },
  {
    memo: "수목원에서 수국을 구경하고 벤치에 앉아 샌드위치를 먹었다.",
    expected: [
      { name: "수목원", category: "장소" },
      { name: "수국", category: "자연" },
      { name: "벤치", category: "사물" },
      { name: "샌드위치", category: "음식" },
    ],
  },
  {
    memo: "서점에서 에세이를 한 권 사고 근처 카페에서 라떼를 마셨다.",
    expected: [
      { name: "서점", category: "장소" },
      { name: "에세이", category: "사물" },
      { name: "카페", category: "장소" },
      { name: "라떼", category: "음식" },
    ],
  },
  {
    memo: "비 오는 날 노란 우산을 쓰고 분식집에서 떡볶이를 먹었다.",
    expected: [
      { name: "노란 우산", category: "사물" },
      { name: "분식집", category: "장소" },
      { name: "떡볶이", category: "음식" },
    ],
  },
  {
    memo: "꽃시장에서 튤립을 사고 집에 와서 화병에 꽂아뒀다.",
    expected: [
      { name: "꽃시장", category: "장소" },
      { name: "튤립", category: "자연" },
      { name: "화병", category: "사물" },
    ],
  },
  {
    memo: "아침에 자전거를 타고 강변공원까지 가서 물을 마셨다.",
    expected: [
      { name: "자전거", category: "활동" },
      { name: "강변공원", category: "장소" },
      { name: "물", category: "음식" },
    ],
  },
  {
    memo: "도예공방에서 도예를 하고 직접 만든 머그컵을 가져왔다.",
    expected: [
      { name: "도예공방", category: "장소" },
      { name: "도예", category: "활동" },
      { name: "머그컵", category: "사물" },
    ],
  },
  {
    memo: "바닷가에서 서핑을 하고 해 질 무렵 노을을 봤다.",
    expected: [
      { name: "바닷가", category: "장소" },
      { name: "서핑", category: "활동" },
      { name: "노을", category: "자연" },
    ],
  },
  {
    memo: "미술관에서 전시 관람을 하고 엽서 한 장을 샀다.",
    expected: [
      { name: "미술관", category: "장소" },
      { name: "전시 관람", category: "활동" },
      { name: "엽서", category: "사물" },
    ],
  },
  {
    memo: "공원에서 피크닉을 하며 딸기와 샌드위치를 나눠 먹었다.",
    expected: [
      { name: "공원", category: "장소" },
      { name: "피크닉", category: "활동" },
      { name: "딸기", category: "음식" },
      { name: "샌드위치", category: "음식" },
    ],
  },
  {
    memo: "숲길을 트레킹하다가 다람쥐와 솔방울을 발견했다.",
    expected: [
      { name: "숲길", category: "장소" },
      { name: "트레킹", category: "활동" },
      { name: "다람쥐", category: "동물" },
      { name: "솔방울", category: "자연" },
    ],
  },
  {
    memo: "호숫가에서 카약을 타다가 백조가 지나가는 걸 봤다.",
    expected: [
      { name: "호숫가", category: "장소" },
      { name: "카약", category: "활동" },
      { name: "백조", category: "동물" },
    ],
  },
  {
    memo: "기차역에서 붕어빵을 사 먹으며 여행을 시작했다.",
    expected: [
      { name: "기차역", category: "장소" },
      { name: "붕어빵", category: "음식" },
      { name: "여행", category: "활동" },
    ],
  },
  {
    memo: "정원에서 장미를 보고 폴라로이드 카메라로 사진을 찍었다.",
    expected: [
      { name: "정원", category: "장소" },
      { name: "장미", category: "자연" },
      { name: "폴라로이드 카메라", category: "사물" },
      { name: "사진 촬영", category: "활동" },
    ],
  },
  {
    memo: "야시장에서 닭강정을 먹고 작은 에코백도 하나 샀다.",
    expected: [
      { name: "야시장", category: "장소" },
      { name: "닭강정", category: "음식" },
      { name: "에코백", category: "사물" },
    ],
  },
  {
    memo: "수영장에서 수영을 마치고 따뜻한 유자차를 마셨다.",
    expected: [
      { name: "수영장", category: "장소" },
      { name: "수영", category: "활동" },
      { name: "유자차", category: "음식" },
    ],
  },
  {
    memo: "산 정상에서 보온병에 담아온 녹차를 마시며 구름을 봤다.",
    expected: [
      { name: "산 정상", category: "장소" },
      { name: "보온병", category: "사물" },
      { name: "녹차", category: "음식" },
      { name: "구름", category: "자연" },
    ],
  },
  {
    memo: "사진관에서 가족사진을 찍고 작은 액자를 골랐다.",
    expected: [
      { name: "사진관", category: "장소" },
      { name: "액자", category: "사물" },
    ],
  },
  {
    memo: "오래된 골목에서 고양이를 만나 사진을 한 장 찍었다.",
    expected: [
      { name: "골목", category: "장소" },
      { name: "고양이", category: "동물" },
      { name: "사진 촬영", category: "활동" },
    ],
  },
  {
    memo: "루프탑에서 치즈케이크를 먹으며 보름달을 바라봤다.",
    expected: [
      { name: "루프탑", category: "장소" },
      { name: "치즈케이크", category: "음식" },
      { name: "보름달", category: "자연" },
    ],
  },
  {
    memo: "계곡에서 물놀이를 하고 수박을 잘라 먹었다.",
    expected: [
      { name: "계곡", category: "장소" },
      { name: "물놀이", category: "활동" },
      { name: "수박", category: "음식" },
    ],
  },
  {
    memo: "사찰 근처 숲길을 걷다가 작은 개구리를 발견했다.",
    expected: [
      { name: "사찰", category: "장소" },
      { name: "숲길", category: "장소" },
      { name: "개구리", category: "동물" },
    ],
  },
  {
    memo: "레코드숍에서 LP판을 사고 집에 와서 턴테이블에 올렸다.",
    expected: [
      { name: "레코드숍", category: "장소" },
      { name: "LP판", category: "사물" },
      { name: "턴테이블", category: "사물" },
    ],
  },
  {
    memo: "동네 공방에서 자수를 배우고 작은 손거울을 꾸몄다.",
    expected: [
      { name: "공방", category: "장소" },
      { name: "자수", category: "활동" },
      { name: "손거울", category: "사물" },
    ],
  },
  {
    memo: "천문대에서 별자리를 보고 따뜻한 코코아를 마셨다.",
    expected: [
      { name: "천문대", category: "장소" },
      { name: "별자리", category: "자연" },
      { name: "코코아", category: "음식" },
    ],
  },
  {
    memo: "놀이터 그네에 앉아 아이스크림을 먹으며 노을을 봤다.",
    expected: [
      { name: "놀이터", category: "장소" },
      { name: "그네", category: "사물" },
      { name: "아이스크림", category: "음식" },
      { name: "노을", category: "자연" },
    ],
  },
  {
    memo: "캠퍼스를 산책하다가 벚꽃잎이 떨어지는 걸 사진으로 남겼다.",
    expected: [
      { name: "캠퍼스", category: "장소" },
      { name: "산책", category: "활동" },
      { name: "벚꽃잎", category: "자연" },
      { name: "사진 촬영", category: "활동" },
    ],
  },
  {
    memo: "빵집에서 소금빵을 사고 근처 벤치에서 먹었다.",
    expected: [
      { name: "빵집", category: "장소" },
      { name: "소금빵", category: "음식" },
      { name: "벤치", category: "사물" },
    ],
  },
  {
    memo: "아쿠아리움에서 해파리와 수달을 한참 구경했다.",
    expected: [
      { name: "아쿠아리움", category: "장소" },
      { name: "해파리", category: "동물" },
      { name: "수달", category: "동물" },
    ],
  },
  {
    memo: "한강공원에서 러닝을 한 뒤 아이스아메리카노를 마셨다.",
    expected: [
      { name: "한강공원", category: "장소" },
      { name: "러닝", category: "활동" },
      { name: "아이스아메리카노", category: "음식" },
    ],
  },
  {
    memo: "박물관에서 오래된 도자기를 보고 기념 엽서를 샀다.",
    expected: [
      { name: "박물관", category: "장소" },
      { name: "도자기", category: "사물" },
      { name: "엽서", category: "사물" },
    ],
  },
  {
    memo: "해 질 무렵 항구에서 갈매기를 보며 어묵을 먹었다.",
    expected: [
      { name: "항구", category: "장소" },
      { name: "갈매기", category: "동물" },
      { name: "어묵", category: "음식" },
    ],
  },
  {
    memo: "꽃집에서 수국을 사고 집에 와서 새 화병에 꽂았다.",
    expected: [
      { name: "꽃집", category: "장소" },
      { name: "수국", category: "자연" },
      { name: "화병", category: "사물" },
    ],
  },
  {
    memo: "체육관에서 배드민턴을 치고 물을 한 병 마셨다.",
    expected: [
      { name: "체육관", category: "장소" },
      { name: "배드민턴", category: "활동" },
      { name: "물", category: "음식" },
    ],
  },
  {
    memo: "독립서점에서 책을 산 뒤 북카페에서 독서를 했다.",
    expected: [
      { name: "독립서점", category: "장소" },
      { name: "책", category: "사물" },
      { name: "북카페", category: "장소" },
      { name: "독서", category: "활동" },
    ],
  },
  {
    memo: "겨울 해변에서 목도리를 두르고 파도를 한참 바라봤다.",
    expected: [
      { name: "해변", category: "장소" },
      { name: "목도리", category: "사물" },
      { name: "파도", category: "자연" },
    ],
  },
  {
    memo: "봄날 정원에서 나비와 튤립을 보며 산책했다.",
    expected: [
      { name: "정원", category: "장소" },
      { name: "나비", category: "동물" },
      { name: "튤립", category: "자연" },
      { name: "산책", category: "활동" },
    ],
  },
  {
    memo: "온천에서 설경을 바라본 뒤 따뜻한 녹차를 마셨다.",
    expected: [
      { name: "온천", category: "장소" },
      { name: "설경", category: "자연" },
      { name: "녹차", category: "음식" },
    ],
  },
  {
    memo: "야외 테라스에서 파스타를 먹는데 참새가 가까이 날아왔다.",
    expected: [
      { name: "테라스", category: "장소" },
      { name: "파스타", category: "음식" },
      { name: "참새", category: "동물" },
    ],
  },
  {
    memo: "공항에서 여행을 시작하며 새 백팩과 여권지갑을 꺼냈다.",
    expected: [
      { name: "공항", category: "장소" },
      { name: "여행", category: "활동" },
      { name: "백팩", category: "사물" },
      { name: "여권지갑", category: "사물" },
    ],
  },
  {
    memo: "산책길에서 민들레와 무당벌레를 발견하고 사진을 찍었다.",
    expected: [
      { name: "산책길", category: "장소" },
      { name: "민들레", category: "자연" },
      { name: "무당벌레", category: "동물" },
      { name: "사진 촬영", category: "활동" },
    ],
  },
  {
    memo: "캠핑장에서 베이킹으로 만든 쿠키를 먹으며 랜턴 불빛을 봤다.",
    expected: [
      { name: "캠핑장", category: "장소" },
      { name: "베이킹", category: "활동" },
      { name: "쿠키", category: "음식" },
      { name: "랜턴", category: "사물" },
    ],
  },
  {
    memo: "미술관 카페에서 전시 관람 후 티라미수와 커피를 먹었다.",
    expected: [
      { name: "미술관", category: "장소" },
      { name: "전시 관람", category: "활동" },
      { name: "티라미수", category: "음식" },
      { name: "커피", category: "음식" },
    ],
  },
  {
    memo: "호수 전망대에서 보름달과 물결을 바라보며 담요를 덮었다.",
    expected: [
      { name: "전망대", category: "장소" },
      { name: "보름달", category: "자연" },
      { name: "물결", category: "자연" },
      { name: "담요", category: "사물" },
    ],
  },
  {
    memo: "재래시장에서 만두와 식혜를 사 먹고 에코백에 장을 담았다.",
    expected: [
      { name: "재래시장", category: "장소" },
      { name: "만두", category: "음식" },
      { name: "식혜", category: "음식" },
      { name: "에코백", category: "사물" },
    ],
  },

  // --- 추가 엣지 케이스 (50) ---
  // 사람/감정/감각/일반 상태만 있고 수집할 만한 아이템이 없는 문장.
  { memo: "오늘은 그냥 기분이 편안했고 특별히 떠오르는 건 없었다.", expected: [] },
  { memo: "친구와 오래 이야기했는데 내용보다 함께 있다는 느낌이 좋았다.", expected: [] },
  { memo: "엄마와 전화하면서 별 얘기 없이 웃기만 했는데 마음이 놓였다.", expected: [] },
  { memo: "오랜만에 푹 자고 일어나니 이유 없이 개운했다.", expected: [] },
  { memo: "하루 종일 멍하니 쉬었는데 이상하게 마음이 편했다.", expected: [] },
  { memo: "그냥 조용히 앉아 시간을 보내는 게 좋았다.", expected: [] },
  { memo: "오늘은 별일 없이 지나갔는데 기분이 나쁘지 않았다.", expected: [] },
  { memo: "아무 계획 없이 느긋하게 보낸 오후가 마음에 들었다.", expected: [] },
  { memo: "오랜만에 아무 생각도 하지 않고 쉬어서 좋았다.", expected: [] },
  { memo: "왠지 모르게 하루 종일 기분이 가벼웠다.", expected: [] },
  { memo: "친구가 내 얘기를 오래 들어줘서 고마운 마음이 들었다.", expected: [] },
  { memo: "할머니와 손을 잡고 잠깐 앉아 있었는데 마음이 따뜻했다.", expected: [] },
  { memo: "동생이 장난을 쳐서 한참 웃었는데 그게 좋았다.", expected: [] },
  { memo: "아빠와 별 말 없이 같이 있으니 괜히 편했다.", expected: [] },
  { memo: "오랜만에 친구를 만나 수다를 떨며 시간을 보냈다.", expected: [] },
  { memo: "친구와 밤늦게까지 통화했는데 시간이 금방 갔다.", expected: [] },
  { memo: "가족들과 둘러앉아 이런저런 이야기를 나눴다.", expected: [] },
  { memo: "친한 사람과 오랜만에 만나 안부를 물으니 반가웠다.", expected: [] },
  { memo: "조카가 내 이름을 불러줘서 괜히 울컥했다.", expected: [] },
  { memo: "친구가 안아줘서 마음이 조금 놓였다.", expected: [] },
  { memo: "오늘따라 공기가 선선하게 느껴져서 기분이 좋았다.", expected: [] },
  { memo: "따뜻한 느낌이 오래 남아서 그냥 좋았다.", expected: [] },
  { memo: "조용한 소리를 들으니 마음이 차분해졌다.", expected: [] },
  { memo: "익숙한 냄새가 나서 잠깐 옛날 생각이 났다.", expected: [] },
  { memo: "부드러운 촉감이 좋아서 한동안 손을 떼지 못했다.", expected: [] },
  { memo: "시원한 느낌 덕분에 잠깐 기분이 좋아졌다.", expected: [] },
  { memo: "포근한 온기가 느껴져서 마음이 안정됐다.", expected: [] },
  { memo: "은은한 향이 나서 괜히 기분이 편안해졌다.", expected: [] },
  { memo: "잔잔한 소리가 계속 들려서 마음이 느긋해졌다.", expected: [] },
  { memo: "차가운 감촉이 정신을 맑게 해주는 것 같았다.", expected: [] },
  { memo: "오늘이라는 하루가 그냥 무난해서 오히려 좋았다.", expected: [] },
  { memo: "평범한 오전이었는데 이상하게 마음이 편했다.", expected: [] },
  { memo: "별다른 이유 없이 오후 내내 기분이 좋았다.", expected: [] },
  { memo: "그저 무사히 하루를 마친 게 감사했다.", expected: [] },
  { memo: "아무 일도 일어나지 않은 시간이 오히려 편안했다.", expected: [] },
  { memo: "평소와 다를 것 없는 하루가 왠지 소중하게 느껴졌다.", expected: [] },
  { memo: "그냥 시간이 천천히 가는 느낌이 좋았다.", expected: [] },
  { memo: "오늘은 마음이 가벼워서 모든 게 괜찮게 느껴졌다.", expected: [] },
  { memo: "오랜만에 긴장을 풀고 아무것도 하지 않았다.", expected: [] },
  { memo: "별 생각 없이 가만히 있으니 머리가 비워지는 느낌이었다.", expected: [] },
  { memo: "늦게 일어나 한참 뒹굴었는데 그 시간이 좋았다.", expected: [] },
  { memo: "오후 내내 누워 있다가 잠깐 졸았는데 개운했다.", expected: [] },
  { memo: "주말이라 서두르지 않고 천천히 움직여서 좋았다.", expected: [] },
  { memo: "한동안 가만히 앉아 있다가 그냥 웃음이 났다.", expected: [] },
  { memo: "아무 약속도 없다는 사실만으로 마음이 편했다.", expected: [] },
  { memo: "해야 할 일을 잠깐 잊고 쉬니 숨이 트이는 느낌이었다.", expected: [] },
  { memo: "오랜만에 걱정을 내려놓고 조용히 시간을 보냈다.", expected: [] },
  { memo: "그냥 혼자 있는 시간이 필요했는데 오늘 딱 그랬다.", expected: [] },
  { memo: "하루를 서두르지 않고 천천히 보낸 게 좋았다.", expected: [] },
  { memo: "특별한 사건은 없었지만 마음이 차분해서 만족스러웠다.", expected: [] },

];

/** 메모 텍스트만 필요할 때. */
export const TEST_MEMOS: string[] = TEST_CASES.map((c) => c.memo);

