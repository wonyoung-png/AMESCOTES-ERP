// 거래처 서류 AI OCR — 사업자등록증/통장사본/명함/이메일 텍스트 → Vendor JSON
// ANTHROPIC_API_KEY만 필요. yardage-ocr와 동일하게 agent-team 비의존.
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // PDF 포함
});

export type VendorOcrResult = {
  suggestedType?: '바이어' | '자재거래처' | '공장' | '해외공장' | '물류업체' | '기타' | null;
  typeHint?: string;
  name?: string;
  nameEn?: string;
  nameCn?: string;
  companyName?: string;
  bizRegNo?: string;
  address?: string;
  country?: string;
  currency?: 'KRW' | 'USD' | 'CNY';
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  billingEmail?: string;
  wechatId?: string;
  bankInfo?: {
    beneficiary?: string;
    address?: string;
    bankName?: string;
    bankAccount?: string;
    bankCode?: string;
    branchCode?: string;
    bankAddress?: string;
    swiftCode?: string;
  };
  memo?: string;
};

const SYSTEM_PROMPT = `당신은 ERP 거래처 등록 도우미입니다.
업로드된 서류 이미지(사업자등록증, 통장사본/계좌정보, 명함, 견적서, 이메일 캡처 등)와 보조 텍스트에서
거래처(바이어/자재업체/생산공장) 등록에 필요한 정보를 추출하세요.

반드시 JSON 객체만 응답하세요. 마크다운/설명 금지.

스키마:
{
  "suggestedType": "바이어" | "자재거래처" | "공장" | "해외공장" | "물류업체" | "기타" | null,
  "typeHint": "유형 추론 근거 한 줄 (한국어)",
  "name": "거래처 표시명 (짧게)",
  "nameEn": "영문명 또는 빈문자",
  "nameCn": "중문명 또는 빈문자",
  "companyName": "사업자 상호/공식 회사명",
  "bizRegNo": "사업자등록번호 (한국이면 000-00-00000)",
  "address": "사업장 주소",
  "country": "한국|중국|이탈리아|프랑스|일본|미국|기타",
  "currency": "KRW|USD|CNY",
  "contactName": "담당자/대표자",
  "contactPhone": "전화/휴대폰",
  "contactEmail": "일반 연락 이메일",
  "billingEmail": "계산서/세금계산서용 이메일 (없으면 contactEmail과 동일 가능)",
  "wechatId": "위챗ID 또는 빈문자",
  "bankInfo": {
    "beneficiary": "예금주/수취인",
    "address": "수취인 주소",
    "bankName": "은행명",
    "bankAccount": "계좌번호",
    "bankCode": "은행코드",
    "branchCode": "지점코드",
    "bankAddress": "은행주소",
    "swiftCode": "SWIFT"
  },
  "memo": "기타 메모 (없으면 빈문자)"
}

유형 추론 가이드:
- 바이어: 브랜드/유통/발주처, Buyer, Order, Brand
- 자재거래처: 원단/가죽/부자재/하드웨어 공급, Material, Fabric, Leather, Accessory
- 공장/해외공장: OEM/봉제/생산공장, Factory, Manufactur (해외면 해외공장)
- 확실하지 않으면 suggestedType을 null로 두고 typeHint에 질문할 근거만 적기

규칙:
- 이미지에 없는 필드는 "" 또는 생략
- 계좌정보는 통장/이체 안내에서 추출
- 여러 이미지가 있으면 합쳐서 가장 완전한 값 사용
- country 추정: 중국어/중국 은행 → 중국+CNY, 한국 사업자 → 한국+KRW, SWIFT/USD → USD 가능`;

router.post(
  '/api/vendor/ocr',
  upload.array('images', 8),
  async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' });
      return;
    }

    const files = (req.files as Express.Multer.File[] | undefined) || [];
    const notes = String(req.body?.notes || '').trim();
    if (files.length === 0 && !notes) {
      res.status(400).json({ error: '이미지 또는 텍스트 메모가 필요합니다.' });
      return;
    }

    try {
      const content: Anthropic.ContentBlockParam[] = [];
      let imageCount = 0;
      let pdfCount = 0;

      for (const file of files) {
        const mime = (file.mimetype || '').toLowerCase();
        const nameLower = (file.originalname || '').toLowerCase();
        const isPdf = mime === 'application/pdf' || nameLower.endsWith('.pdf');
        const isImage = mime.startsWith('image/')
          || /\.(jpe?g|png|gif|webp)$/i.test(nameLower);

        if (isPdf) {
          content.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: file.buffer.toString('base64'),
            },
          } as Anthropic.ContentBlockParam);
          pdfCount += 1;
          continue;
        }

        if (isImage) {
          let mediaType = mime as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
          if (!mediaType.startsWith('image/')) {
            if (nameLower.endsWith('.png')) mediaType = 'image/png';
            else if (nameLower.endsWith('.webp')) mediaType = 'image/webp';
            else if (nameLower.endsWith('.gif')) mediaType = 'image/gif';
            else mediaType = 'image/jpeg';
          }
          if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) {
            mediaType = 'image/jpeg';
          }
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: file.buffer.toString('base64'),
            },
          });
          imageCount += 1;
        }
      }

      if (content.length === 0 && !notes) {
        res.status(400).json({ error: '지원 형식: 이미지(jpg/png/webp) 또는 PDF' });
        return;
      }

      content.push({
        type: 'text',
        text: [
          SYSTEM_PROMPT,
          notes ? `\n\n[사용자가 붙인 텍스트/이메일/메모]\n${notes}` : '',
          `\n첨부: 이미지 ${imageCount}장, PDF ${pdfCount}개. JSON만 출력.`,
        ].join(''),
      });

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 2048,
        messages: [{ role: 'user', content }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        res.status(422).json({ error: '서류에서 거래처 정보를 추출하지 못했습니다.' });
        return;
      }

      const parsed = JSON.parse(jsonMatch[0]) as VendorOcrResult;
      // 빈 문자열 → undefined 정리
      const clean = (v?: string) => (v && String(v).trim() ? String(v).trim() : undefined);
      const bank = parsed.bankInfo || {};
      const result: VendorOcrResult = {
        suggestedType: parsed.suggestedType || null,
        typeHint: clean(parsed.typeHint),
        name: clean(parsed.name) || clean(parsed.companyName),
        nameEn: clean(parsed.nameEn),
        nameCn: clean(parsed.nameCn),
        companyName: clean(parsed.companyName) || clean(parsed.name),
        bizRegNo: clean(parsed.bizRegNo),
        address: clean(parsed.address),
        country: clean(parsed.country) || '한국',
        currency: parsed.currency || 'KRW',
        contactName: clean(parsed.contactName),
        contactPhone: clean(parsed.contactPhone),
        contactEmail: clean(parsed.contactEmail),
        billingEmail: clean(parsed.billingEmail) || clean(parsed.contactEmail),
        wechatId: clean(parsed.wechatId),
        bankInfo: {
          beneficiary: clean(bank.beneficiary),
          address: clean(bank.address),
          bankName: clean(bank.bankName),
          bankAccount: clean(bank.bankAccount),
          bankCode: clean(bank.bankCode),
          branchCode: clean(bank.branchCode),
          bankAddress: clean(bank.bankAddress),
          swiftCode: clean(bank.swiftCode)?.toUpperCase(),
        },
        memo: clean(parsed.memo),
      };

      // bankInfo 전부 비면 제거
      if (!Object.values(result.bankInfo || {}).some(Boolean)) {
        delete result.bankInfo;
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: `거래처 OCR 오류: ${String(err)}` });
    }
  },
);

router.get('/api/vendor/ocr/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', hasApiKey: !!process.env.ANTHROPIC_API_KEY });
});

export default router;
