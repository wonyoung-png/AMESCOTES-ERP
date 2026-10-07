// 설치만을 위한 서비스워커.
//
// 안드로이드 크롬은 fetch 를 받는 서비스워커가 있어야 "앱 설치" 를 띄운다.
// 캐시는 한 줄도 두지 않는다 — 하루에도 몇 번씩 배포하는데 캐시가 묵으면 옛 화면이 그대로 뜨고,
// 그걸 눈치채기까지가 오래 걸린다. 여기선 요청을 그대로 흘려보내기만 한다.
self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* 손대지 않는다 — 브라우저가 알아서 가져간다 */ });

// ── 이걸 없앨 때 (코덱스 지적: 파일만 지우면 이미 깔린 것이 그대로 남는다)
// 1. 이 파일의 내용을 아래 한 줄로 바꿔 배포한다. 그래야 이미 깔린 것이 스스로 빠진다.
//      self.addEventListener('install', () => self.registration.unregister());
// 2. 모두가 한 번씩 들어와 빠진 뒤에 (한두 주) main.tsx 의 register 와 이 파일을 지운다.
// 순서를 바꾸면 안 된다 — 먼저 지우면 빠질 길이 없어 영원히 남는다.
