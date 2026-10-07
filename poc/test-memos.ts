/**
 * 아이템 추출 POC용 평가 데이터셋 (100개).
 * 각 메모에 "정답(expected)"을 같이 넣어서, 모델 출력과 기계적으로 비교해
 * 정확도를 잴 수 있게 한다 (콘솔에 찍어놓고 눈으로 보는 것보다 재현 가능함).
 *
 * 카테고리 분포(음식/장소/자연/사물/동물/활동 각 12~18개)와,
 * 의도적으로 "명확한 아이템이 없는" 엣지 케이스 10개(expected: [])를 섞었다 —
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
];

/** 메모 텍스트만 필요할 때. */
export const TEST_MEMOS: string[] = TEST_CASES.map((c) => c.memo);
