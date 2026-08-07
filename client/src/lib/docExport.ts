// 서류 내보내기 — 공장·바이어에게 보내는 경로별 형태를 한 곳에서 만든다.
//   카카오톡·위챗  → 이미지 (클립보드 복사 또는 PNG 저장)
//   이메일·보관    → PDF (브라우저 인쇄 → PDF로 저장)
// 외부 라이브러리 없이 SVG foreignObject + canvas 로 캡처한다.
// ponytail: 폰트 임베딩 없이 시스템 폰트로 렌더 — 사내 서류라 충분하다.
//           픽셀 완벽한 캡처가 필요해지면 html2canvas 로 교체.

/** 인쇄 대상 요소에만 print-doc 을 붙였다가 인쇄가 끝나면 뗀다 */
export function printDoc(el: HTMLElement | null) {
  if (!el) { window.print(); return; }
  el.classList.add('print-doc');
  const cleanup = () => { el.classList.remove('print-doc'); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
  // Safari 등 afterprint 가 늦게 오는 브라우저 대비
  setTimeout(cleanup, 3000);
}

/** 요소를 PNG 로 렌더 (배경 흰색, 2배 해상도) */
export async function renderPng(el: HTMLElement, scale = 2): Promise<Blob> {
  // 좁은 창에서도 문서 전체 폭을 담아야 한다 — min-w-[760px] 표가 잘리던 문제
  const rect = el.getBoundingClientRect();
  const inner = Array.from(el.querySelectorAll<HTMLElement>('*'))
    .reduce((max, n) => Math.max(max, n.scrollWidth), 0);
  const width = Math.ceil(Math.max(rect.width, el.scrollWidth, inner));
  const height = Math.ceil(Math.max(el.scrollHeight, rect.height));

  // 계산된 스타일을 인라인으로 굳혀야 foreignObject 안에서도 같은 모양이 나온다
  const clone = el.cloneNode(true) as HTMLElement;
  inlineStyles(el, clone);
  clone.style.width = `${width}px`;
  clone.style.background = '#ffffff';
  clone.style.margin = '0';

  const wrapper = document.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.appendChild(clone);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(wrapper)}</foreignObject>` +
    `</svg>`;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('이미지 렌더 실패'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG 변환 실패'))), 'image/png'),
  );
}

/** 위챗·카톡에 바로 붙여넣기 — 클립보드에 이미지로 복사 */
export async function copyDocAsImage(el: HTMLElement): Promise<void> {
  const blob = await renderPng(el);
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('이 브라우저는 이미지 복사를 지원하지 않습니다 — 이미지 저장을 쓰세요');
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** 카톡 첨부용 — PNG 파일로 저장 */
export async function saveDocAsImage(el: HTMLElement, filename: string): Promise<void> {
  const blob = await renderPng(el);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** el 과 모든 자식의 계산된 스타일을 clone 에 인라인으로 복사 */
function inlineStyles(src: HTMLElement, dst: HTMLElement) {
  const srcNodes = [src, ...Array.from(src.querySelectorAll<HTMLElement>('*'))];
  const dstNodes = [dst, ...Array.from(dst.querySelectorAll<HTMLElement>('*'))];
  const PROPS = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'color', 'background-color', 'text-align', 'vertical-align', 'white-space', 'word-break',
    'text-decoration', 'font-variant-numeric',
    'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius',
    'border-collapse', 'border-spacing', 'table-layout',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content',
    'flex-grow', 'flex-shrink', 'flex-basis', 'gap', 'row-gap', 'column-gap',
    // 그리드 레이아웃 — 빠지면 작업지시서의 2·3열이 한 줄로 무너진다
    'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
    'justify-items', 'place-items',
    'object-fit', 'object-position',
    'width', 'height', 'min-width', 'max-width', 'box-sizing',
  ];
  for (let i = 0; i < srcNodes.length && i < dstNodes.length; i++) {
    const cs = getComputedStyle(srcNodes[i]);
    const d = dstNodes[i];
    // 원본에 직접 박혀 있던 인라인 스타일을 먼저 깔고 계산값을 얹는다
    let css = srcNodes[i].getAttribute('style') || '';
    if (css && !css.trim().endsWith(';')) css += ';';
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) css += `${p}:${v};`;
    }
    // 스크롤 영역은 전체가 보이도록 편다
    css += 'overflow:visible;max-height:none;';
    d.setAttribute('style', css);
  }
}
