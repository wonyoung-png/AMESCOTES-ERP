# API 연동 설계

## 개요
ERP 시스템과 AI 에이전트 간 연동을 위한 API 설계 문서.

## 인증
- 방식: API Key 또는 OAuth2.0
- 헤더: `Authorization: Bearer {token}`

## 기본 URL
```
https://api.amescotes-erp.com/v1
```
(개발 중 — 실제 URL 확정 시 업데이트 예정)

## 모듈별 엔드포인트 요약
| 모듈 | 경로 | 문서 |
|---|---|---|
| BOM | `/api/bom` | modules/bom.md |
| 발주/주문 | `/api/orders` | modules/orders.md |
| 재고 | `/api/inventory` | modules/inventory.md |
| 배송/납기 | `/api/shipping` | modules/shipping.md |

## 음성 등록 연동 흐름
```
음성 입력
  → Whisper (STT)
  → LUMEN AI 해석
  → ERP API 호출
  → 등록 완료 확인 응답
```

## 알림 연동
- 텔레그램: chat_id 6708085360
- 슬랙: D08R46NP5KL (채널)
