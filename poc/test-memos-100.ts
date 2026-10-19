/**
 * test-memos.ts가 500개로 확장되기 전의 원래 100개 평가 데이터셋만 뽑은 버전.
 * eval-results.md/eval-failures.md의 기존 실험 기록들이 전부 이 100개 기준으로
 * 쌓여 있어서, 그 기록과 바로 비교 가능한 빠른 재검증용으로 둔다
 * (500개 전체를 돌리면 모델 하나당 몇 시간씩 걸림).
 *
 * test-memos.ts의 앞 100개(음식18/장소15/자연15/사물15/동물+사람15/활동12/
 * 엣지케이스10)를 그대로 가져온 것이라 내용을 중복 관리하지 않는다.
 */
import { TEST_CASES as ALL_TEST_CASES } from "./test-memos.ts";

export const TEST_CASES = ALL_TEST_CASES.slice(0, 100);

/** 메모 텍스트만 필요할 때. */
export const TEST_MEMOS: string[] = TEST_CASES.map((c) => c.memo);
