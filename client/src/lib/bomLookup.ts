import type { Bom } from './store';

export function getBomForOrderFromList(boms: Bom[], styleNo: string, styleId?: string): { bom: Bom | null; type: 'post' | 'pre' | null } {
  const bomList = boms
    .filter(b => b.styleNo === styleNo || (!!styleId && (b.styleId === styleId || b.styleId === styleNo)) || (!!styleNo && b.styleId === styleNo))
    .sort((a, b) => (b.version || 0) - (a.version || 0));
  if (bomList.length === 0) return { bom: null, type: null };
  const postColorBom = bomList.find(b => (b as any).postColorBoms?.length > 0);
  if (postColorBom) return { bom: postColorBom, type: 'post' };
  const postBom = bomList.find(b => (b.postMaterials?.length || 0) > 0);
  if (postBom) return { bom: postBom, type: 'post' };
  const preColorBom = bomList.find(b => (b as any).colorBoms?.length > 0);
  if (preColorBom) return { bom: preColorBom, type: 'pre' };
  const preBom = bomList.find(b => b.lines?.length > 0);
  return { bom: preBom || bomList[0], type: 'pre' };
}
