type Identity = {materialName?:string;itemName?:string;spec?:string;unit:string;vendorName?:string;currency?:string;unitPriceCny?:number;appliedRate?:number};
export function materialCartIdentity(item:Identity) {
  return JSON.stringify([item.materialName??item.itemName??'',item.spec??'',item.unit,item.vendorName??'',
    item.currency??'CNY',item.unitPriceCny??0,item.appliedRate??null]);
}
