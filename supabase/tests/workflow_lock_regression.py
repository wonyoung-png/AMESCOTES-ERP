"""Two DB sessions verify the advisory locks used by shipment/billing, without data writes."""
import subprocess
import uuid

command = ["docker", "exec", "-i", "app-db-1", "sh", "-c",
           'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At']
key = "test_atomic_lock_" + uuid.uuid4().hex
locks = [f"hashtextextended('receipt:{key}',0)", f"hashtextextended('statement:{key}',0)",
         f"hashtextextended('invoice:{key}',0)", f"hashtext('ts:{key}')", f"hashtextextended('settlement:{key}',0)"]
for lock in locks:
    holder = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True)
    try:
        holder.stdin.write(f"begin; select pg_advisory_xact_lock({lock});\n\\echo LOCK_HELD\n")
        holder.stdin.flush()
        for line in holder.stdout:
            if line.strip() == "LOCK_HELD":
                break
        else:
            raise AssertionError("holder did not acquire lock")
        blocked = subprocess.run(command, input=f"begin; set local lock_timeout='300ms'; select pg_advisory_xact_lock({lock}); rollback;",
                                 capture_output=True, text=True, timeout=10)
        assert blocked.returncode != 0 and "lock timeout" in blocked.stderr, "second session was not serialized"
    finally:
        if holder.poll() is None:
            holder.stdin.write("rollback;\n")
            holder.stdin.close()
            holder.stdin = None
        _, error = holder.communicate(timeout=10)
        assert holder.returncode == 0, error
    released = subprocess.run(command, input=f"begin; set local lock_timeout='300ms'; select pg_advisory_xact_lock({lock}); rollback;",
                              capture_output=True, text=True, timeout=10)
    assert released.returncode == 0, "rollback did not release lock"
print(f"workflow lock checks={len(locks)*2} PASS; no data writes")
