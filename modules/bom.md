# BOM (Bill of Materials) 관리

## 개요
제품 생산에 필요한 원자재, 부자재 목록 및 수량을 관리.

## 주요 기능
- 품목별 BOM 등록/수정/조회
- BOM 없는 품목 자동 감지 → 누락 알림
- BOM 기반 원가 자동 계산

## 누락 알림 조건
- 생산 등록된 품목 중 BOM이 없는 경우
- BOM은 있으나 원자재 단가가 미입력된 경우

## API 연동 설계 (예정)
```
GET  /api/bom/{item_code}        # BOM 조회
POST /api/bom                    # BOM 등록
PUT  /api/bom/{item_code}        # BOM 수정
GET  /api/bom/missing            # BOM 없는 품목 목록
```
