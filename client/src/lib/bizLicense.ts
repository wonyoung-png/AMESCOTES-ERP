// 사업자등록증 OCR - Gemini Vision API 사용

const GEMINI_API_KEY = 'AIzaSyAmPZXVBWUkuPA84ad-T238wW81QyyGvf0';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

export interface BizLicenseInfo {
  companyName: string;        // 회사명 (상호)
  bizRegNo: string;           // 사업자등록번호 (000-00-00000 형식)
  representativeName: string; // 대표자명
  email: string;              // 이메일 주소 (없으면 빈 문자열)
  address: string;            // 사업장 소재지
}

interface GeminiPart {
  inlineData?: {
    mimeType: string;
    data: string;
  };
  text?: string;
}

interface GeminiContent {
  parts: GeminiPart[];
}

interface GeminiRequestBody {
  contents: GeminiContent[];
}

interface GeminiCandidate {
  content: {
    parts: { text: string }[];
  };
}

interface GeminiResponse {
  candidates: GeminiCandidate[];
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // data:image/jpeg;base64,xxxx → xxxx 부분만 추출
      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new Error('Base64 변환 실패'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

function getMimeType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'image/jpeg';
  }
}

const PROMPT = `이 사업자등록증에서 다음 정보를 추출해 JSON으로만 답하세요 (설명 없이):
{
  "companyName": "상호(회사명)",
  "bizRegNo": "사업자등록번호 (000-00-00000 형식)",
  "representativeName": "대표자명",
  "email": "이메일 주소 (없으면 빈 문자열)",
  "address": "사업장 소재지"
}`;

export async function parseBizLicense(file: File): Promise<BizLicenseInfo> {
  const base64Data = await fileToBase64(file);
  const mimeType = getMimeType(file);

  const body: GeminiRequestBody = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          {
            text: PROMPT,
          },
        ],
      },
    ],
  };

  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini API 오류 (${response.status}): ${errText}`);
  }

  const data: GeminiResponse = await response.json() as GeminiResponse;

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API 응답에서 텍스트를 찾을 수 없습니다');
  }

  // JSON 파싱 (```json ... ``` 블록 처리)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : text.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`JSON 파싱 실패: ${jsonStr}`);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('companyName' in parsed) ||
    !('bizRegNo' in parsed) ||
    !('representativeName' in parsed)
  ) {
    throw new Error('사업자등록증 정보를 인식하지 못했습니다');
  }

  const obj = parsed as Record<string, unknown>;

  return {
    companyName: typeof obj.companyName === 'string' ? obj.companyName : '',
    bizRegNo: typeof obj.bizRegNo === 'string' ? obj.bizRegNo : '',
    representativeName: typeof obj.representativeName === 'string' ? obj.representativeName : '',
    email: typeof obj.email === 'string' ? obj.email : '',
    address: typeof obj.address === 'string' ? obj.address : '',
  };
}
