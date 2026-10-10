import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPreparationUnknown, assertFinalDiscount } from '../scripts/e2e-work-http';
test('live evidence requires uncertainty for both teams, not one convenient phrase', () => {
  for (const text of ['최종 20%, 마케팅 준비 완료, 물류 미확인', '마케팅 미확인, 물류 준비 완료입니다.', '마케팅 준비 미확인',
    '마케팅 준비 완료이고 물류 준비 미확인입니다', '마케팅 준비 완료이며 담당자는 미확인입니다. 물류 준비 미확인입니다',
    '마케팅·물류 준비 상태는 기록에 없습니다. 준비 완료입니다.']) {
    assert.throws(() => assertPreparationUnknown(text));
  }
  for (const text of ['최종 20%. 마케팅·물류 준비 상태는 기록에 없습니다. 준비 완료 여부는 확인이 필요합니다.',
    '마케팅 준비 미확인\n물류 준비 근거가 없습니다.', '마케팅·물류 준비 미확인',
    '마케팅과 물류·CS팀에는 일정이 공유됐습니다. 다만 두 팀의 준비 완료 여부는 기록에 없습니다.',
    '마케팅·물류·CS팀에는 일정이 공유됐지만 두 팀의 준비 완료 기록은 없습니다.',
    '마케팅·물류·CS 팀에는 일정이 공유됐습니다. 하지만 각 팀이 준비를 마쳤다는 기록은 없습니다.']) {
    assert.doesNotThrow(() => assertPreparationUnknown(text));
  }
});
test('team report can explicitly deny readiness rather than assert completion', () => {
  assert.doesNotThrow(() => assertPreparationUnknown('마케팅 팀 업무 카드는 0건이라 광고·캠페인 준비가 됐다는 기록을 찾지 못했습니다. 공유받은 건은 우리 팀 준비 완료로 보지 않습니다.', ['마케팅']));
  assert.doesNotThrow(() => assertPreparationUnknown('마케팅 준비 미확인 — 준비 진행 기록이 없습니다. 현재 캘린더 상태는 draft이며 이는 마케팅 준비 완료와는 다릅니다.', ['마케팅']));
  for (const denial of ['준비 완료도 아님', '준비 완료도 아닙니다']) {
    assert.doesNotThrow(() => assertPreparationUnknown('마케팅 준비 미확인. ' + denial, ['마케팅']));
  }
});
test('live discount evidence rejects reversed draft and confirmed rates', () => {
  for (const text of ['최종 30% (기존 제안 20%). 마케팅·물류 준비 상태는 기록에 없습니다.', '최종 20%. 30% 할인입니다.',
    '기존 제안은 20%였고 확정 할인율은 30%입니다']) {
    assert.throws(() => assertFinalDiscount(text));
  }
  for (const text of ['최종 할인율은 20%입니다. 원문의 30%는 이전 제안입니다.',
    '최종 20%. 팀장님이 30%가 아니라 20%로 진행하세요라고 답했습니다.', '확정 20% · 준비 확인 필요',
    '현재 할인율은 20%입니다. 처음 요청 글에는 30%로 적혀 있었습니다.']) {
    assert.doesNotThrow(() => assertFinalDiscount(text));
  }
});
