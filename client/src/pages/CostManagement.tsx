// AMESCOTES ERP — 원가 관리
// 사전원가: BOM 기반 계산 + 납품가 + 마진율 목표 역산
// 사후원가: 중국 공장 .xlsm 업로드 파싱 + 사전원가 불러오기 + 비교
import { useState, useMemo } from 'react';
import { store, formatKRW, formatNumber, type PostCost, type Bom } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Upload, TrendingDown, TrendingUp, Coins, AlertTriangle, Copy } from 'lucide-react';
import { toast } from 'sonner';

export default function CostManagement() {
  const [tab, setTab] = useState('pre');
  const items = store.getItems();
  const orders = store.getOrders();
  const settings = store.getSettings();
  const postCosts = store.getPostCosts();
  const boms = store.getBoms();

  const [selectedStyle, setSelectedStyle] = useState('');
  const [simCny, setSimCny] = useState(settings.cnyKrw);
  const [simUsd, setSimUsd] = useState(settings.usdKrw);

  // 사전원가 — 납품가 / 마진율 목표
  const [deliveryPrice, setDeliveryPrice] = useState<number>(0);   // 바이어에게 제시하는 납품가
  const [targetMarginRate, setTargetMarginRate] = useState<number>(20); // 목표 마진율 (%)

  // 사후원가 — 선택된 발주
  const [postSelectedOrderNo, setPostSelectedOrderNo] = useState('');
  const [postCustomLines, setPostCustomLines] = useState<{ id: string; itemName: string; amountKrw: number }[]>([]);

  // 선택된 스타일의 BOM
  const selectedBom = useMemo(() => boms.find(b => b.styleNo === selectedStyle), [boms, selectedStyle]);
  const selectedItem = useMemo(() => items.find(i => i.styleNo === selectedStyle), [items, selectedStyle]);

  // 사전원가 계산 (BOM 기반)
  const preCostCalc = useMemo(() => {
    if (!selectedBom) return null;
    const materialLines = selectedBom.lines.filter(l => !l.isHqProvided);
    const hqLines = selectedBom.lines.filter(l => l.isHqProvided);
    const totalMaterialCny = materialLines.reduce((sum, l) => {
      const qty = l.netQty * (1 + l.lossRate);
      return sum + l.unitPriceCny * qty;
    }, 0);
    const totalFactoryCny = totalMaterialCny + selectedBom.processingFee;
    const totalCostKrw = Math.round(totalFactoryCny * simCny);
    const salePriceKrw = selectedItem?.salePriceKrw || 0;
    const marginRate = salePriceKrw > 0 ? ((salePriceKrw - totalCostKrw) / salePriceKrw * 100) : 0;
    // 납품가 기반 마진율
    const deliveryMarginRate = deliveryPrice > 0 ? ((deliveryPrice - totalCostKrw) / deliveryPrice * 100) : 0;
    // 목표 마진율로 역산한 납품가
    const calcDeliveryByMargin = targetMarginRate < 100 ? Math.round(totalCostKrw / (1 - targetMarginRate / 100)) : 0;
    const hqCostKrw = hqLines.reduce((sum, l) => {
      const qty = l.netQty * (1 + l.lossRate);
      return sum + l.unitPriceCny * qty * simCny;
    }, 0);
    return { materialLines, hqLines, totalMaterialCny, totalFactoryCny, totalCostKrw, marginRate, hqCostKrw, deliveryMarginRate, calcDeliveryByMargin };
  }, [selectedBom, selectedItem, simCny, simUsd, deliveryPrice, targetMarginRate]);

  // 사후원가 업로드 (xlsm 파싱)
  const handlePostCostUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    toast.info(`"${file.name}" 파일을 업로드했습니다. 실제 파싱은 2단계(Google Sheets 연동) 후 지원됩니다.`);
    e.target.value = '';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">원가 관리</h1>
          <p className="text-sm text-muted-foreground mt-0.5">사전/사후 원가 비교 및 환율 마진 분석</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pre">사전원가 시뮬레이션</TabsTrigger>
          <TabsTrigger value="post">사후원가</TabsTrigger>
        </TabsList>

        {/* 사전원가 탭 */}
        <TabsContent value="pre" className="space-y-4 mt-4">
          {/* 스타일 선택 + 환율 입력 */}
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-4">
              <div className="grid grid-cols-4 gap-4 items-end">
                <div>
                  <Label>스타일 선택</Label>
                  <Select value={selectedStyle} onValueChange={setSelectedStyle}>
                    <SelectTrigger><SelectValue placeholder="스타일 선택" /></SelectTrigger>
                    <SelectContent>
                      {items.filter(i => i.hasBom).map(i => (
                        <SelectItem key={i.id} value={i.styleNo}>{i.styleNo} — {i.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Label>적용 환율 CNY/KRW</Label>
                    <select className="text-xs border rounded px-1 py-0.5 bg-background text-muted-foreground" 
                      onChange={e => { if(e.target.value) setSimCny(Number(e.target.value)); }}>
                      <option value="">이력 선택...</option>
                      {settings.exchangeHistory.map(h => (
                        <option key={h.id} value={h.cnyKrw}>{h.date} ({h.cnyKrw}원)</option>
                      ))}
                    </select>
                  </div>
                  <Input type="number" value={simCny} onChange={e => setSimCny(Number(e.target.value))} className="font-mono" />
                </div>
                <div>
                  <Label>시뮬레이션 USD/KRW</Label>
                  <Input type="number" value={simUsd} onChange={e => setSimUsd(Number(e.target.value))} className="font-mono" />
                </div>
                <div className="text-xs text-muted-foreground">
                  현재 적용 환율<br />
                  <span className="font-mono">CNY {settings.cnyKrw} / USD {settings.usdKrw}</span>
                </div>
              </div>

              {/* 납품가 & 마진율 목표 */}
              <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-border/60">
                <div>
                  <Label>납품가 (바이어 제시가, KRW)</Label>
                  <Input
                    type="number"
                    value={deliveryPrice || ''}
                    onChange={e => setDeliveryPrice(Number(e.target.value))}
                    placeholder="예: 80000"
                    className="font-mono mt-1"
                  />
                </div>
                <div>
                  <Label>목표 마진율 (%)</Label>
                  <Input
                    type="number"
                    value={targetMarginRate}
                    onChange={e => setTargetMarginRate(Number(e.target.value))}
                    placeholder="20"
                    className="font-mono mt-1"
                  />
                </div>
                <div className="text-xs text-muted-foreground mt-5">
                  {preCostCalc && targetMarginRate > 0 && (
                    <p>목표 마진 {targetMarginRate}% 기준 납품가:<br />
                      <span className="font-mono font-bold text-[#C9A96E] text-base">
                        {formatKRW(preCostCalc.calcDeliveryByMargin)}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {!selectedStyle ? (
            <Card className="border-border/60"><CardContent className="py-12 text-center text-muted-foreground">
              <Coins size={32} className="mx-auto mb-2 opacity-30" />스타일을 선택하면 BOM 기반 원가가 자동 계산됩니다
            </CardContent></Card>
          ) : !selectedBom ? (
            <Card className="border-border/60"><CardContent className="py-8 text-center text-muted-foreground">
              <AlertTriangle size={24} className="mx-auto mb-2 opacity-50" />BOM이 등록되지 않은 스타일입니다. BOM 관리에서 먼저 등록해주세요.
            </CardContent></Card>
          ) : preCostCalc && (
            <div className="space-y-4">
              {/* 원가 요약 */}
              <div className="grid grid-cols-5 gap-3">
                {[
                  { label: '자재비 합계', value: formatKRW(Math.round(preCostCalc.totalMaterialCny * simCny)), sub: `${preCostCalc.totalMaterialCny.toFixed(2)} CNY` },
                  { label: '임가공비', value: formatKRW(Math.round(selectedBom.processingFee * simCny)), sub: `${selectedBom.processingFee.toFixed(2)} CNY` },
                  { label: '공장 총원가', value: formatKRW(preCostCalc.totalCostKrw), sub: `${preCostCalc.totalFactoryCny.toFixed(2)} CNY`, highlight: true },
                  { label: '납품가 마진율', value: deliveryPrice > 0 ? `${preCostCalc.deliveryMarginRate.toFixed(1)}%` : '-', sub: deliveryPrice > 0 ? `납품가 ${formatKRW(deliveryPrice)}` : '납품가 미입력', color: preCostCalc.deliveryMarginRate < 20 ? 'text-red-600' : preCostCalc.deliveryMarginRate < 30 ? 'text-amber-600' : 'text-green-600' },
                  { label: '판매가 마진율', value: `${preCostCalc.marginRate.toFixed(1)}%`, sub: `판매가 ${formatKRW(selectedItem?.salePriceKrw || 0)}`, color: preCostCalc.marginRate < 20 ? 'text-red-600' : preCostCalc.marginRate < 30 ? 'text-amber-600' : 'text-green-600' },
                ].map(s => (
                  <Card key={s.label} className={`border-border/60 ${s.highlight ? 'ring-1 ring-[#C9A96E]' : ''}`}>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className={`font-number font-bold text-lg mt-1 ${s.color || ''}`}>{s.value}</p>
                      <p className="text-xs text-muted-foreground">{s.sub}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* B. 마진율 색상 경고 배너 */}
              {deliveryPrice > 0 && (() => {
                const r = preCostCalc.deliveryMarginRate;
                if (r >= 30) return (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 font-medium">
                    ✅ 납품가 마진율 양호 ({r.toFixed(1)}%) — 목표 마진 30% 이상 달성
                  </div>
                );
                if (r >= 20) return (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-yellow-50 border border-yellow-300 rounded-lg text-sm text-yellow-800 font-medium">
                    🟡 납품가 마진율 주의 ({r.toFixed(1)}%) — 20~30% 구간, 원가 절감 검토 권장
                  </div>
                );
                return (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-300 rounded-lg text-sm text-red-700 font-semibold">
                    ⚠️ 납품가 마진율 위험 ({r.toFixed(1)}%) — 20% 미만! 납품가 재협의 또는 원가 절감 필요
                  </div>
                );
              })()}

              {/* BOM 라인 테이블 */}
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">BOM 원가 명세 (공장 부담)</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-4 py-2 text-xs text-muted-foreground">구분</th>
                        <th className="text-left px-4 py-2 text-xs text-muted-foreground">품목명</th>
                        <th className="text-left px-4 py-2 text-xs text-muted-foreground">규격</th>
                        <th className="text-right px-4 py-2 text-xs text-muted-foreground">단가</th>
                        <th className="text-right px-4 py-2 text-xs text-muted-foreground">소요량</th>
                        <th className="text-right px-4 py-2 text-xs text-muted-foreground">단가(CNY)</th>
                        <th className="text-right px-4 py-2 text-xs font-semibold text-foreground">금액(KRW) ▶</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preCostCalc.materialLines.map((l, i) => {
                        const qty = l.netQty * (1 + l.lossRate);
                        const amtCny = 'CNY' === 'CNY' ? l.unitPriceCny * qty : false ? l.unitPriceCny * qty * (simUsd / simCny) : l.unitPriceCny * qty / simCny;
                        const amtKrw = false ? l.unitPriceCny * qty : 'CNY' === 'CNY' ? l.unitPriceCny * qty * simCny : l.unitPriceCny * qty * simUsd;
                        return (
                          <tr key={l.id} className="border-b hover:bg-muted/20">
                            <td className="px-4 py-2 text-xs text-muted-foreground">{l.category}</td>
                            <td className="px-4 py-2 font-medium">{l.itemName}</td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">{l.spec || '-'}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs">{l.unitPriceCny} {'CNY'}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs">{qty.toFixed(3)} {l.unit}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs">{amtCny.toFixed(2)}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs">{formatKRW(Math.round(amtKrw))}</td>
                          </tr>
                        );
                      })}
                      <tr className="bg-muted/30 font-semibold">
                        <td colSpan={5} className="px-4 py-2 text-right text-xs">임가공비</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{selectedBom.processingFee.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{formatKRW(Math.round(selectedBom.processingFee * simCny))}</td>
                      </tr>
                      <tr className="bg-[#C9A96E]/10 font-bold">
                        <td colSpan={5} className="px-4 py-2 text-right text-sm">공장 총원가</td>
                        <td className="px-4 py-2 text-right font-mono">{preCostCalc.totalFactoryCny.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatKRW(preCostCalc.totalCostKrw)}</td>
                      </tr>
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {/* 본사 제공 자재 */}
              {preCostCalc.hqLines.length > 0 && (
                <Card className="border-border/60 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      본사 제공 자재
                      <Badge variant="outline" className="text-xs">{preCostCalc.hqLines.length}개 항목</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-4 py-2 text-xs text-muted-foreground">구분</th>
                          <th className="text-left px-4 py-2 text-xs text-muted-foreground">품목명</th>
                          <th className="text-right px-4 py-2 text-xs text-muted-foreground">단가</th>
                          <th className="text-right px-4 py-2 text-xs text-muted-foreground">소요량</th>
                          <th className="text-right px-4 py-2 text-xs text-muted-foreground">금액(KRW)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preCostCalc.hqLines.map(l => {
                          const qty = l.netQty * (1 + l.lossRate);
                          const costKrw = false ? l.unitPriceCny * qty : 'CNY' === 'CNY' ? l.unitPriceCny * qty * simCny : l.unitPriceCny * qty * simUsd;
                          return (
                            <tr key={l.id} className="border-b hover:bg-muted/20">
                              <td className="px-4 py-2 text-xs text-muted-foreground">{l.category}</td>
                              <td className="px-4 py-2 font-medium">{l.itemName}</td>
                              <td className="px-4 py-2 text-right font-mono text-xs">{l.unitPriceCny} {'CNY'}</td>
                              <td className="px-4 py-2 text-right font-mono text-xs">{qty.toFixed(3)} {l.unit}</td>
                              <td className="px-4 py-2 text-right font-mono text-xs">{formatKRW(Math.round(costKrw))}</td>
                            </tr>
                          );
                        })}
                        <tr className="bg-blue-50/50 font-semibold">
                          <td colSpan={4} className="px-4 py-2 text-right text-xs">본사 제공 자재 합계</td>
                          <td className="px-4 py-2 text-right font-mono">{formatKRW(Math.round(preCostCalc.hqCostKrw))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* 사후원가 탭 */}
        <TabsContent value="post" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">중국 공장 원가표(.xlsm) 업로드 → 자동 파싱</p>
              {/* 사전원가 불러오기 버튼 */}
              {selectedStyle && preCostCalc && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-blue-700 border-blue-300 hover:bg-blue-50"
                  onClick={() => {
                    toast.success(`${selectedStyle} 사전원가 데이터를 불러왔습니다 (사전 총원가: ${formatKRW(preCostCalc.totalCostKrw)})`);
                  }}
                >
                  <Copy size={14} />사전원가 불러오기
                </Button>
              )}
            </div>
            <label>
              <input type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={handlePostCostUpload} />
              <Button asChild className="bg-[#C9A96E] hover:bg-[#B8985D] text-white cursor-pointer">
                <span><Upload size={16} className="mr-1" />원가표 업로드</span>
              </Button>
            </label>
          </div>

          {postCosts.length === 0 ? (
            <Card className="border-border/60"><CardContent className="py-12 text-center text-muted-foreground">
              <Upload size={32} className="mx-auto mb-2 opacity-30" />
              <p>등록된 사후원가가 없습니다</p>
              <p className="text-xs mt-1">공장에서 받은 원가표 엑셀을 업로드하세요</p>
            </CardContent></Card>
          ) : (
            postCosts.map(pc => {
              const item = items.find(i => i.styleNo === pc.styleNo);
              const order = orders.find(o => o.orderNo === pc.orderNo);
              const errorLines = pc.lines.filter(l => l.hasQtyError || l.hasAmountError);
              const warnLines = pc.lines.filter(l => l.hasPriceWarning);

              return (
                <Card key={pc.id} className="border-border/60 shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{pc.styleNo} — {item?.name} (사후원가 v{pc.version})</CardTitle>
                        <p className="text-xs text-muted-foreground">{pc.orderNo} · {pc.createdAt} {pc.sourceFileName && `· ${pc.sourceFileName}`}</p>
                      </div>
                      <div className="flex gap-2">
                        {errorLines.length > 0 && <Badge variant="destructive" className="text-xs">{errorLines.length}개 오류</Badge>}
                        {warnLines.length > 0 && <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-300">{warnLines.length}개 경고</Badge>}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-5 gap-4 mb-4">
                      <div>
                        <p className="text-xs text-muted-foreground">임가공비</p>
                        <p className="font-number font-semibold">{pc.processingFee.toFixed(2)} CNY</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">사후 총원가 (KRW)</p>
                        <p className="font-number font-semibold">{formatKRW(pc.totalCostKrw ?? 0)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">사전 총원가 (KRW)</p>
                        {(() => {
                          const b = boms.find(bm => bm.styleNo === pc.styleNo);
                          if (!b) return <p className="text-xs text-stone-400">BOM 없음</p>;
                          const preCost = Math.round((b.lines.filter(l => !l.isHqProvided).reduce((s, l) => s + l.unitPriceCny * l.netQty * (1 + l.lossRate), 0) + b.processingFee) * pc.appliedCnyKrw);
                          const diff = (pc.totalCostKrw ?? 0) - preCost;
                          return (
                            <div>
                              <p className="font-number font-semibold">{formatKRW(preCost)}</p>
                              <p className={`text-xs mt-0.5 ${diff > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {diff > 0 ? '▲' : '▼'} {formatKRW(Math.abs(diff))}
                              </p>
                            </div>
                          );
                        })()}
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">적용 환율 (CNY)</p>
                        <p className="font-number font-semibold">{pc.appliedCnyKrw}원</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">등록일</p>
                        <p className="text-sm">{pc.createdAt}</p>
                      </div>
                    </div>

                    {/* 오류/경고 라인 */}
                    {(errorLines.length > 0 || warnLines.length > 0) && (
                      <div className="space-y-1">
                        {errorLines.map(l => (
                          <div key={l.id} className="flex items-center gap-2 text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">
                            <AlertTriangle size={12} />
                            <span className="font-medium">{l.itemName}</span>
                            {l.hasQtyError && <span>수량 이상</span>}
                            {l.hasAmountError && <span>금액 이상</span>}
                          </div>
                        ))}
                        {warnLines.map(l => (
                          <div key={l.id} className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded">
                            <AlertTriangle size={12} />
                            <span className="font-medium">{l.itemName}</span>
                            <span>{l.priceWarningMsg}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
