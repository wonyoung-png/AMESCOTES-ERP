# FIX2 — 같은 발주·품번 협의 중복 묶기

문제(10/10 실서버): 같은 발주 문제(AB2609HB01-R1·K02609HB01-R1 납기 지연)가 협의 3건으로 따로 열림
— 발주별 카드 2건 + '납기·입고 점검' 요약 fact 1건.

⚠️ 다른 Codex 세션이 지금 server/agents.ts·ceo.ts·watch.ts·work*.ts 를 수정 중. **수정은 server/council.ts, server/council.test.ts 두 파일만.** 다른 파일 건드리지 말 것. 커밋·push 금지.

## 할 일 (findCouncilCandidates 안에서만)
1. 후보의 topic+evidence 에서 품번/발주번호 토큰 추출(예: `[A-Z]{1,4}\d{4}[A-Z]{2}\d{2}(-R\d+)?`, 기존 코드에서 쓰는 품번 정규식이 있으면 재사용).
2. 같은 kind(inventory/production/…) 이고 품번 집합이 겹치는 후보는 1건으로 병합: teams 합집합(최대 3), evidence 합침, topic 은 "품번 n건: 대표 사안" 형태, triggerKey 는 kind + 정렬된 품번 목록 해시(같은 날 같은 묶음이면 같은 키).
3. 품번이 없는 요약 fact(예: '납기·입고 점검: 확인 필요 3건')는, 같은 kind 의 품번 후보가 있으면 그 묶음에 evidence 로 합치고 별도 후보로 만들지 않음.
4. 병합 후 최대 3건 상한 유지.
5. council.test.ts: 위 실서버 사례 재현(발주 카드 2건 + 요약 fact 1건 → 후보 1건), 서로 다른 품번은 분리 유지, triggerKey 안정성 테스트.
6. `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/tsx --test server/*.test.ts` 통과. 한국어 짧게 보고.
