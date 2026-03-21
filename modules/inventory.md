# 재고 관리

## 개요
원자재, 부자재, 완제품 재고 현황 관리.

## 주요 기능
- 품목별 재고 현황 조회
- 안전재고 미달 시 자동 알림
- 입출고 이력 관리
- 재고 실사 지원

## 누락 알림 조건
- 안전재고 이하로 떨어진 품목
- 장기 미사용 재고 (6개월 이상)
- 입고 등록 누락 건

## API 연동 설계 (예정)
```
GET  /api/inventory              # 전체 재고 현황
GET  /api/inventory/{item_code}  # 품목별 재고
GET  /api/inventory/low-stock    # 안전재고 미달 목록
POST /api/inventory/in           # 입고 등록
POST /api/inventory/out          # 출고 등록
```
