# 우리 서버·조회 인증 마무리 검토

읽기 전용, 운영 명령/수정/비밀/.env/개인정보읽기 금지. 대상 deploy/migrate/Caddyfile, docs/ERP_OUR_SERVER_INVENTORY_2026-10-12.md, 직전 Cafe24 분리본 검토 결과. 필요시 해당 인증 코드만 읽는다.

대표 최신지시 “서버는 전부 지금 우리서버로 옮겨라”. 실제 SSM조회: 우리 AWS ames-new에서 ERP healthy/daily healthy/hr healthy/Postgres healthy/PostgREST running/Caddy running, 운영 ERP HEAD=배포marker=a62ee0f, 타이머active. 세 서비스 실제env 모두Railway/Supabase주소없음. daily callback runtime hostname은 daily.ameserp.kr. 개발자센터기존ATLMERP앱metadata는옛Railway였으므로그주소만수정허용질문중(기존앱변경금지결정 보존); 맥미니러너AWS이전여부도질문중. 공급자Shopify/Cafe24/Meta를회사서버와혼동안함. 이전서버종료/과금해지 안함.

새 AMESCOTES ERP 조회 앱 생성/주문·상점READ/ERPcallback 저장, 키 원문미출력RSA-OAEP-SHA256→우리서버root0600 private staging 성공. 전달용RSAprivate만삭제, 기존앱·runtimeenv·DB변경없음. Secret미확보라는직전검토는후속AX직접보기로해결됨. 정적P0/P1이미재검토통과, 운영OAuth/16SQL적용/실paidorder미실행을분명히표시.

추가 Caddy보강: safe_access_log snippet은 기존stdout/json accesslogging을계속유지하되 request>uri query에서code/state만삭제. ERP/CEO/daily/hr모든로그에사용. 다른라우팅·cookie기본redaction유지. 실제설치Caddy2.11.7에서수정config의adapt성공(SSM c6017363-45b2-49f6-a3b2-458801b9eaeb),queryfilter4곳존재/모든appupstream보존/liveconfig변경false. 실제로그모의query값삭제확인은운영검수목록, 성공이라고주장안함.

SQL 새토큰분리fixture 포함격리PGlite54/54통과, 신규callback4/4+관련28/28+tsc통과, 전체단위테스트재실행중/빌드앞선통과. 최초전체명령에서SQL런타임env미설정/실브라우저통합런타임미설정으로실패했음을구분했고, 실제SQL은명시격리runtime재실행성공; 실브라우저체인은미실행, 숨겨서성공이라하지않음.

최종질문: 권한분리/로그필터/현재서버와외부metadata의구분/운영미적용표시에서남은P0/P1만지적. 불필요한기능추가권고는하지말것. 운영적용은기존대표지정Claude검수단계존중, 신규migration운영반영없이완료라고하지않음.
