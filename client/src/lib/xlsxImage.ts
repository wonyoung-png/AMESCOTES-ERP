/**
 * 공장 원가표(.xlsx)에 박혀 있는 제품사진을 꺼낸다.
 *
 * SheetJS 커뮤니티판은 셀만 읽고 그림은 버린다. xlsx 는 zip 이라 이미지는
 * `xl/media/*` 에 따로 들어 있고, 어느 셀에 놓였는지는 `xl/drawings/drawing*.xml` 이 갖고 있다.
 *
 * 원가표에는 로고·도장 같은 작은 그림이 섞여 있다. 그래서 파일 순서로 첫 장을 집으면 안 된다.
 * 놓인 자리(위쪽)와 크기를 같이 봐서 제품사진 하나를 고른다.
 *
 * JSZip 은 업로드할 때만 동적으로 불러온다 — 초기 번들을 키우지 않기 위해서다.
 */

/** 이미지당 압축 전 상한. 이보다 크면 사진만 건너뛴다 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * twoCellAnchor 에 ext 가 없을 때 쓰는 기본 셀 크기 (EMU).
 * 열 64px ≈ 609600, 행 20px ≈ 190500. 정확할 필요는 없고 크고 작음만 가리면 된다.
 */
const COL_EMU = 609600;
const ROW_EMU = 190500;

interface Candidate {
  path: string;
  /** 앵커 시작 행 (0-based). 작을수록 위쪽 */
  row: number;
  /** 표시 면적 (EMU²) */
  area: number;
}

const num = (s: string | undefined | null) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

type AnchorKind = 'twoCell' | 'oneCell' | 'absolute';

/**
 * 앵커 한 덩어리에서 위치·크기·이미지 관계 id 를 뽑는다.
 *
 * 크기는 앵커 종류마다 다른 곳에서 읽어야 한다.
 * twoCellAnchor 안에도 도형 내부 <a:ext> 가 들어 있어서, 그걸 앵커 크기로 집으면
 * 실제 표시 크기와 무관한 값이 나온다.
 */
function readAnchor(a: string, kind: AnchorKind): { rid: string; row: number; area: number } | null {
  const rid = /r:embed="([^"]+)"/.exec(a)?.[1];
  if (!rid) return null;

  if (kind === 'absolute') {
    // pos(y) + ext. 행 높이를 모르니 기본 행 높이로 가늠한다 — 위아래만 가리면 된다
    const y = num(/<xdr:pos[^>]*y="(-?\d+)"/.exec(a)?.[1]);
    const ext = /<xdr:ext[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(a);
    return { rid, row: Math.round(y / ROW_EMU), area: ext ? num(ext[1]) * num(ext[2]) : 0 };
  }

  const from = /<xdr:from>([\s\S]*?)<\/xdr:from>/.exec(a)?.[1] || '';
  const fromRow = num(/<xdr:row>(\d+)<\/xdr:row>/.exec(from)?.[1]);

  if (kind === 'oneCell') {
    // from + ext (xdr:ext 는 xdr:from 바로 뒤에 온다)
    const ext = /<\/xdr:from>\s*<xdr:ext[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(a);
    return { rid, row: fromRow, area: ext ? num(ext[1]) * num(ext[2]) : 0 };
  }

  // twoCell — to 와 from 의 차이가 곧 표시 크기다. 도형 내부 ext 는 쳐다보지 않는다
  const fromCol = num(/<xdr:col>(\d+)<\/xdr:col>/.exec(from)?.[1]);
  const fromRowOff = num(/<xdr:rowOff>(-?\d+)<\/xdr:rowOff>/.exec(from)?.[1]);
  const fromColOff = num(/<xdr:colOff>(-?\d+)<\/xdr:colOff>/.exec(from)?.[1]);
  const to = /<xdr:to>([\s\S]*?)<\/xdr:to>/.exec(a)?.[1] || '';
  if (!to) return { rid, row: fromRow, area: 0 };
  const w = (num(/<xdr:col>(\d+)<\/xdr:col>/.exec(to)?.[1]) - fromCol) * COL_EMU
    + num(/<xdr:colOff>(-?\d+)<\/xdr:colOff>/.exec(to)?.[1]) - fromColOff;
  const h = (num(/<xdr:row>(\d+)<\/xdr:row>/.exec(to)?.[1]) - fromRow) * ROW_EMU
    + num(/<xdr:rowOff>(-?\d+)<\/xdr:rowOff>/.exec(to)?.[1]) - fromRowOff;
  return { rid, row: fromRow, area: Math.max(0, w) * Math.max(0, h) };
}

/** 관계 파일에서 rId → 이미지 경로 */
function readRels(xml: string): Record<string, string> {
  const map: Record<string, string> = {};
  // matchAll 순회는 이 프로젝트 tsconfig 타깃에서 안 된다 (TS2802) — exec 루프로 돈다
  const re = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) map[m[1]] = m[2];
  return map;
}

/**
 * 관계의 Target 을 zip 안의 실제 경로로 바꾼다.
 * `../media/x.png`, `media/x.png`, `/xl/media/x.png` 등 형태가 제각각이라
 * drawing 파일 위치를 기준으로 풀어야 한다.
 */
function resolveTarget(drawingPath: string, target: string): string {
  if (target.startsWith('/')) return target.replace(/^\/+/, '');   // 패키지 루트 기준
  // base 와 target 을 한 스택에 이어 붙이고 .. 를 그 스택에서 뺀다.
  // 따로 담으면 media/../image.png 같은 중간 .. 가 엉뚱하게 base 를 지운다
  const stack = drawingPath.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}

/**
 * 원가표에서 제품사진 한 장을 꺼낸다. 없으면 null.
 * 실패해도 던지지 않는다 — 사진은 덤이고, 자재 파싱이 본체다.
 */
export async function extractProductImage(file: File): Promise<File | null> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(file);

    const cands: Candidate[] = [];
    for (const name of Object.keys(zip.files)) {
      if (!/^xl\/drawings\/drawing\d*\.xml$/.test(name)) continue;
      const xml = await zip.files[name].async('string');
      const relFile = zip.files[name.replace(/drawings\/(drawing\d*\.xml)$/, 'drawings/_rels/$1.rels')];
      if (!relFile) continue;
      const rels = readRels(await relFile.async('string'));

      // twoCellAnchor / oneCellAnchor / absoluteAnchor 세 가지가 쓰인다.
      // 어느 종류였는지 알아야 크기를 어디서 읽을지 정할 수 있어, 구분자를 남겨 자른다
      const parts = xml.split(/<xdr:(twoCell|oneCell|absolute)Anchor/);
      for (let i = 1; i < parts.length; i += 2) {
        const kind = parts[i] as AnchorKind;
        const chunk = parts[i + 1] || '';
        const a = readAnchor(chunk, kind);
        if (!a) continue;
        const target = rels[a.rid];
        if (!target) continue;
        cands.push({ path: resolveTarget(name, target), row: a.row, area: a.area });
      }
    }
    if (cands.length === 0) return null;

    /*
     * 제품사진은 표 위쪽(머리글 근처)에 크게 놓인다. 로고·도장은 작다.
     * 위쪽 20행 안에 있는 것을 먼저 보고, 그 안에서 가장 큰 것을 고른다.
     * 위쪽에 아무것도 없으면 전체에서 가장 큰 것.
     */
    const top = cands.filter(c => c.row <= 20);
    const pool = top.length > 0 ? top : cands;
    const best = pool.reduce((a, b) => (b.area > a.area ? b : a));

    const entry = zip.files[best.path];
    if (!entry) return null;

    const ext = (best.path.split('.').pop() || '').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return null;

    const blob = await entry.async('blob');
    if (blob.size === 0 || blob.size > MAX_IMAGE_BYTES) return null;

    const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'gif' ? 'image/gif'
      : ext === 'webp' ? 'image/webp'
      : 'image/png';
    return new File([blob], `product.${ext}`, { type });
  } catch {
    // 사진을 못 꺼내도 원가표 자체는 들어가야 한다
    return null;
  }
}


/** 자체 점검용 — 바깥에서는 쓰지 않는다 (xlsxImage.test.ts) */
export const __test = { readAnchor, resolveTarget, readRels };
