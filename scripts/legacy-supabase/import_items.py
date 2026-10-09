#!/usr/bin/env python3
"""
엑셀 상품목록 → Supabase items 테이블 일괄 등록
파싱 규칙:
  - Col4 (index 3): 상품명 (name)
  - Col14 (index 13): 판매가 (delivery_price 로 저장)
  - Col15 (index 14): 컬러별 스타일번호 (예: LLL6S82SB)
    → style_no: 끝 2~4자리 대문자 컬러코드 제거 (예: LLL6S82)
    → colorCode: 끝 2~4자리 대문자 정규식 추출
"""

import openpyxl
import re
import uuid
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

import os
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://linzfvhgswrnoukssqyi.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")  # .env 또는 환경변수로 설정
EXCEL_PATH = "/Users/leewonyoung/.openclaw/media/inbound/전체상품목록_20260413103528_5901522---ce9f5bd7-8693-4ac2-9cf8-6ae78b7a4dc3.xlsx"

def supabase_get(path, params=None):
    from urllib.parse import urlencode
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += "?" + urlencode(params)
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read()), None
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return None, f"HTTP {e.code}: {body}"

def supabase_post(path, data, prefer="return=minimal"):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            content = resp.read()
            return (json.loads(content) if content else []), None
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return None, f"HTTP {e.code}: {body}"

def get_existing_style_nos():
    result, err = supabase_get("items", {"select": "style_no"})
    if err:
        print(f"⚠️  기존 데이터 조회 실패: {err}")
        return set()
    return {r["style_no"] for r in result} if result else set()

def extract_color_code(full_style: str) -> tuple:
    """
    예: LLL6S82SB → ('LLL6S82', 'SB')
        LSL6S44KB → ('LSL6S44', 'KB')
    """
    m = re.search(r'([A-Z]{2,4})$', full_style)
    if m:
        color_code = m.group(1)
        style_no = full_style[: -len(color_code)]
        # 스타일번호가 너무 짧으면 컬러코드 없는 것으로 처리
        if len(style_no) < 3:
            return full_style, ""
        return style_no, color_code
    return full_style, ""

def parse_excel() -> dict:
    wb = openpyxl.load_workbook(EXCEL_PATH)
    ws = wb.active

    items = {}  # style_no → item dict
    skipped = 0

    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), 2):
        if not row or len(row) < 15:
            skipped += 1
            continue

        name = row[3]        # Col4
        sale_price = row[13] # Col14
        full_style = row[14] # Col15

        if not full_style or not name:
            skipped += 1
            continue

        full_style = str(full_style).strip()
        name = str(name).strip()

        style_no, color_code = extract_color_code(full_style)

        if not style_no:
            skipped += 1
            continue

        try:
            price_val = int(float(str(sale_price))) if sale_price else None
        except (ValueError, TypeError):
            price_val = None

        if style_no not in items:
            items[style_no] = {
                "id": str(uuid.uuid4()),
                "style_no": style_no,
                "name": name,
                "season": "26SS",
                "erp_category": "HB",
                "material": "",
                "has_bom": False,
                "delivery_price": price_val or 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "colors": [],
            }

        if color_code:
            existing_colors = items[style_no]["colors"]
            if not any(c.get("name") == color_code for c in existing_colors):
                items[style_no]["colors"].append({"name": color_code})

    print(f"파싱 완료: {len(items)}개 스타일, 스킵: {skipped}행")
    return items

def main():
    print("=" * 60)
    print("엑셀 → Supabase items 일괄 등록")
    print("=" * 60)

    # 1. 파싱
    parsed = parse_excel()
    print(f"총 파싱된 스타일 수: {len(parsed)}")

    # 샘플 확인
    for k in list(parsed.keys())[:3]:
        v = parsed[k]
        print(f"  {k}: {v['name'][:35]} | 컬러: {[c['name'] for c in v['colors'][:3]]} | 가격: {v['delivery_price']}")

    # 2. 기존 데이터 확인
    print("\n기존 데이터 확인 중...")
    existing = get_existing_style_nos()
    print(f"기존 등록: {len(existing)}개")

    # 3. 신규만 필터
    new_items = {k: v for k, v in parsed.items() if k not in existing}
    skip_count = len(parsed) - len(new_items)
    print(f"신규 등록 대상: {len(new_items)}개 | 중복 스킵: {skip_count}개")

    if not new_items:
        print("\n✅ 모든 데이터가 이미 등록되어 있습니다.")
        return

    # 4. 배치 upsert
    items_list = list(new_items.values())
    BATCH = 50
    success = 0
    fail = 0

    for i in range(0, len(items_list), BATCH):
        batch = items_list[i:i+BATCH]
        result, err = supabase_post("items", batch)
        if err:
            print(f"  배치 {i//BATCH+1} 실패: {err[:200]}")
            # 개별 재시도
            for item in batch:
                r2, e2 = supabase_post("items", [item])
                if e2:
                    print(f"    실패 ({item['style_no']}): {e2[:150]}")
                    fail += 1
                else:
                    success += 1
        else:
            success += len(batch)
            print(f"  배치 {i//BATCH+1}: {len(batch)}개 등록 완료")

    print(f"\n{'='*60}")
    print(f"✅ 완료!")
    print(f"   등록 성공: {success}개")
    print(f"   중복 스킵: {skip_count}개")
    print(f"   실패: {fail}개")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
