/** Vite / Chromium / Firefox / WebKit의 화면 파일 로딩 실패만 구분한다. */
export function isScreenLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk .+ failed|Unable to preload CSS/i.test(message);
}

/** 자동 새로고침 없이 입력 손실 안내 후 사용자가 동의한 경우에만 실행한다. */
export function reloadWithConfirmation(confirm: (message: string) => boolean, reload: () => void): boolean {
  if (!confirm('화면을 새로 불러오면 저장하지 않은 입력은 사라질 수 있습니다. 계속하시겠습니까?')) return false;
  reload();
  return true;
}
