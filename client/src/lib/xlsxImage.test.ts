/**
 * 원가표 엑셀에서 제품사진을 고르는 규칙 자체 점검.
 *
 * 바이너리 zip 없이 돌린다 — 틀리기 쉬운 곳은 경로 해석과 앵커 종류별 크기 계산이지,
 * zip 압축 해제가 아니다. `node --test` 없이 그냥 실행해도 된다.
 *
 *   npx tsx client/src/lib/xlsxImage.test.ts
 */
import { __test } from './xlsxImage';

const { readAnchor, resolveTarget, readRels } = __test;

let pass = 0;
const fails: string[] = [];
const eq = (got: unknown, want: unknown, label: string) => {
  if (String(got) === String(want)) pass++;
  else fails.push(`${label} — 나온값 ${got}, 기대값 ${want}`);
};

const D = 'xl/drawings/drawing1.xml';

// 관계의 Target 은 형태가 제각각이다. drawing 위치를 기준으로 풀어야 한다
eq(resolveTarget(D, '../media/image1.png'), 'xl/media/image1.png', '../media');
eq(resolveTarget(D, 'media/image1.png'), 'xl/drawings/media/image1.png', 'media');
eq(resolveTarget(D, '/xl/media/image1.png'), 'xl/media/image1.png', '/xl/media');
eq(resolveTarget(D, 'media/../image1.png'), 'xl/drawings/image1.png', '중간 ..');
eq(resolveTarget(D, '../../xl/media/a.png'), 'xl/media/a.png', '다단계 ..');

// twoCellAnchor: 도형 안쪽 <a:ext> 를 앵커 크기로 집으면 안 된다
const two = `<xdr:from><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>13</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill>
<xdr:spPr><a:xfrm><a:ext cx="99" cy="99"/></a:xfrm></xdr:spPr></xdr:pic>`;
const a1 = readAnchor(two, 'twoCell')!;
eq(a1.rid, 'rId1', 'twoCell rid');
eq(a1.row, 1, 'twoCell row');
eq(a1.area > 99 * 99, true, 'twoCell 은 to-from 을 쓴다');

// oneCellAnchor: from 다음의 xdr:ext 가 크기다
const one = `<xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:ext cx="2000000" cy="1000000"/>
<xdr:pic><xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill></xdr:pic>`;
const a2 = readAnchor(one, 'oneCell')!;
eq(a2.row, 5, 'oneCell row');
eq(a2.area, 2000000 * 1000000, 'oneCell ext');

// absoluteAnchor: pos(y) 로 행을 가늠하고 ext 가 크기다
const abs = `<xdr:pos x="100000" y="381000"/><xdr:ext cx="3000000" cy="2000000"/>
<xdr:pic><xdr:blipFill><a:blip r:embed="rId3"/></xdr:blipFill></xdr:pic>`;
const a3 = readAnchor(abs, 'absolute')!;
eq(a3.rid, 'rId3', 'absolute rid');
eq(a3.row, 2, 'absolute row');
eq(a3.area, 3000000 * 2000000, 'absolute ext');

// 그림이 아닌 도형·차트는 걸러야 한다
eq(readAnchor('<xdr:sp><a:ext cx="1" cy="1"/></xdr:sp>', 'twoCell'), null, '도형 제외');

const rels = readRels(
  '<Relationships><Relationship Id="rId1" Type="x" Target="../media/image1.png"/>'
  + '<Relationship Id="rId2" Target="../media/image2.jpeg"/></Relationships>');
eq(rels.rId1, '../media/image1.png', 'rels rId1');
eq(rels.rId2, '../media/image2.jpeg', 'rels rId2');

if (fails.length) {
  console.error(`실패 ${fails.length}건`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`xlsxImage 자체 점검 통과 ${pass}건`);
