"""PMS(SQLite) → NDJSON 내보내기. PMS 컨테이너 안에서 돌린다 (읽기만 한다).

    docker exec app-daily-1 python /app/../pms_export.py /data/daily.db /tmp/pms_export.ndjson

한 줄 = {"t": 테이블, ...칼럼}. 브랜드 접두어(aetaloof::이름)는 brand 칼럼으로 푼다 (core.bkey 의 역).
받는 쪽: scripts/pms-import.mjs. 계획: docs/PMS_MERGE_PLAN.md
"""
import json
import sqlite3
import sys

BRANDS = ("lumen", "aetaloof")


def split(key: str):
    """'aetaloof::재고관리' → ('aetaloof', '재고관리'), 접두어 없으면 lumen"""
    if "::" in key:
        b, rest = key.split("::", 1)
        if b in BRANDS:
            return b, rest
    return "lumen", key


def main(db_path: str, out_path: str):
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)  # 읽기 전용 — 운영 DB 를 건드리지 않는다
    tables = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
    n = {}
    with open(out_path, "w", encoding="utf-8") as f:
        def put(t, d):
            f.write(json.dumps({"t": t, **d}, ensure_ascii=False) + "\n")
            n[t] = n.get(t, 0) + 1

        for key, headers, rows in con.execute("select name, headers, rows from sheets"):
            b, name = split(key)
            put("pms_sheets", {"brand": b, "name": name, "headers": json.loads(headers or "[]"), "rows": json.loads(rows or "[]")})
        if "meta" in tables:
            for key, val in con.execute("select key, val from meta"):
                b, k = split(key)
                put("pms_meta", {"brand": b, "key": k, "val": val})
        if "sales" in tables:
            for row in con.execute("select brand, date, channel, sku, title, qty, amount from sales"):
                put("pms_sales", dict(zip(("brand", "date", "channel", "sku", "title", "qty", "amount"), row)))
        # cache 는 다시 계산되는 값이라 옮기지 않는다
    con.close()
    print(json.dumps(n, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
