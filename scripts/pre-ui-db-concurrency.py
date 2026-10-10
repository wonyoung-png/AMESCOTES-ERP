"""Production-schema, empty isolated DB only: 25 sessions, numbering, retries and CAS.

Run on the Docker host after a schema-only clone. Never targets the production DB.
Fixtures remain in the disposable container; no DELETE/DROP/real-data operations.
"""
import concurrent.futures
import json
import subprocess
import sys
import time
import re

NAME = 'erp-preui-test-20261010'
DB = sys.argv[1] if len(sys.argv) == 2 else 'erp_preui'
assert re.fullmatch(r'erp_preui(?:_[a-z0-9]+)?', DB), 'test database name required'


def sql(statement, allow_failure=False):
    result = subprocess.run(['docker', 'exec', '-i', NAME, 'psql', '-U', 'postgres', '-d', DB,
                             '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                            input=statement, capture_output=True, text=True, timeout=120)
    if not allow_failure and result.returncode:
        raise AssertionError(result.stderr)
    return result


def literal(value):
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def parallel(task):
    with concurrent.futures.ThreadPoolExecutor(max_workers=25) as pool:
        return list(pool.map(task, range(25)))


def main():
    safety = subprocess.run(['docker', 'inspect', '--format',
                             '{{index .Config.Labels "codex.preui"}}|{{.HostConfig.NetworkMode}}', NAME],
                            capture_output=True, text=True, check=True)
    assert safety.stdout.strip() == '20261010|none', 'isolated container label/network mismatch'
    assert sql('select count(*) from production_orders;').stdout.strip() == '0', 'expected empty test DB'
    started = time.monotonic()
    sql("""
      insert into vendors(id,name,code) values('preui_buyer','ISOLATED TEST','PREUI');
      insert into items(id,style_no,name,delivery_price) values('preui_item','PREUI_ITEM','ISOLATED TEST',100);
      insert into production_orders(id,order_no,quantity,status,buyer_id,style_id,style_no,workspace)
      values('preui_race','PREUI_RACE',100,'생산중','preui_buyer','preui_item','PREUI_ITEM','OEM'),
            ('preui_retry','PREUI_RETRY',100,'생산중','preui_buyer','preui_item','PREUI_ITEM','OEM');
    """)
    # Barrier starts 25 real PostgreSQL connections together, not mocked promises.
    import threading
    barrier = threading.Barrier(25)

    def thousand(worker):
        barrier.wait(timeout=30)
        return sql(f"""begin; set local role erp_server;
          do $$ declare i int; r jsonb; begin
            for i in 1..40 loop
              r := save_statement_billing(jsonb_build_object('statement',jsonb_build_object(
                'id','preui_stmt_{worker}_'||i,'vendorId','preui_buyer','vendorName','ISOLATED TEST',
                'vendorCode','PREUI','projectNo','PREUI','workspace','OEM','issueDate','2026-10-10',
                'status','청구완료','lines',jsonb_build_array(jsonb_build_object(
                  'id','line','description','ISOLATED TEST','qty',10,'unitPrice',100,'taxType','과세','taxRate',0.1))),
                'invoiceDate','2026-10-10'));
              assert (r->'settlement'->>'billed_amount_krw')::numeric=1100;
            end loop;
          end $$; commit;""")

    parallel(thousand)
    counts = json.loads(sql("""select json_build_object('statements',count(*),
      'numbers',count(distinct statement_no),'receivables',(select count(*) from settlements),
      'billed',(select sum(billed_amount_krw) from settlements))
      from trade_statements where id like 'preui_stmt_%';""").stdout)
    assert counts == {'statements': 1000, 'numbers': 1000, 'receivables': 1000, 'billed': 1100000}, counts

    def ship(worker):
        barrier.wait(timeout=30)
        body = {'id': f'preui_ship_{worker}', 'orderId': 'preui_race', 'qty': 5,
                'logType': 'outbound_oem', 'deliveryMarket': 'b2b', 'receivedDate': '2026-10-10'}
        return sql(f'begin; set local role erp_server; select record_order_shipment({literal(body)}); commit;', True)

    races = parallel(ship)
    assert sum(r.returncode == 0 for r in races) == 20
    assert all(r.returncode == 0 or 'over_shipment' in r.stderr for r in races)
    assert sql("select shipped_qty from production_orders where id='preui_race';").stdout.strip() == '100'
    assert sql("select count(*) from receipt_logs where order_id='preui_race';").stdout.strip() == '20'
    assert sql("select count(*) from trade_statements where id=(select trade_statement_id from production_orders where id='preui_race');").stdout.strip() == '1'
    same = {'id': 'preui_same_ship', 'orderId': 'preui_retry', 'qty': 100,
            'logType': 'outbound_oem', 'deliveryMarket': 'b2b', 'receivedDate': '2026-10-10'}

    def retry(_):
        barrier.wait(timeout=30)
        return sql(f'begin; set local role erp_server; select record_order_shipment({literal(same)}); commit;')

    retries = parallel(retry)
    assert sum(json.loads(r.stdout)['retry'] is True for r in retries) == 24
    assert sql("select count(*) from receipt_logs where order_id='preui_retry';").stdout.strip() == '1'
    assert sql("select shipped_qty from production_orders where id='preui_retry';").stdout.strip() == '100'
    assert sql("select count(*) from trade_statements where vendor_id='preui_buyer';").stdout.strip() == '1002', 'automatic shipment draft duplicated'
    row = json.loads(sql("select row_to_json(s) from settlements s order by id limit 1;").stdout)
    base = {'id': row['id'], 'buyerId': row['buyer_id'], 'buyerName': row['buyer_name'],
            'workspace': row['workspace'], 'projectNo': row['project_no'], 'channel': row['channel'],
            'invoiceNo': row['invoice_no'], 'invoiceDate': row['invoice_date'], 'dueDate': row['due_date'],
            'billedAmountKrw': row['billed_amount_krw'], 'collectedAmountKrw': 100,
            'collectedDate': '2026-10-10'}

    def collect(worker):
        barrier.wait(timeout=30)
        body = {'settlement': {**base, 'memo': f'writer-{worker}'}, 'expected': row}
        return sql(f'begin; set local role erp_server; select save_settlement({literal(body)}); commit;', True)

    collected = parallel(collect)
    assert sum(r.returncode == 0 for r in collected) == 1
    assert all(r.returncode == 0 or 'stale_settlement' in r.stderr for r in collected)
    winner = json.loads(next(r.stdout for r in collected if not r.returncode))['settlement']
    assert winner['collected_amount_krw'] == 100
    identical = {'settlement': {**base, 'memo': winner['memo']}, 'expected': row}

    def collect_retry(_):
        barrier.wait(timeout=30)
        return sql(f'begin; set local role erp_server; select save_settlement({literal(identical)}); commit;')

    assert all(json.loads(r.stdout)['settlement']['collected_amount_krw'] == 100 for r in parallel(collect_retry))
    print(json.dumps({'isolated': True, 'db_sessions': 25, 'statements': 1000, 'unique_numbers': 1000,
                      'shipment_success': 20, 'over_shipment_rejected': 5, 'identical_shipment_retries': 24,
                      'collection_success': 1, 'stale_collection_rejected': 24, 'collection_retries': 25,
                      'seconds': round(time.monotonic() - started, 2)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
