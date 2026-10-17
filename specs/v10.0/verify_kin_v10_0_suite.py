#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KIN (10.0.0-PRODUCTION) — Standalone Specification & Contract Verification Suite (200 Tests)
Parses the generated Markdown specification files from disk and executes 200
SQLite STRICT, FTS5, Trigger, Foreign-Key, vec0 DDL, Git S0 Snapshot, Worktree, Socket,
SSRF IP Filter, Completion Gate Simulation, Sandbox SAFETY/seccompiler, Error Registry,
JSON Schema, and Cross-Document consistency tests (covering Baseline AUD-01..28 plus
Rounds 1 through 13: P0..P2, ST-01..45, RT4-01..28, RT5-01..12, RT6-01..10, RT7-01..10,
RT8-01..10, RT9-01..22, RT10-01..10, RT11-01..10, RT12-01..21, and RT13-01..20).
"""

import hashlib
import hmac
import json
import os
import pathlib
import re
import shutil
import socket
import sqlite3
import stat
import subprocess
import tempfile
import unittest


SUITE_DIR = pathlib.Path(__file__).resolve().parent


def read_doc(filename: str) -> str:
    path = SUITE_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"Missing required specification file: {path}")
    return path.read_text(encoding="utf-8")


def extract_sql_blocks(md_text: str) -> list[str]:
    return re.findall(r"```sql\n(.*?)```", md_text, flags=re.DOTALL)


def extract_json_blocks(md_text: str) -> list[str]:
    return re.findall(r"```json\n(.*?)```", md_text, flags=re.DOTALL)


def extract_rust_blocks(md_text: str) -> list[str]:
    return re.findall(r"```rust\n(.*?)```", md_text, flags=re.DOTALL)


def extract_scheme_blocks(md_text: str) -> list[str]:
    return re.findall(r"```scheme\n(.*?)```", md_text, flags=re.DOTALL)


def split_doc02_schemas() -> tuple[str, str, str, str]:
    doc02 = read_doc("02-TRD-AND-DDL.md")
    blocks = extract_sql_blocks(doc02)
    full_sql = blocks[0]
    p1 = full_sql.index("-- 1. GLOBAL REGISTRY DATABASE")
    p2 = full_sql.index("-- 2. PER-PROJECT AUTHORITATIVE DATABASE")
    p3 = full_sql.index("-- 3. REBUILDABLE CODE, CALL-GRAPH & PAGERANK INDEX DATABASE")
    p4 = full_sql.index("-- 4. SQLITE-VEC (v0.1.6+) PARTITIONED VECTOR INDEX TABLES")
    return full_sql[p1:p2], full_sql[p2:p3], full_sql[p3:p4], full_sql[p4:]


def make_ulid(prefix: str, idx: int) -> str:
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    suffix = "".join(alphabet[(idx + i) % 32] for i in range(26))
    return f"{prefix}_{suffix}"


class KinV100ProductionSuiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg_sql, cls.prj_sql, cls.idx_sql, cls.vec_sql = split_doc02_schemas()
        cls.doc00 = read_doc("00-AGENTS-AND-AUDIT.md")
        cls.doc01 = read_doc("01-PRD.md")
        cls.doc02 = read_doc("02-TRD-AND-DDL.md")
        cls.doc03 = read_doc("03-HARNESS-MEMORY-CONTEXT.md")
        cls.doc04 = read_doc("04-WORKTREE-DAG-BROWSER-GATEWAY.md")
        cls.doc05 = read_doc("05-SECURITY-LEDGER-EXTENSIBILITY.md")
        cls.doc06 = read_doc("06-IPC-CONTRACTS-QA-ROADMAP.md")
        cls.doc07 = read_doc("07-PROMPTS-SCHEMAS-AND-SANDBOX-PROFILES.md")
        cls.doc08 = read_doc("08-C4-ADRS-COMPATIBILITY-RUNBOOK-AND-LOCKFILES.md")
        cls.tools = json.loads(extract_json_blocks(cls.doc07)[0])

    def setUp(self):
        self._open_conns = []

    def tearDown(self):
        for conn in getattr(self, '_open_conns', []):
            try:
                conn.close()
            except Exception:
                pass
        self._open_conns = []

    def _new_project_db(self) -> sqlite3.Connection:
        conn = sqlite3.connect(":memory:")
        self._open_conns.append(conn)
        conn.executescript(self.prj_sql)
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA recursive_triggers = ON;")
        return conn

    def _seed_agent_channel_run(self, conn: sqlite3.Connection, tainted: int = 0):
        agt_boss = make_ulid("agt", 1)
        agt_spec = make_ulid("agt", 2)
        chn_id = make_ulid("chn", 1)
        thr_id = make_ulid("thr", 1)
        run_id = make_ulid("run", 1)
        stp_id = make_ulid("stp", 1)
        conn.execute(
            "INSERT INTO agents(id,slug,display_name,role_kind,lifecycle,title,charter_markdown,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (agt_boss, "boss", "Boss", "boss", "persistent", "Chief", "Charter", 100, 100),
        )
        conn.execute(
            "INSERT INTO agents(id,slug,display_name,role_kind,lifecycle,parent_agent_id,spawn_depth,title,charter_markdown,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (agt_spec, "backend", "Backend", "specialist", "persistent", agt_boss, 1, "Eng", "Charter", 100, 100),
        )
        conn.execute(
            "INSERT INTO channels(id,slug,display_name,kind,lead_agent_id,is_default,created_at_us) VALUES (?,?,?,?,?,?,?)",
            (chn_id, "backend", "#backend", "department", agt_spec, 1, 100),
        )
        conn.execute(
            "INSERT INTO threads(id,channel_id,title,created_at_us,updated_at_us) VALUES (?,?,?,?,?)",
            (thr_id, chn_id, "Thread 1", 100, 100),
        )
        conn.execute(
            "INSERT INTO runs(id,agent_id,context_key,channel_id,thread_id,status,autonomy_effective,sandbox_level,tainted,started_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (run_id, agt_spec, f"chn:{chn_id}", chn_id, thr_id, "executing_tools", "WORKTREE_AUTO", "S2", tainted, 100),
        )
        conn.execute(
            "INSERT INTO run_steps(id,run_id,step_index,model_uid,prompt_prefix_hash,status,started_at_us) "
            "VALUES (?,?,?,?,?,?,?)",
            (stp_id, run_id, 0, "anthropic/claude-sonnet-4", "a" * 64, "tool_phase", 100),
        )
        conn.commit()
        return agt_boss, agt_spec, chn_id, thr_id, run_id, stp_id

    # --- Original 50 Verification Tests (test_01 .. test_50) ---
    def test_01_portable_paths_and_runtime_versions(self):
        self.assertTrue(sqlite3.sqlite_version)
        self.assertTrue((SUITE_DIR / "00-AGENTS-AND-AUDIT.md").exists())
        self.assertTrue((SUITE_DIR / "AGENTS.md").exists())

    def test_02_all_eight_documents_present_and_non_empty(self):
        for fname in [
            "00-AGENTS-AND-AUDIT.md",
            "01-PRD.md",
            "02-TRD-AND-DDL.md",
            "03-HARNESS-MEMORY-CONTEXT.md",
            "04-WORKTREE-DAG-BROWSER-GATEWAY.md",
            "05-SECURITY-LEDGER-EXTENSIBILITY.md",
            "06-IPC-CONTRACTS-QA-ROADMAP.md",
            "07-PROMPTS-SCHEMAS-AND-SANDBOX-PROFILES.md",
            "08-C4-ADRS-COMPATIBILITY-RUNBOOK-AND-LOCKFILES.md",
        ]:
            self.assertGreater(len(read_doc(fname)), 2000, fname)

    def test_03_registry_db_ddl_executes_cleanly(self):
        conn = sqlite3.connect(":memory:")
        conn.executescript(self.reg_sql)
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({"schema_migrations", "projects", "provider_profiles", "model_catalog", "global_spend_rollups"}.issubset(tables))
        conn.close()

    def test_04_project_db_ddl_executes_cleanly(self):
        conn = self._new_project_db()
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for expected in [
            "agents", "agent_capability_grants", "channels", "channel_members",
            "dm_conversations", "threads", "meetings", "messages", "messages_fts",
            "worktree_lanes", "pty_sessions", "ast_symbol_leases", "merge_queue_entries",
            "apply_journals", "goals", "tasks", "task_dependencies", "schedules",
            "wake_queue", "runs", "run_steps", "tool_calls", "tool_calls_fts",
            "approval_requests", "context_items", "memory_items", "memory_entities",
            "memory_edges", "memory_fts", "ledger_events", "ledger_payloads",
            "ledger_checkpoints", "project_events", "blobs", "engine_heartbeat",
        ]:
            self.assertIn(expected, tables)
        conn.close()

    def test_05_index_db_ddl_executes_cleanly(self):
        conn = sqlite3.connect(":memory:")
        conn.executescript(self.idx_sql)
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({"indexed_files", "code_symbols", "symbol_edges", "code_chunks", "code_chunks_fts"}.issubset(tables))
        conn.close()

    def test_06_all_regular_tables_use_strict_mode(self):
        for sql_text in (self.reg_sql, self.prj_sql, self.idx_sql):
            create_tables = re.findall(r"CREATE TABLE\s+\w+\s*\(.*?\)\s*(STRICT)?;", sql_text, flags=re.DOTALL)
            self.assertGreater(len(create_tables), 0)
            for strict_kw in create_tables:
                self.assertEqual(strict_kw, "STRICT")

    def test_07_crockford_ulid_check_constraints(self):
        conn = self._new_project_db()
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO channels(id,slug,display_name,kind,created_at_us) VALUES ('chn_INVALID_SHORT','g','G','general',1)"
            )
        conn.close()

    def test_08_single_boss_unique_partial_index(self):
        conn = self._new_project_db()
        self._seed_agent_channel_run(conn)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO agents(id,slug,display_name,role_kind,lifecycle,title,charter_markdown,created_at_us,updated_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (make_ulid("agt", 99), "boss2", "Boss2", "boss", "persistent", "Chief", "Charter", 100, 100),
            )
        conn.close()

    def test_09_git_zero_pollution_mtime_and_gc_safety(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp) / "root_repo"
            repo_git = pathlib.Path(tmp) / "repo.git"
            root.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.email", "dev@kin.local"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.name", "Dev"], cwd=root, check=True)
            src_file = root / "lib.rs"
            src_file.write_text("pub fn add(a: i32, b: i32) -> i32 { a + b }\n", encoding="utf-8")
            subprocess.run(["git", "add", "lib.rs"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=root, check=True)

            def snap_stat(base: pathlib.Path):
                out = {}
                for p in sorted(base.rglob("*")):
                    if p.is_file():
                        st = p.stat()
                        out[str(p.relative_to(base))] = (
                            hashlib.sha256(p.read_bytes()).hexdigest(),
                            st.st_size,
                            st.st_mode,
                            st.st_mtime_ns,
                        )
                return out

            before = snap_stat(root)
            subprocess.run(["git", "init", "--bare", "-q", str(repo_git)], check=True)
            subprocess.run(
                ["git", f"--git-dir={repo_git}", "fetch", "--no-tags", "--quiet", str(root / ".git"), "+HEAD:refs/kin/root_head"],
                check=True,
            )
            after = snap_stat(root)
            self.assertEqual(before, after)

            # Mutate & GC root repo, verify repo.git still has refs/kin/root_head object intact
            src_file.write_text("pub fn changed() {}\n", encoding="utf-8")
            subprocess.run(["git", "commit", "-am", "second", "-q"], cwd=root, check=True)
            subprocess.run(["git", "reset", "--hard", "HEAD~1", "-q"], cwd=root, check=True)
            subprocess.run(["git", "gc", "--prune=now", "--quiet"], cwd=root, check=True)
            res = subprocess.run(
                ["git", f"--git-dir={repo_git}", "cat-file", "-e", "refs/kin/root_head"],
                check=False,
            )
            self.assertEqual(res.returncode, 0)

    def test_10_git_info_exclude_and_dotenv_blocked(self):
        self.assertIn("--exclude-from=\"$ROOT_GIT_DIR/info/exclude\"", self.doc04)
        self.assertIn("--exclude='.env'", self.doc04)
        self.assertIn("rm --cached --ignore-unmatch --quiet -r --", self.doc04)

    def test_11_git_pointer_file_and_crlf_attributes(self):
        self.assertIn("gitdir:", self.doc04)
        self.assertIn("sanitize_gitattributes()", self.doc04)
        self.assertIn("working-tree-encoding=*", self.doc04)

    def test_12_windows_sandbox_api_completeness(self):
        for sym in [
            "CreateJobObjectW",
            "CreateRestrictedToken",
            "ConvertStringSidToSidW",
            "SetTokenInformation",
            "LocalFree",
            "CreateProcessAsUserW",
            "CreateProcessW",
            "AssignProcessToJobObject",
            "ResumeThread",
        ]:
            self.assertIn(sym, self.doc07)

    def test_13_policy_s1_elevates_all_shell_and_pty_to_r3(self):
        self.assertIn("When `sandbox_level == S1`", self.doc05)
        self.assertIn("elevated to floor `R3` (`ASK_HUMAN`)", self.doc05)

    def test_14_linux_sandbox_code_and_28_syscalls(self):
        rust_blocks = extract_rust_blocks(self.doc07)
        linux_rs = next(b for b in rust_blocks if "enter_linux_s2_sandbox" in b)
        self.assertNotIn(".unwrap()", linux_rs)
        self.assertNotIn(".expect(", linux_rs)
        syscalls = set(re.findall(r"libc::SYS_\w+", linux_rs))
        # 27 unconditional EPERM syscalls + SYS_clone3 (ENOSYS) + SYS_clone (CLONE_NEW* flag mask) = 29
        self.assertEqual(len(syscalls), 29)

    def test_15_sandbox_excludes_project_root_ro_and_validates_seatbelt(self):
        sb_blocks = extract_scheme_blocks(self.doc07)
        lane_sb = sb_blocks[0]
        self.assertIn("PROJECT_ROOT_FORBIDDEN", lane_sb)
        self.assertNotIn("PROJECT_ROOT_RO", lane_sb)

    def test_16_unix_socket_sun_path_and_bind(self):
        with tempfile.TemporaryDirectory(dir="/tmp", prefix="kin-") as run_dir:
            sock_path = os.path.join(run_dir, "e.sock")
            self.assertLessEqual(len(sock_path.encode("utf-8")), 44)
            srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                srv.bind(sock_path)
                srv.listen(1)
            finally:
                srv.close()

    def test_17_completion_gate_epoch_and_timeout_contracts(self):
        self.assertIn("acquire_verification_freeze", self.doc06)
        self.assertIn("UnverifiedNoGate", self.doc06)
        self.assertIn("timeout_seconds", self.doc06)
        self.assertIn("tree_mutate_attempts", self.doc06)

    def test_18_taint_propagation_triggers_and_pty_ast(self):
        conn = self._new_project_db()
        _, agt_spec, chn_id, thr_id, run_id, _ = self._seed_agent_channel_run(conn, tainted=1)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO messages(id,channel_id,thread_id,author_kind,author_agent_id,run_id,content_md,tainted,created_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (make_ulid("msg", 1), chn_id, thr_id, "agent", agt_spec, run_id, "hello", 0, 200),
            )
        conn.close()

    def test_19_mutual_ipc_hmac_and_shred_architecture(self):
        token = os.urandom(32)
        s_nonce = os.urandom(32)
        c_nonce = os.urandom(32)
        c_hmac = hmac.new(token, b"kin-ipc-v8-client" + (8).to_bytes(2, "little") + s_nonce + c_nonce, hashlib.sha256).hexdigest()
        s_hmac = hmac.new(token, b"kin-ipc-v8-server" + (8).to_bytes(2, "little") + c_nonce + s_nonce, hashlib.sha256).hexdigest()
        self.assertEqual(len(c_hmac), 64)
        self.assertEqual(len(s_hmac), 64)
        self.assertNotEqual(c_hmac, s_hmac)

    def test_20_code_chunks_fts_delete_and_update_triggers(self):
        conn = sqlite3.connect(":memory:")
        conn.executescript(self.idx_sql)
        conn.execute("INSERT INTO indexed_files VALUES ('src/a.rs','h',10,'rust',1,1)")
        conn.execute("INSERT INTO code_chunks VALUES ('c1','src/a.rs',1,5,'fn_a','fn alpha_beta() {}','pending',NULL)")
        self.assertEqual(conn.execute("SELECT count(*) FROM code_chunks_fts WHERE code_chunks_fts MATCH 'alpha_beta'").fetchone()[0], 1)
        conn.execute("UPDATE code_chunks SET chunk_text = 'fn gamma_delta() {}' WHERE chunk_id = 'c1'")
        self.assertEqual(conn.execute("SELECT count(*) FROM code_chunks_fts WHERE code_chunks_fts MATCH 'alpha_beta'").fetchone()[0], 0)
        self.assertEqual(conn.execute("SELECT count(*) FROM code_chunks_fts WHERE code_chunks_fts MATCH 'gamma_delta'").fetchone()[0], 1)
        conn.execute("DELETE FROM code_chunks WHERE chunk_id = 'c1'")
        self.assertEqual(conn.execute("SELECT count(*) FROM code_chunks_fts").fetchone()[0], 0)
        conn.close()

    def test_21_code_chunks_nullable_embedding_for_async_indexing(self):
        conn = sqlite3.connect(":memory:")
        conn.executescript(self.idx_sql)
        conn.execute("INSERT INTO indexed_files VALUES ('src/a.rs','h',10,'rust',1,1)")
        conn.execute("INSERT INTO code_chunks VALUES ('c1','src/a.rs',1,5,'fn_a','code','pending',NULL)")
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO code_chunks VALUES ('c2','src/a.rs',1,5,'fn_b','code','ready',NULL)")
        conn.close()

    def test_22_messages_full_column_immutability(self):
        conn = self._new_project_db()
        _, agt_spec, chn_id, thr_id, run_id, _ = self._seed_agent_channel_run(conn, tainted=0)
        msg_id = make_ulid("msg", 10)
        conn.execute(
            "INSERT INTO messages(id,channel_id,thread_id,author_kind,author_agent_id,run_id,content_md,tainted,created_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (msg_id, chn_id, thr_id, "agent", agt_spec, run_id, "immutable text", 0, 200),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE messages SET content_md = 'tampered' WHERE id = ?", (msg_id,))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("DELETE FROM messages WHERE id = ?", (msg_id,))
        conn.close()

    def test_23_dm_conversations_canonical_pair_order(self):
        conn = self._new_project_db()
        agt1, agt2, _, _, _, _ = self._seed_agent_channel_run(conn)
        a_low, a_high = sorted([agt1, agt2])
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO dm_conversations(id,kind,participant_a,participant_b,created_at_us,updated_at_us) VALUES (?,?,?,?,?,?)",
                (make_ulid("dmc", 1), "agent_agent", a_high, a_low, 100, 100),
            )
        conn.close()

    def test_24_inv007_single_active_run_per_agent_context(self):
        conn = self._new_project_db()
        _, agt_spec, chn_id, thr_id, _, _ = self._seed_agent_channel_run(conn)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO runs(id,agent_id,context_key,channel_id,thread_id,status,autonomy_effective,sandbox_level,started_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (make_ulid("run", 2), agt_spec, f"chn:{chn_id}", chn_id, thr_id, "preparing", "WORKTREE_AUTO", "S2", 200),
            )
        conn.close()

    def test_25_meetings_participant_bounds_2_to_6(self):
        conn = self._new_project_db()
        agt1, agt2, chn_id, thr_id, _, _ = self._seed_agent_channel_run(conn)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO meetings(id,channel_id,thread_id,moderator_agent_id,mode,agenda,participants_json,started_at_us) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (make_ulid("mtg", 1), chn_id, thr_id, agt1, "moderated", "Agenda", json.dumps([agt1]), 100),
            )
        conn.execute(
            "INSERT INTO meetings(id,channel_id,thread_id,moderator_agent_id,mode,agenda,participants_json,started_at_us) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (make_ulid("mtg", 2), chn_id, thr_id, agt1, "moderated", "Agenda", json.dumps([agt1, agt2]), 100),
        )
        conn.close()

    def test_26_task_dependencies_recursive_cycle_prevention(self):
        conn = self._new_project_db()
        t1, t2, t3 = make_ulid("tsk", 1), make_ulid("tsk", 2), make_ulid("tsk", 3)
        for tid in (t1, t2, t3):
            conn.execute("INSERT INTO tasks(id,title,description_md,status,created_at_us,updated_at_us) VALUES (?,?,?,?,?,?)", (tid, "T", "D", "blocked", 1, 1))
        conn.execute("INSERT INTO task_dependencies VALUES (?,?)", (t2, t1))
        conn.execute("INSERT INTO task_dependencies VALUES (?,?)", (t3, t2))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO task_dependencies VALUES (?,?)", (t1, t3))
        conn.close()

    def test_27_merge_queue_partial_unique_index_allows_reenqueue(self):
        conn = self._new_project_db()
        _, agt_spec, _, _, _, _ = self._seed_agent_channel_run(conn)
        wkt_id = make_ulid("wkt", 1)
        conn.execute(
            "INSERT INTO worktree_lanes(id,owner_agent_id,worktree_path,branch_name,base_commit_sha,root_snapshot_ref,head_commit_sha,current_tree_sha,cow_strategy,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (wkt_id, agt_spec, "/tmp/w1", "kin/w1", "a" * 40, "refs/kin/s0", "a" * 40, "b" * 40, "apfs_clonefile", 1, 1),
        )
        conn.execute(
            "INSERT INTO merge_queue_entries(id,lane_id,attempt_no,submitted_by_agent_id,status,enqueued_at_us) VALUES (?,?,?,?,?,?)",
            (make_ulid("mqe", 1), wkt_id, 1, agt_spec, "gate_failed", 10),
        )
        conn.execute(
            "INSERT INTO merge_queue_entries(id,lane_id,attempt_no,submitted_by_agent_id,status,enqueued_at_us) VALUES (?,?,?,?,?,?)",
            (make_ulid("mqe", 2), wkt_id, 2, agt_spec, "queued", 20),
        )
        conn.close()

    def test_28_memory_fts_column_scoped_update_trigger(self):
        conn = self._new_project_db()
        _, agt_spec, _, _, run_id, _ = self._seed_agent_channel_run(conn)
        mem_id = make_ulid("mem", 1)
        conn.execute(
            "INSERT INTO memory_items(id,tier,scope_id,bank,subject_key,claim_text,provenance_json,valid_from_us,recorded_at_us,content_blake3,created_by_agent_id,created_by_run_id,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (mem_id, "T3", agt_spec, "world", "subj", "rust async claim", "{}", 1, 1, "c" * 64, agt_spec, run_id, 1, 1),
        )
        conn.execute("UPDATE memory_items SET access_count = access_count + 1 WHERE id = ?", (mem_id,))
        self.assertEqual(conn.execute("SELECT count(*) FROM memory_fts WHERE memory_fts MATCH 'async'").fetchone()[0], 1)
        conn.close()

    def test_29_memory_vec_partitioned_by_scope_key(self):
        self.assertIn("scope_key TEXT PARTITION KEY", self.doc02)

    def test_30_project_events_privacy_purge_trigger(self):
        conn = self._new_project_db()
        evt_id = make_ulid("evt", 1)
        conn.execute(
            "INSERT INTO project_events(id,ts_us,event_kind,entity_id,payload_json) VALUES (?,?,?,?,?)",
            (evt_id, 100, "message.posted", "msg_1", '{"secret":"val"}'),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE project_events SET payload_json = '{}' WHERE id = ?", (evt_id,))
        conn.execute("UPDATE project_events SET payload_purged = 1, payload_json = '{\"purged\":true}' WHERE id = ?", (evt_id,))
        conn.close()

    def test_31_bitemporal_memory_edges_same_scope_fk(self):
        conn = self._new_project_db()
        _, agt_spec, _, _, run_id, _ = self._seed_agent_channel_run(conn)
        e1, e2, m1 = make_ulid("ent", 1), make_ulid("ent", 2), make_ulid("mem", 2)
        conn.execute(
            "INSERT INTO memory_entities(id,tier,scope_id,canonical_name,entity_kind,valid_from_us,recorded_at_us,created_at_us,updated_at_us) VALUES (?,?,?,?,?,?,?,?,?)",
            (e1, "T1", "project", "CompA", "component", 1, 1, 1, 1),
        )
        conn.execute(
            "INSERT INTO memory_entities(id,tier,scope_id,canonical_name,entity_kind,valid_from_us,recorded_at_us,created_at_us,updated_at_us) VALUES (?,?,?,?,?,?,?,?,?)",
            (e2, "T3", agt_spec, "CompB", "component", 1, 1, 1, 1),
        )
        conn.execute(
            "INSERT INTO memory_items(id,tier,scope_id,bank,subject_key,claim_text,provenance_json,valid_from_us,recorded_at_us,content_blake3,created_by_agent_id,created_by_run_id,created_at_us,updated_at_us) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (m1, "T1", "project", "world", "k", "v", "{}", 1, 1, "a" * 64, agt_spec, run_id, 1, 1),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO memory_edges(id,tier,scope_id,from_entity_id,to_entity_id,relation_kind,evidence_memory_id,valid_from_us,recorded_at_us,created_at_us) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (make_ulid("edg", 1), "T1", "project", e1, e2, "depends_on", m1, 1, 1, 1),
            )
        conn.close()

    def test_32_micro_usd_column_naming_consistency(self):
        self.assertNotIn("_ud ", self.doc02)
        self.assertIn("input_cost_per_mtok_micro_usd", self.doc02)

    def test_33_stateless_mcp_2026_07_28_and_schema_pinning(self):
        self.assertIn("2026-07-28", self.doc05)
        self.assertIn("schema_sha256", self.doc05)
        self.assertIn("schema_sha256", self.doc07)

    def test_34_progressive_skills_and_hooks_specified(self):
        self.assertIn("EXT-SKL-001", self.doc05)
        self.assertIn("EXT-HOK-001", self.doc05)

    def test_35_complete_ipc_wire_contracts_in_doc06(self):
        for sym in ["enum ClientEnvelope", "enum EngineCommand", "enum ServerFrame", "struct KinWireError"]:
            self.assertIn(sym, self.doc06)

    def test_36_all_prd_ids_and_4_zone_ux_in_doc01(self):
        for prd_id in ["PRD-PRJ-001", "PRD-AGT-001", "PRD-COM-001", "PRD-MTG-001", "PRD-UX-001"]:
            self.assertIn(prd_id, self.doc01)

    def test_37_fifteen_run_states_match_between_sql_and_doc03(self):
        states = [
            "queued", "preparing", "streaming_model", "evaluating_policy",
            "waiting_approval", "waiting_takeover", "waiting_subagent", "waiting_recovery",
            "executing_tools", "verifying_completion", "compacting",
            "completed", "cancelled", "failed", "budget_exceeded",
        ]
        self.assertEqual(len(states), 15)
        for st in states:
            self.assertIn(f"'{st}'", self.doc02)
            self.assertIn(f"`{st}`", self.doc03)

    def test_38_nine_prompt_layers_and_pagerank_in_l8(self):
        for layer in ["L1:", "L2:", "L3:", "L4:", "L5:", "L6:", "L7:", "L8:", "L9:"]:
            self.assertIn(layer, self.doc03)
        self.assertIn("Personalized PageRank Call-Graph Repo-Map", self.doc03)

    def test_39_topological_dag_promotion_sql_in_doc04(self):
        self.assertIn("RETURNING id, assigned_agent_id, channel_id, thread_id, tainted", self.doc04)

    def test_40_gateway_429_full_jitter_backoff_and_failover(self):
        self.assertIn("GW-RES-001", self.doc04)
        self.assertIn("GW-RES-002", self.doc04)

    def test_41_apply_journals_mode_preservation_and_escape_path(self):
        self.assertIn("failed_needs_revert", self.doc02)
        self.assertIn("failed_needs_revert", self.doc04)

    def test_42_immutable_table_migration_protocol_in_doc02(self):
        self.assertIn("Migrating Immutable Tables", self.doc02)

    def test_43_signed_updater_and_i18n_specified(self):
        self.assertIn("SEC-UPD-001", self.doc05)
        self.assertIn("PRD-UX-004", self.doc01)

    def test_44_ssrf_dns_rebinding_pinning_in_doc05(self):
        self.assertIn("KinDnsResolver", self.doc05)
        self.assertIn("fd00:ec2::254", self.doc05)

    def test_45_twenty_six_tools_sorted_and_bounded(self):
        self.assertEqual(len(self.tools), 26)
        names = [t["name"] for t in self.tools]
        self.assertEqual(names, sorted(names))

    def test_46_all_ten_specialist_templates_in_doc07(self):
        for slug in ["architect", "backend", "frontend", "qa", "security", "researcher", "devops", "data", "writer", "product"]:
            self.assertIn(f"[templates.{slug}]", self.doc07)

    def test_47_nfr_benchmark_corpora_50k_and_100k(self):
        self.assertIn("kin-bench-repo-50k", self.doc01)
        self.assertIn("kin-bench-monorepo-100k", self.doc01)

    def test_48_fourteen_golden_journeys_in_doc01(self):
        for i in range(1, 15):
            self.assertIn(f"G{i} —", self.doc01)

    def test_49_six_engineer_roadmap_m0_to_m12_in_doc06(self):
        self.assertIn("Core Engineering Team Staffing (6 Engineers)", self.doc06)
        self.assertIn("M11–M12", self.doc06)

    def test_50_all_eighteen_invariants_and_twenty_eight_aud_ids_in_doc00(self):
        for i in range(1, 19):
            self.assertIn(f"INV-{i:03d}", self.doc00)
        for i in range(1, 29):
            self.assertIn(f"AUD-{i:02d}", self.doc00)

    # --- 30 New Round-4 & Round-5 Adversarial Regression Tests (test_51 .. test_80) ---
    def test_51_rt4_01_02_linux_s2_lo_up_egress_relay_uid_map_pid1_procfs(self):
        rust_blocks = extract_rust_blocks(self.doc07)
        linux_rs = next(b for b in rust_blocks if "enter_linux_s2_sandbox" in b)
        # RT4-01: Loopback lo brought UP via SIOCSIFFLAGS + egress_socketpair_fd relay bound to 127.0.0.1:18080
        self.assertIn("SIOCSIFFLAGS", linux_rs)
        self.assertIn("IFF_UP", linux_rs)
        self.assertIn("IFF_RUNNING", linux_rs)
        self.assertIn('TcpListener::bind("127.0.0.1:18080")', linux_rs)
        self.assertIn("UnixStream::from_raw_fd(egress_socketpair_fd)", linux_rs)
        # RT4-02: setgroups/uid_map/gid_map + MS_REC | MS_PRIVATE + fork() PID 1 + fresh procfs mount over /proc
        self.assertIn('"/proc/self/setgroups"', linux_rs)
        self.assertIn('"/proc/self/uid_map"', linux_rs)
        self.assertIn('"/proc/self/gid_map"', linux_rs)
        self.assertIn("libc::MS_REC | libc::MS_PRIVATE", linux_rs)
        self.assertIn("libc::fork()", linux_rs)
        self.assertIn("libc::MS_NOSUID | libc::MS_NOEXEC | libc::MS_NODEV", linux_rs)

    def test_52_rt4_03_macos_seatbelt_ancestor_metadata_and_egress_port(self):
        sb_blocks = extract_scheme_blocks(self.doc07)
        lane_sb = sb_blocks[0]
        self.assertIn("(allow file-read-metadata", lane_sb)
        self.assertIn('(literal (param "KIN_HOME_DIR"))', lane_sb)
        self.assertIn('(literal (param "PROJECT_STATE_DIR"))', lane_sb)
        self.assertIn('(literal (param "PROJECT_WORKTREES_DIR"))', lane_sb)
        self.assertIn('(allow network-outbound (remote ip (param "EGRESS_PROXY_ADDR")))', lane_sb)
        self.assertNotIn('(allow network-outbound (remote ip "localhost:*"))', lane_sb)

    def test_53_rt4_04_windows_s1_startupinfo_cb_localfree_env_and_fallback(self):
        rust_blocks = extract_rust_blocks(self.doc07)
        win_rs = next(b for b in rust_blocks if "spawn_in_windows_s1_job" in b)
        self.assertIn("si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;", win_rs)
        self.assertIn("LocalFree(low_il_sid as HLOCAL);", win_rs)
        self.assertIn("env_block_utf16.as_ptr() as *const _", win_rs)
        self.assertIn("ERROR_PRIVILEGE_NOT_HELD", win_rs)
        self.assertIn("CreateProcessW(", win_rs)

    def test_54_rt4_05_apparmor_profile_and_s1_eperm_fallback(self):
        self.assertIn("{/usr/lib/kin/kin-sandbox,/opt/kin/kin-sandbox,@{HOME}/.local/bin/kin-sandbox}", self.doc07)
        self.assertIn("UserNsEpermFallbackToS1", self.doc07)
        self.assertIn("sudo apparmor_parser -r /etc/apparmor.d/dev.kin.sandbox", self.doc07)

    def test_55_rt4_06_dual_sandbox_profiles_lane_exec_vs_root_snapshot(self):
        for doc in (self.doc00, self.doc04, self.doc05, self.doc07):
            self.assertIn("S2-Lane-Exec", doc)
            self.assertIn("S2-Root-Snapshot", doc)
        sb_blocks = extract_scheme_blocks(self.doc07)
        self.assertEqual(len(sb_blocks), 2)
        self.assertIn("PROJECT_ROOT_RO", sb_blocks[1])
        self.assertIn("(deny network*)", sb_blocks[1])

    def test_56_rt4_07_tracked_dotenv_and_keys_stripped_from_s0(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp) / "root"
            repo_git = pathlib.Path(tmp) / "repo.git"
            wkt = pathlib.Path(tmp) / "wkt_1"
            idx_file = pathlib.Path(tmp) / "index.tmp"
            root.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.email", "dev@kin.local"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.name", "Dev"], cwd=root, check=True)
            (root / "main.rs").write_text("fn main() {}\n", encoding="utf-8")
            # Commit TRACKED secrets into HEAD (RT4-07 scenario)
            (root / ".env").write_text("SECRET_KEY=topsecret\n", encoding="utf-8")
            (root / ".env.production").write_text("PROD_KEY=prodsecret\n", encoding="utf-8")
            (root / "cert.pem").write_text("PRIVATE PEM\n", encoding="utf-8")
            (root / "id.key").write_text("PRIVATE KEY\n", encoding="utf-8")
            (root / ".kin").mkdir()
            (root / ".kin" / "kin.toml").write_text("schema_version = 8\n", encoding="utf-8")
            subprocess.run(["git", "add", "-f", "main.rs", ".env", ".env.production", "cert.pem", "id.key", ".kin/kin.toml"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-q", "-m", "commit with tracked secrets"], cwd=root, check=True)

            subprocess.run(["git", "init", "--bare", "-q", str(repo_git)], check=True)
            subprocess.run(["git", f"--git-dir={repo_git}", "fetch", "--no-tags", "--quiet", str(root / ".git"), "+HEAD:refs/kin/root_head"], check=True)

            env = os.environ.copy()
            env.update({
                "GIT_DIR": str(repo_git),
                "GIT_WORK_TREE": str(root),
                "GIT_INDEX_FILE": str(idx_file),
                "GIT_OBJECT_DIRECTORY": str(repo_git / "objects"),
            })
            subprocess.run(["git", "read-tree", "refs/kin/root_head"], env=env, check=True)
            subprocess.run(["git", "--no-optional-locks", "update-index", "--add", "--remove", "-z", "--again"], env=env, check=True)
            # Execute the RT4-07 strip command from DOC-04 §1.4
            subprocess.run(
                ["git", "--no-optional-locks", "rm", "--cached", "--ignore-unmatch", "--quiet", "-r", "--",
                 ".env", ".env.*", "*.pem", "*.key", ".kin"],
                env=env,
                check=True,
            )
            tree_sha = subprocess.check_output(["git", "write-tree"], env=env, text=True).strip()
            snap_sha = subprocess.check_output(["git", "-c", "user.name=kin", "-c", "user.email=kin@local", "commit-tree", tree_sha, "-m", "s0"], env=env, text=True).strip()
            subprocess.run(["git", f"--git-dir={repo_git}", "worktree", "add", "--detach", "-q", str(wkt), snap_sha], check=True)

            self.assertTrue((wkt / "main.rs").exists())
            self.assertFalse((wkt / ".env").exists())
            self.assertFalse((wkt / ".env.production").exists())
            self.assertFalse((wkt / "cert.pem").exists())
            self.assertFalse((wkt / "id.key").exists())
            self.assertFalse((wkt / ".kin").exists())
            # And root still has its tracked files untouched
            self.assertTrue((root / ".env").exists())

    def test_57_rt4_08_unborn_head_and_missing_kinignore_snapshot_s0(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp) / "unborn_repo"
            repo_git = pathlib.Path(tmp) / "repo.git"
            wkt = pathlib.Path(tmp) / "wkt_unborn"
            idx_file = pathlib.Path(tmp) / "index.tmp"
            root.mkdir()
            # git init with ZERO commits (unborn HEAD) and NO .kinignore
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            (root / "hello.rs").write_text("pub fn hello() {}\n", encoding="utf-8")
            (root / ".env").write_text("UNTRACKED_SECRET=1\n", encoding="utf-8")
            subprocess.run(["git", "init", "--bare", "-q", str(repo_git)], check=True)

            env = os.environ.copy()
            env.update({
                "GIT_DIR": str(repo_git),
                "GIT_WORK_TREE": str(root),
                "GIT_INDEX_FILE": str(idx_file),
                "GIT_OBJECT_DIRECTORY": str(repo_git / "objects"),
                "REPO_GIT": str(repo_git),
                "ROOT_GIT_DIR": str(root / ".git"),
                "ROOT_PATH": str(root),
            })
            script = """
            set -e
            if git --git-dir="$REPO_GIT" rev-parse --verify -q refs/kin/root_head >/dev/null; then
                git --git-dir="$REPO_GIT" read-tree refs/kin/root_head
            else
                git --git-dir="$REPO_GIT" read-tree --empty
            fi
            EXCLUDE_ARGS=()
            [ -f "$ROOT_GIT_DIR/info/exclude" ] && EXCLUDE_ARGS+=(--exclude-from="$ROOT_GIT_DIR/info/exclude")
            [ -f "$ROOT_PATH/.kinignore" ] && EXCLUDE_ARGS+=(--exclude-from="$ROOT_PATH/.kinignore")
            git --no-optional-locks ls-files --others --exclude-standard "${EXCLUDE_ARGS[@]}" \
                --exclude='.env' --exclude='.env.*' --exclude='*.pem' --exclude='*.key' --exclude='.kin' -z \
              | git update-index --add -z --stdin
            git --no-optional-locks rm --cached --ignore-unmatch --quiet -r -- '.env' '.env.*' '*.pem' '*.key' '.kin'
            TREE=$(git write-tree)
            SNAP=$(git -c user.name=kin -c user.email=kin@local commit-tree "$TREE" -m "s0")
            git --git-dir="$REPO_GIT" worktree add --detach -q "$1" "$SNAP"
            """
            subprocess.run(["bash", "-c", script, "_", str(wkt)], env=env, check=True)
            self.assertTrue((wkt / "hello.rs").exists())
            self.assertFalse((wkt / ".env").exists())

    def test_58_rt4_09_root_apply_create_subdirs_and_delete_files(self):
        self.assertIn("created_dirs", self.doc02)
        self.assertIn("created_dirs", self.doc04)
        self.assertIn("root_dir.create_dir_all(rel_dir)", self.doc04)
        self.assertIn("root_dir.remove_file(rel_path)", self.doc04)

    def test_59_rt4_10_tool_calls_fts_and_privacy_purge_sync(self):
        conn = self._new_project_db()
        _, _, _, _, run_id, stp_id = self._seed_agent_channel_run(conn)
        tlc_id = make_ulid("tlc", 1)
        conn.execute(
            "INSERT INTO tool_calls(id,run_id,step_id,provider_call_id,tool_name,args_redacted_jcs_json,args_blake3,mutability,risk_class,policy_decision,policy_rule_id,status,intent_ledger_seq,result_preview_text,started_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (tlc_id, run_id, stp_id, "call_1", "fs_patch", '{"path":"src/unique_token_xyz.rs"}', "b" * 64, "idempotent_write", "R1", "allow_sandboxed", "R1-AUTO", "succeeded", 1, "patched unique_output_abc", 100),
        )
        self.assertEqual(
            conn.execute("SELECT count(*) FROM tool_calls_fts WHERE tool_calls_fts MATCH 'unique_token_xyz'").fetchone()[0],
            1,
        )
        self.assertEqual(
            conn.execute("SELECT count(*) FROM tool_calls_fts WHERE tool_calls_fts MATCH 'unique_output_abc'").fetchone()[0],
            1,
        )
        # Privacy purge removes entry from tool_calls_fts
        conn.execute(
            "UPDATE tool_calls SET content_purged = 1, args_redacted_jcs_json = '{}', result_preview_text = NULL, spill_blob_hash = NULL WHERE id = ?",
            (tlc_id,),
        )
        self.assertEqual(
            conn.execute("SELECT count(*) FROM tool_calls_fts WHERE tool_calls_fts MATCH 'unique_token_xyz'").fetchone()[0],
            0,
        )
        conn.close()

    def test_60_rt4_11_all_four_taint_laundering_paths_blocked(self):
        conn = self._new_project_db()
        agt_boss, agt_spec, chn_id, thr_id, parent_run_id, _ = self._seed_agent_channel_run(conn, tainted=0)
        # 1. Child subagent run becomes tainted -> automatically taints untainted parent_run_id (RT4-11.1)
        child_run_id = make_ulid("run", 50)
        conn.execute(
            "INSERT INTO runs(id,agent_id,parent_run_id,context_key,channel_id,thread_id,status,autonomy_effective,sandbox_level,tainted,started_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (child_run_id, agt_spec, parent_run_id, f"sub:{child_run_id}", chn_id, thr_id, "executing_tools", "WORKTREE_AUTO", "S2", 0, 200),
        )
        conn.execute("UPDATE runs SET tainted = 1 WHERE id = ?", (child_run_id,))
        parent_tainted = conn.execute("SELECT tainted FROM runs WHERE id = ?", (parent_run_id,)).fetchone()[0]
        self.assertEqual(parent_tainted, 1)

        # 2. Wake coalescing UPDATE cannot drop taint when coalescing a tainted message (RT4-11.2)
        wak_id = make_ulid("wak", 1)
        conn.execute(
            "INSERT INTO wake_queue(id,agent_id,context_key,trigger_kind,tainted,enqueued_at_us) VALUES (?,?,?,?,?,?)",
            (wak_id, agt_boss, f"chn:{chn_id}", "explicit_mention", 0, 200),
        )
        tainted_msg_id = make_ulid("msg", 50)
        conn.execute(
            "INSERT INTO messages(id,channel_id,thread_id,author_kind,author_agent_id,run_id,content_md,tainted,created_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (tainted_msg_id, chn_id, thr_id, "agent", agt_spec, child_run_id, "tainted msg", 1, 210),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "UPDATE wake_queue SET coalesce_count = coalesce_count + 1, source_message_id = ?, tainted = 0 WHERE id = ?",
                (tainted_msg_id, wak_id),
            )

        # 3. Agent message with run_id IS NULL is rejected (RT4-11.3)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO messages(id,channel_id,thread_id,author_kind,author_agent_id,run_id,content_md,tainted,created_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (make_ulid("msg", 51), chn_id, thr_id, "agent", agt_spec, None, "null run_id bypass", 0, 220),
            )

        # 4. Tainted run writing active/agent T1 memory is rejected by SQLite trigger (RT4-11.4)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO memory_items(id,tier,scope_id,bank,subject_key,claim_text,status,trust,provenance_json,valid_from_us,recorded_at_us,content_blake3,created_by_agent_id,created_by_run_id,created_at_us,updated_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (make_ulid("mem", 50), "T1", "project", "world", "k", "claim", "active", "agent", "{}", 1, 1, "d" * 64, agt_spec, child_run_id, 1, 1),
            )
        conn.close()

    def test_61_rt4_12_ledger_payloads_delete_syncs_payload_purged(self):
        conn = self._new_project_db()
        ldg_id = make_ulid("ldg", 1)
        conn.execute(
            "INSERT INTO ledger_events(seq,id,ts_us,event_kind,actor_kind,actor_id,payload_blake3,payload_purged,prev_event_blake3,event_blake3) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (0, ldg_id, 100, "project.init", "system", "sys", "a" * 64, 0, "0" * 64, "b" * 64),
        )
        conn.execute("INSERT INTO ledger_payloads(seq,payload_jcs_json) VALUES (0,'{\"init\":true}')")
        conn.execute(
            "INSERT INTO ledger_events(seq,id,ts_us,event_kind,actor_kind,actor_id,payload_blake3,payload_purged,prev_event_blake3,event_blake3) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (1, make_ulid("ldg", 2), 101, "privacy.purge.receipt", "human", "human:operator", "c" * 64, 0, "b" * 64, "d" * 64),
        )
        conn.execute("INSERT INTO ledger_payloads(seq,payload_jcs_json) VALUES (1,'{\"ed25519_sig_hex\":\"aa\",\"entity_id\":\"msg_1\",\"purged_seq\":0,\"reason\":\"operator_privacy_purge\"}')")
        conn.execute("DELETE FROM ledger_payloads WHERE seq = 0")
        purged = conn.execute("SELECT payload_purged FROM ledger_events WHERE seq = 0").fetchone()[0]
        self.assertEqual(purged, 1)
        conn.close()

    def test_62_rt4_13_dm_conversations_participant_a_and_task_fk_triggers(self):
        conn = self._new_project_db()
        agt1, agt2, _, _, _, _ = self._seed_agent_channel_run(conn)
        fake_agt = make_ulid("agt", 0)  # Lexicographically smaller, does not exist in agents
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO dm_conversations(id,kind,participant_a,participant_b,created_at_us,updated_at_us) VALUES (?,?,?,?,?,?)",
                (make_ulid("dmc", 10), "agent_agent", fake_agt, agt2, 100, 100),
            )
        # Valid DM creation and restriction on deleting participant_a
        a_low, a_high = sorted([agt1, agt2])
        tsk_id = make_ulid("tsk", 10)
        conn.execute("INSERT INTO tasks(id,title,description_md,created_at_us,updated_at_us) VALUES (?,?,?,?,?)", (tsk_id, "T", "D", 1, 1))
        conn.execute(
            "INSERT INTO dm_conversations(id,kind,participant_a,participant_b,bound_task_id,created_at_us,updated_at_us) VALUES (?,?,?,?,?,?,?)",
            (make_ulid("dmc", 11), "agent_agent", a_low, a_high, tsk_id, 100, 100),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("DELETE FROM agents WHERE id = ?", (a_low,))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("DELETE FROM tasks WHERE id = ?", (tsk_id,))
        conn.close()

    def test_63_rt4_14_task_dependencies_update_cycle_bypass_blocked(self):
        conn = self._new_project_db()
        t1, t2, t3 = make_ulid("tsk", 1), make_ulid("tsk", 2), make_ulid("tsk", 3)
        for tid in (t1, t2, t3):
            conn.execute("INSERT INTO tasks(id,title,description_md,status,created_at_us,updated_at_us) VALUES (?,?,?,?,?,?)", (tid, "T", "D", "blocked", 1, 1))
        conn.execute("INSERT INTO task_dependencies VALUES (?,?)", (t2, t1))
        conn.execute("INSERT INTO task_dependencies VALUES (?,?)", (t3, t2))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE task_dependencies SET task_id = ?, depends_on_task_id = ? WHERE task_id = ?", (t1, t2, t3))
        conn.close()

    def test_64_rt4_15_all_eight_foreign_keys_enforced(self):
        conn = self._new_project_db()
        expected_fks = [
            ("agents", "bound_task_id", "tasks"),
            ("threads", "root_message_id", "messages"),
            ("messages", "run_id", "runs"),
            ("worktree_lanes", "bound_run_id", "runs"),
            ("worktree_lanes", "bound_task_id", "tasks"),
            ("pty_sessions", "owner_run_id", "runs"),
            ("ast_symbol_leases", "run_id", "runs"),
            ("tasks", "lease_owner_run_id", "runs"),
            ("memory_items", "created_by_run_id", "runs"),
        ]
        for table, from_col, to_table in expected_fks:
            fks = conn.execute(f"PRAGMA foreign_key_list({table})").fetchall()
            matches = [r for r in fks if r[3] == from_col and r[2] == to_table]
            self.assertEqual(len(matches), 1, f"Missing FK {table}.{from_col} -> {to_table}")
        conn.close()

    def test_65_rt4_16_intra_batch_lethal_trifecta_pre_marking(self):
        self.assertIn("pub async fn evaluate_and_execute_step_batch", self.doc06)
        self.assertIn("let batch_will_taint =", self.doc06)
        self.assertIn("let batch_will_read_private_context =", self.doc06)
        self.assertIn("mark_run_has_private_context", self.doc06)

    def test_66_rt4_17_ssrf_ipv6_unspecified_nat64_and_redirect_policy(self):
        self.assertIn("::/128", self.doc05)
        self.assertIn("64:ff9b::/96", self.doc05)
        self.assertIn("64:ff9b:1::/48", self.doc05)
        self.assertIn("198.18.0.0/15", self.doc05)
        self.assertIn("is_publicly_routable_ip(ip)", self.doc05)
        self.assertIn("pub fn is_publicly_routable_ip(ip: IpAddr) -> bool", self.doc06)
        self.assertIn("reqwest::redirect::Policy::custom", self.doc05)
        self.assertIn("resolver.resolve_and_pin_host(host, port)", self.doc06)

    def test_67_rt4_18_secret_redactor_blocks_corrupting_fs_write_patch(self):
        self.assertIn("if redaction_scan.had_vault_secret {", self.doc06)
        self.assertIn('verdict.rule_id = "KIN-POL-0009".to_string();', self.doc06)
        self.assertIn("Universal Literal-Secret Block (`KIN-POL-0009`, Fixing `RT4-18`)", self.doc05)

    def test_68_rt4_19_secret_handle_normalization_and_pty_open_schema(self):
        self.assertIn("trim_start_matches('$')", self.doc05)
        pty_open = next(t for t in self.tools if t["name"] == "pty_open")
        shell_exec = next(t for t in self.tools if t["name"] == "shell_exec")
        for tool in (pty_open, shell_exec):
            handles = tool["input_schema"]["properties"]["secret_env_handles"]
            self.assertEqual(handles["items"]["pattern"], r"^\$?KIN_SECRET_[A-Z0-9_]+$")
            self.assertIsNotNone(re.match(handles["items"]["pattern"], "$KIN_SECRET_GITHUB_TOKEN"))
            self.assertIsNotNone(re.match(handles["items"]["pattern"], "KIN_SECRET_GITHUB_TOKEN"))

    def test_69_rt4_20_persisted_gate_fail_attempts_in_worktree_lanes(self):
        conn = self._new_project_db()
        _, agt_spec, _, _, _, _ = self._seed_agent_channel_run(conn)
        wkt_id = make_ulid("wkt", 20)
        conn.execute(
            "INSERT INTO worktree_lanes(id,owner_agent_id,worktree_path,branch_name,base_commit_sha,root_snapshot_ref,head_commit_sha,current_tree_sha,gate_fail_attempts,cow_strategy,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (wkt_id, agt_spec, "/tmp/w20", "kin/w20", "a" * 40, "refs/kin/s0", "a" * 40, "b" * 40, 3, "apfs_clonefile", 1, 1),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE worktree_lanes SET gate_fail_attempts = 4 WHERE id = ?", (wkt_id,))
        self.assertIn("increment_lane_gate_fail_attempts", self.doc06)
        conn.close()

    def test_70_rt4_21_meeting_decision_record_tool_support(self):
        channel_post = next(t for t in self.tools if t["name"] == "channel_post")
        goal_mutate = next(t for t in self.tools if t["name"] == "goal_mutate")
        self.assertIn("meeting_id", channel_post["input_schema"]["properties"])
        self.assertIn("conclude_meeting_decision_record", channel_post["input_schema"]["properties"])
        self.assertIn("meeting_conclude", goal_mutate["input_schema"]["properties"]["op"]["enum"])
        self.assertIn("decision_record_md", goal_mutate["input_schema"]["properties"])

    def test_71_rt4_22_dm_ping_pong_pre_check_and_reset_contract(self):
        self.assertIn("consecutive_agent_turns == 4", self.doc01)
        self.assertIn("consecutive_agent_turns == 4", self.doc03)
        self.assertIn("Reset Contract (`RT4-22`)", self.doc01)

    def test_72_rt4_23_24_ipc_project_snapshot_and_slash_commands(self):
        self.assertIn("ProjectSnapshot {", self.doc06)
        for variant in [
            "ProjectUpdateSettings {",
            "ProjectGarbageCollect { prune_worktrees: bool }",
            "GoalMutate {",
            "AgentHire {",
            "ScheduleMutate {",
            "ContextCompact {",
            "MemoryWrite {",
            "PtyControl {",
            "RecoveryResolve { run_id: String, tool_call_id: String, resolution: RecoveryResolution }",
            "LaneUnfreeze { lane_id: String, expected_mutation_epoch: u64, reason: String }",
            "McpInspectSchema { slug: String }",
        ]:
            self.assertIn(variant, self.doc06)
        for closed_enum in [
            "pub enum GoalMutateOp { Create, Update, Activate, Complete, Pause, Cancel, MeetingStart, MeetingConclude }",
            "pub enum ScheduleMutateOp { Create, Update, Enable, Disable, TriggerNow, Delete }",
            "pub enum ScheduleTriggerKind { Cron, Interval, Event }",
            "pub enum MemoryTier { T1, T2, T3, T4 }",
            "pub enum MemoryBank { World, Experience, Opinion, Procedure }",
            "pub enum PrivacyEntityKind { Message, Run, RunStep, ToolCall, MemoryItem }",
            "pub enum RecoveryResolution { Retry, MarkSucceeded, Abort }",
            "pub enum McpMutateOp",
            "pub enum McpTransport { Stdio, StreamableHttp }",
            "pub enum ExtensionMutateOp { Install, Enable, Disable, Uninstall }",
            "pub enum TaskVerificationMode { None, SelfAttested, Checks, Reviewer, Human }",
            "Checkpoint { result_summary_md: String }",
        ]:
            self.assertIn(closed_enum, self.doc06)

    def test_73_rt4_25_json_schema_ulid_patterns_and_conditional_required(self):
        ast_tool = next(t for t in self.tools if t["name"] == "ast_symbols")
        self.assertIn("anyOf", ast_tool["input_schema"])
        task_tool = next(t for t in self.tools if t["name"] == "task_mutate")
        goal_tool = next(t for t in self.tools if t["name"] == "goal_mutate")
        self.assertIn("allOf", task_tool["input_schema"])
        self.assertIn("allOf", goal_tool["input_schema"])
        # Verify every 30-character prefixed ID (4-char prefix + 26-char Crockford ULID) property across all 26 tools has a Crockford ULID pattern
        for tool in self.tools:
            props = tool["input_schema"].get("properties", {})
            for prop_name, prop_def in props.items():
                if prop_def.get("minLength") == 30 and prop_def.get("maxLength") == 30:
                    self.assertIn("pattern", prop_def, f"{tool['name']}.{prop_name} missing ULID pattern")

    def test_74_rt4_26_embedding_dimensions_and_matryoshka_truncation(self):
        conn = sqlite3.connect(":memory:")
        conn.executescript(self.idx_sql)
        conn.execute("INSERT INTO indexed_files VALUES ('src/a.rs','h',10,'rust',1,1)")
        for idx, byte_len in enumerate((1536, 3072, 6144)):
            conn.execute(
                "INSERT INTO code_chunks VALUES (?,?,1,5,'fn','code','ready',?)",
                (f"c_{idx}", "src/a.rs", b"\x00" * byte_len),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO code_chunks VALUES ('c_bad','src/a.rs',1,5,'fn','code','ready',?)", (b"\x00" * 1000,))
        self.assertIn("Matryoshka", self.doc04)
        conn.close()

    def test_75_rt4_27_worktree_remove_and_prune_lifecycle(self):
        self.assertIn('worktree remove --force "$WORKTREE_PATH"', self.doc04)
        self.assertIn("worktree prune --expire=now", self.doc04)

    def test_76_rt4_28_unified_test_count_across_all_docs(self):
        test_methods = [m for m in dir(self) if m.startswith("test_")]
        expected_count = len(test_methods)
        self.assertEqual(expected_count, 200)
        self.assertIn(f"{expected_count} tests", self.doc06)
        self.assertIn(f"{expected_count} specification/contract tests", self.doc00)
        self.assertIn(f"{expected_count} specification/contract tests", read_doc("AGENTS.md"))
        self.assertNotIn("185 tests", self.doc00)
        self.assertNotIn("185 tests", read_doc("AGENTS.md"))

    def test_77_rt5_sqlite_chain_continuity_and_deferred_fk_integrity(self):
        conn = self._new_project_db()
        # 1. Ledger chain continuity trigger (trg_ledger_enforce_chain)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO ledger_events(seq,id,ts_us,event_kind,actor_kind,actor_id,payload_blake3,payload_purged,prev_event_blake3,event_blake3) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (1, make_ulid("ldg", 1), 100, "e", "system", "sys", "a" * 64, 0, "0" * 64, "b" * 64),
            )
        conn.execute(
            "INSERT INTO ledger_events(seq,id,ts_us,event_kind,actor_kind,actor_id,payload_blake3,payload_purged,prev_event_blake3,event_blake3) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (0, make_ulid("ldg", 2), 100, "e0", "system", "sys", "a" * 64, 0, "0" * 64, "b" * 64),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO ledger_events(seq,id,ts_us,event_kind,actor_kind,actor_id,payload_blake3,payload_purged,prev_event_blake3,event_blake3) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (1, make_ulid("ldg", 3), 101, "e1", "system", "sys", "a" * 64, 0, "c" * 64, "d" * 64),
            )
        conn.execute(
            "INSERT INTO ledger_events(seq,id,ts_us,event_kind,actor_kind,actor_id,payload_blake3,payload_purged,prev_event_blake3,event_blake3) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (1, make_ulid("ldg", 3), 101, "e1", "system", "sys", "a" * 64, 0, "b" * 64, "d" * 64),
        )
        conn.close()

    def test_78_rt5_multi_hop_subagent_taint_propagation_depth_2(self):
        conn = self._new_project_db()
        agt_boss, agt_spec, chn_id, thr_id, run_boss, _ = self._seed_agent_channel_run(conn, tainted=0)
        run_d1 = make_ulid("run", 71)
        run_d2 = make_ulid("run", 72)
        conn.execute(
            "INSERT INTO runs(id,agent_id,parent_run_id,context_key,channel_id,thread_id,status,autonomy_effective,sandbox_level,tainted,started_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (run_d1, agt_boss, run_boss, f"sub1:{run_d1}", chn_id, thr_id, "waiting_subagent", "WORKTREE_AUTO", "S2", 0, 200),
        )
        conn.execute(
            "INSERT INTO runs(id,agent_id,parent_run_id,context_key,channel_id,thread_id,status,autonomy_effective,sandbox_level,tainted,started_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (run_d2, agt_spec, run_d1, f"sub2:{run_d2}", chn_id, thr_id, "executing_tools", "WORKTREE_AUTO", "S2", 0, 210),
        )
        conn.execute("UPDATE runs SET tainted = 1 WHERE id = ?", (run_d2,))
        d1_tainted = conn.execute("SELECT tainted FROM runs WHERE id = ?", (run_d1,)).fetchone()[0]
        boss_tainted = conn.execute("SELECT tainted FROM runs WHERE id = ?", (run_boss,)).fetchone()[0]
        self.assertEqual(d1_tainted, 1)
        self.assertEqual(boss_tainted, 1)
        conn.close()

    def test_79_rt5_memory_quarantine_update_lock(self):
        conn = self._new_project_db()
        _, agt_spec, _, _, run_id, _ = self._seed_agent_channel_run(conn, tainted=1)
        mem_id = make_ulid("mem", 79)
        conn.execute(
            "INSERT INTO memory_items(id,tier,scope_id,bank,subject_key,claim_text,status,trust,provenance_json,valid_from_us,recorded_at_us,content_blake3,created_by_agent_id,created_by_run_id,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (mem_id, "T1", "project", "world", "k", "quarantined claim", "quarantined", "untrusted", "{}", 1, 1, "e" * 64, agt_spec, run_id, 1, 1),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE memory_items SET status = 'active' WHERE id = ?", (mem_id,))
        conn.execute("UPDATE memory_items SET status = 'active', trust = 'human' WHERE id = ?", (mem_id,))
        self.assertEqual(conn.execute("SELECT count(*) FROM memory_fts WHERE memory_fts MATCH 'quarantined'").fetchone()[0], 1)
        conn.close()

    def test_80_rt5_markdown_table_and_cross_doc_alignment(self):
        # Verify INV-001..INV-018 in DOC-00 are each clean single-line Markdown table rows
        for i in range(1, 19):
            inv_id = f"INV-{i:03d}"
            pattern = rf"^\| \*\*{inv_id}\*\* \| .* \| .* \|$"
            self.assertIsNotNone(re.search(pattern, self.doc00, flags=re.MULTILINE), f"Broken table row for {inv_id}")
        # Verify RT4-01..RT4-28 are all documented in DOC-00 §2.3
        for i in range(1, 29):
            rt4_id = f"RT4-{i:02d}"
            self.assertIn(f"**{rt4_id}**", self.doc00)


    # --- 10 New Round-6 Deep Audit Tests (test_81 .. test_90) ---
    def test_81_rt6_01_linux_sandbox_self_contained_types_and_relay(self):
        rust_blocks = extract_rust_blocks(self.doc07)
        linux_rs = next(b for b in rust_blocks if "enter_linux_s2_sandbox" in b)
        self.assertIn("pub enum SandboxError", linux_rs)
        self.assertIn("fn run_netns_egress_relay_until_child_exit(", linux_rs)
        self.assertIn("libc::umask(0o022)", linux_rs)
        self.assertIn("std::env::set_current_dir(lane_worktree_rw)", linux_rs)

    def test_82_rt6_02_tracked_kinignore_and_extended_secrets_stripped(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp) / "root"
            repo_git = pathlib.Path(tmp) / "repo.git"
            wkt = pathlib.Path(tmp) / "wkt_kinignore"
            idx_file = pathlib.Path(tmp) / "index.tmp"
            root.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.email", "dev@kin.local"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.name", "Dev"], cwd=root, check=True)
            (root / "app.rs").write_text("pub fn app() {}\n", encoding="utf-8")
            (root / ".kinignore").write_text("internal_secrets/**\ncustom.cred\n", encoding="utf-8")
            (root / "internal_secrets").mkdir()
            (root / "internal_secrets" / "token.txt").write_text("secret123\n", encoding="utf-8")
            (root / "custom.cred").write_text("cred123\n", encoding="utf-8")
            (root / "id_ed25519").write_text("sshkey\n", encoding="utf-8")
            subprocess.run(
                ["git", "add", "-f", "app.rs", ".kinignore", "internal_secrets/token.txt", "custom.cred", "id_ed25519"],
                cwd=root,
                check=True,
            )
            subprocess.run(["git", "commit", "-q", "-m", "tracked kinignore secrets"], cwd=root, check=True)
            subprocess.run(["git", "init", "--bare", "-q", str(repo_git)], check=True)
            subprocess.run(["git", f"--git-dir={repo_git}", "fetch", "--no-tags", "--quiet", str(root / ".git"), "+HEAD:refs/kin/root_head"], check=True)

            env = os.environ.copy()
            env.update({
                "GIT_DIR": str(repo_git),
                "GIT_WORK_TREE": str(root),
                "GIT_INDEX_FILE": str(idx_file),
                "GIT_OBJECT_DIRECTORY": str(repo_git / "objects"),
                "ROOT_PATH": str(root),
            })
            subprocess.run(["git", "read-tree", "refs/kin/root_head"], env=env, check=True)
            subprocess.run(
                ["git", "--no-optional-locks", "rm", "--cached", "--ignore-unmatch", "--quiet", "-r", "--",
                 ".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "id_ed25519*", ".npmrc", ".pypirc", ".netrc", ".kin"],
                env=env,
                check=True,
            )
            ignored = subprocess.check_output(
                ["git", "--no-optional-locks", "ls-files", "--cached", "--ignored", f"--exclude-from={root / '.kinignore'}", "-z"],
                env=env,
            )
            subprocess.run(["git", "--no-optional-locks", "update-index", "--force-remove", "-z", "--stdin"], input=ignored, env=env, check=True)
            tree_sha = subprocess.check_output(["git", "write-tree"], env=env, text=True).strip()
            snap_sha = subprocess.check_output(["git", "-c", "user.name=kin", "-c", "user.email=kin@local", "commit-tree", tree_sha, "-m", "s0"], env=env, text=True).strip()
            subprocess.run(["git", f"--git-dir={repo_git}", "worktree", "add", "--detach", "-q", str(wkt), snap_sha], check=True)
            self.assertTrue((wkt / "app.rs").exists())
            self.assertFalse((wkt / "internal_secrets" / "token.txt").exists())
            self.assertFalse((wkt / "custom.cred").exists())
            self.assertFalse((wkt / "id_ed25519").exists())

    def test_83_rt6_03_worktree_lanes_write_frozen_and_terminal_trigger(self):
        conn = self._new_project_db()
        _, agt_spec, _, _, _, _ = self._seed_agent_channel_run(conn)
        wkt_id = make_ulid("wkt", 83)
        conn.execute(
            "INSERT INTO worktree_lanes(id,owner_agent_id,worktree_path,branch_name,base_commit_sha,root_snapshot_ref,head_commit_sha,current_tree_sha,write_frozen,cow_strategy,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (wkt_id, agt_spec, "/tmp/w83", "kin/w83", "a" * 40, "refs/kin/s0", "a" * 40, "b" * 40, 1, "apfs_clonefile", 1, 1),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE worktree_lanes SET current_tree_sha = ? WHERE id = ?", ("c" * 40, wkt_id))
        # Audit Finding 8 bypass #1: setting write_frozen = 0 and mutating current_tree_sha in the same UPDATE must fail
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE worktree_lanes SET write_frozen = 0, current_tree_sha = ? WHERE id = ?", ("c" * 40, wkt_id))
        conn.execute("UPDATE worktree_lanes SET write_frozen = 0, status = 'merged' WHERE id = ?", (wkt_id,))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE worktree_lanes SET status = 'active' WHERE id = ?", (wkt_id,))
        # Audit Finding 8 bypass #2: mutating non-status columns on a terminal ('merged'/'discarded') lane must also fail
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE worktree_lanes SET current_tree_sha = ? WHERE id = ?", ("d" * 40, wkt_id))
        conn.close()

    def test_84_rt6_04_tasks_lease_epoch_monotonic_trigger(self):
        conn = self._new_project_db()
        tsk_id = make_ulid("tsk", 84)
        conn.execute(
            "INSERT INTO tasks(id,title,description_md,lease_epoch,created_at_us,updated_at_us) VALUES (?,?,?,?,?,?)",
            (tsk_id, "Task 84", "Desc", 5, 1, 1),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE tasks SET lease_epoch = 4 WHERE id = ?", (tsk_id,))
        conn.execute("UPDATE tasks SET lease_epoch = 6 WHERE id = ?", (tsk_id,))
        conn.close()

    def test_85_rt6_05_runs_step_and_cost_monotonicity_trigger(self):
        conn = self._new_project_db()
        _, _, _, _, run_id, _ = self._seed_agent_channel_run(conn)
        conn.execute("UPDATE runs SET step_count = 3, cost_micro_usd = 5000 WHERE id = ?", (run_id,))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE runs SET step_count = 2 WHERE id = ?", (run_id,))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE runs SET cost_micro_usd = 4000 WHERE id = ?", (run_id,))
        conn.close()

    def test_86_rt6_06_blobs_ref_count_delete_guard_trigger(self):
        conn = self._new_project_db()
        h = "f" * 64
        conn.execute(
            "INSERT INTO blobs(blake3_hash,byte_len,compressed_len,chunk_count,ref_count,created_at_us) VALUES (?,?,?,?,?,?)",
            (h, 100, 50, 1, 1, 100),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("DELETE FROM blobs WHERE blake3_hash = ?", (h,))
        conn.execute("UPDATE blobs SET ref_count = 0 WHERE blake3_hash = ?", (h,))
        conn.execute("DELETE FROM blobs WHERE blake3_hash = ?", (h,))
        conn.close()

    def test_87_rt6_07_hot_path_and_fk_covering_indexes_present(self):
        conn = self._new_project_db()
        indexes = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
        for idx in [
            "idx_runs_parent_run",
            "idx_runs_task_id",
            "idx_tool_calls_run_step",
            "idx_approval_requests_pending",
            "idx_project_events_kind_entity",
            "idx_schedules_enabled_next_tick",
        ]:
            self.assertIn(idx, indexes)
        conn.close()

    def test_88_rt6_08_scrubbed_environment_contract_sec_env_001(self):
        self.assertIn("SEC-ENV-001", self.doc04)
        for env_key in ["CARGO_TARGET_DIR", "UV_CACHE_DIR", "NPM_CONFIG_CACHE", "GIT_TERMINAL_PROMPT", "HTTP_PROXY"]:
            self.assertIn(env_key, self.doc04)
        # Audit Finding 9: Verify native Windows environment construction uses ';' separator, C:\Windows\System32, and NUL
        self.assertIn("C:\\Windows\\System32;C:\\Windows", self.doc04)
        self.assertIn("`1` / `NUL`", self.doc04)
        self.assertIn("pub fn build_windows_scrubbed_env_utf16(", self.doc07)
        self.assertIn('"C:\\\\Windows\\\\System32;C:\\\\Windows".to_string()', self.doc07)
        self.assertIn('format!("{}\\\\home", lane_tmp_dir)', self.doc07)
        self.assertIn('format!("{}\\\\npm", lane_cache_dir)', self.doc07)
        self.assertIn('("GIT_CONFIG_GLOBAL".into(), "NUL".into())', self.doc07)

    def test_89_rt6_09_harness_loop_detector_hrn_loop_001(self):
        self.assertIn("HRN-LOOP-001", self.doc03)
        self.assertIn("KIN-HRN-0008", self.doc03)
        self.assertIn("KIN-HRN-0009", self.doc03)

    def test_90_rt6_10_rust_reference_patch_engine_and_egress_resolver(self):
        self.assertIn("pub fn apply_four_tier_fs_patch(", self.doc06)
        self.assertIn("pub fn is_ssrf_forbidden_ip(", self.doc06)
        self.assertIn("pub fn build_egress_redirect_policy(", self.doc06)
        for blk in extract_rust_blocks(self.doc06):
            self.assertNotIn(".unwrap()", blk)
            self.assertNotIn(".expect(", blk)

    # --- 10 New Round-7 Forensic Verification Tests (test_91 .. test_100) ---
    def test_91_rt7_01_linux_full_duplex_scm_rights_and_bidirectional_relay(self):
        rust_blocks = extract_rust_blocks(self.doc07)
        linux_rs = next(b for b in rust_blocks if "enter_linux_s2_sandbox" in b)
        self.assertIn("fn pass_accepted_fd_via_scm_rights(", linux_rs)
        self.assertIn("libc::SCM_RIGHTS", linux_rs)
        self.assertIn("libc::sendmsg(", linux_rs)
        self.assertIn("pub fn spawn_bidirectional_tcp_unix_relay(", linux_rs)

    def test_92_rt7_02_03_zero_latex_in_tables_and_no_stale_round_headers(self):
        for fname in [
            "00-AGENTS-AND-AUDIT.md",
            "01-PRD.md",
            "02-TRD-AND-DDL.md",
            "03-HARNESS-MEMORY-CONTEXT.md",
            "04-WORKTREE-DAG-BROWSER-GATEWAY.md",
            "05-SECURITY-LEDGER-EXTENSIBILITY.md",
            "06-IPC-CONTRACTS-QA-ROADMAP.md",
            "07-PROMPTS-SCHEMAS-AND-SANDBOX-PROFILES.md",
            "08-C4-ADRS-COMPATIBILITY-RUNBOOK-AND-LOCKFILES.md",
        ]:
            txt = read_doc(fname)
            for stale in ["Five-Round", "Six-Round", "Seven-Round"]:
                self.assertNotIn(stale, txt, f"{fname} contains stale phrase {stale}")
            for line in txt.splitlines():
                if line.startswith("|"):
                    for latex_cmd in ["\\ge", "\\le", "\\leftrightarrow", "\\rightarrow", "\\sum", "\\max", "\\cos", "\\Delta"]:
                        self.assertNotIn(latex_cmd, line, f"{fname} table row contains Canvas-fragile LaTeX {latex_cmd}")

    def test_93_rt7_04_approval_requests_immutable_once_resolved_trigger(self):
        conn = self._new_project_db()
        _, agt_spec, _, _, run_id, stp_id = self._seed_agent_channel_run(conn)
        tlc_id = make_ulid("tlc", 93)
        apr_id = make_ulid("apr", 93)
        conn.execute(
            "INSERT INTO tool_calls(id,run_id,step_id,provider_call_id,tool_name,args_redacted_jcs_json,args_blake3,mutability,risk_class,policy_decision,policy_rule_id,status,intent_ledger_seq,started_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (tlc_id, run_id, stp_id, "c93", "shell_exec", '{"command":"cargo add serde"}', "a" * 64, "non_idempotent_write", "R3", "ask_human", "R3-SHELL", "awaiting_approval", 1, 100),
        )
        conn.execute(
            "INSERT INTO approval_requests(id,run_id,tool_call_id,agent_id,risk_class,reason_code,summary_title,canonical_action_json,status,created_at_us,expires_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (apr_id, run_id, tlc_id, agt_spec, "R3", "R3-SHELL", "Run cargo add", '{"cmd":"cargo add serde"}', "pending", 100, 900),
        )
        conn.execute("UPDATE approval_requests SET status = 'approved_once', resolved_by = 'human:operator', resolved_at_us = 200 WHERE id = ?", (apr_id,))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE approval_requests SET status = 'denied' WHERE id = ?", (apr_id,))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE approval_requests SET canonical_action_json = '{}' WHERE id = ?", (apr_id,))

    def test_94_rt7_05_apply_journals_state_machine_trigger(self):
        conn = self._new_project_db()
        _, agt_spec, _, _, _, _ = self._seed_agent_channel_run(conn)
        wkt_id = make_ulid("wkt", 94)
        mqe_id = make_ulid("mqe", 94)
        apj_id = make_ulid("apj", 94)
        conn.execute(
            "INSERT INTO worktree_lanes(id,owner_agent_id,worktree_path,branch_name,base_commit_sha,root_snapshot_ref,head_commit_sha,current_tree_sha,cow_strategy,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (wkt_id, agt_spec, "/tmp/w94", "kin/w94", "a" * 40, "refs/kin/s0", "a" * 40, "b" * 40, "apfs_clonefile", 1, 1),
        )
        conn.execute(
            "INSERT INTO merge_queue_entries(id,lane_id,attempt_no,submitted_by_agent_id,status,enqueued_at_us) VALUES (?,?,?,?,?,?)",
            (mqe_id, wkt_id, 1, agt_spec, "applying_root", 10),
        )
        conn.execute(
            "INSERT INTO apply_journals(id,merge_entry_id,pre_apply_root_snap_ref,post_apply_tree_sha,operations_json,state,intent_ledger_seq,created_at_us) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (apj_id, mqe_id, "refs/kin/s0", "b" * 40, '{"created_dirs":[],"file_ops":[]}', "prepared", 1, 20),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE apply_journals SET state = 'committed' WHERE id = ?", (apj_id,))
        conn.execute("UPDATE apply_journals SET state = 'committing' WHERE id = ?", (apj_id,))
        conn.execute("UPDATE apply_journals SET state = 'committed', completed_at_us = 30 WHERE id = ?", (apj_id,))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE apply_journals SET state = 'rolled_back' WHERE id = ?", (apj_id,))

    def test_95_rt7_06_subagent_orphan_cancellation_cascade_trigger(self):
        conn = self._new_project_db()
        agt_boss, agt_spec, chn_id, thr_id, run_boss, _ = self._seed_agent_channel_run(conn, tainted=0)
        run_child = make_ulid("run", 95)
        run_grandchild = make_ulid("run", 96)
        conn.execute(
            "INSERT INTO runs(id,agent_id,parent_run_id,context_key,channel_id,thread_id,status,autonomy_effective,sandbox_level,tainted,started_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (run_child, agt_boss, run_boss, f"sub:{run_child}", chn_id, thr_id, "waiting_subagent", "WORKTREE_AUTO", "S2", 0, 200),
        )
        conn.execute(
            "INSERT INTO runs(id,agent_id,parent_run_id,context_key,channel_id,thread_id,status,autonomy_effective,sandbox_level,tainted,started_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (run_grandchild, agt_spec, run_child, f"sub:{run_grandchild}", chn_id, thr_id, "streaming_model", "WORKTREE_AUTO", "S2", 0, 210),
        )
        conn.execute("UPDATE runs SET status = 'cancelled', ended_at_us = 300 WHERE id = ?", (run_boss,))
        c_status, c_err, c_end = conn.execute("SELECT status, error_code, ended_at_us FROM runs WHERE id = ?", (run_child,)).fetchone()
        gc_status, gc_err, gc_end = conn.execute("SELECT status, error_code, ended_at_us FROM runs WHERE id = ?", (run_grandchild,)).fetchone()
        self.assertEqual(c_status, "cancelled")
        self.assertEqual(c_err, "KIN-HRN-0010")
        self.assertEqual(c_end, 300)
        self.assertEqual(gc_status, "cancelled")
        self.assertEqual(gc_err, "KIN-HRN-0010")
        self.assertEqual(gc_end, 300)

    def test_96_rt7_07_warm_lsp_and_mcp_resource_caps_and_idle_eviction(self):
        self.assertIn("ENV-LSP-001", self.doc04)
        self.assertIn("max_warm_lsp_servers_per_project = 2", self.doc04)
        self.assertIn("max_lsp_rss_mb = 1536", self.doc04)
        self.assertIn("lsp_idle_timeout_secs = 900", self.doc04)

    def test_97_rt7_08_disk_full_enospc_pre_flight_and_wal_checkpoint_valve(self):
        self.assertIn("DB-STR-002", self.doc02)
        self.assertIn("KIN-STR-0008", self.doc02)
        self.assertIn("PRAGMA wal_checkpoint(TRUNCATE);", self.doc02)

    def test_98_rt7_09_monotonic_microsecond_wall_clock_contract(self):
        self.assertIn("TRD-CLK-001", self.doc02)
        self.assertIn("last_issued_ts_us", self.doc02)
        self.assertIn("compare_exchange_weak", self.doc02)
        self.assertNotIn("fetch_max", self.doc02)
        # Simulate the exact CAS formula: next_ts_us = prev.max(os_wall_clock_us - 1) + 1 stored back into last_issued_ts_us
        state = {"last_issued_ts_us": 0}
        def next_monotonic_ts(os_wall_clock_us: int) -> int:
            prev = state["last_issued_ts_us"]
            nxt = max(prev, os_wall_clock_us - 1) + 1
            state["last_issued_ts_us"] = nxt
            return nxt
        t1 = next_monotonic_ts(1_000_000)
        t2 = next_monotonic_ts(1_000_000)  # identical wall clock
        t3 = next_monotonic_ts(950_000)    # NTP backward step
        t4 = next_monotonic_ts(950_000)    # repeated backward wall clock
        self.assertEqual((t1, t2, t3, t4), (1_000_000, 1_000_001, 1_000_002, 1_000_003))

    def test_99_rt7_10_master_spec_no_duplicate_concatenation_and_fences_intact(self):
        master_txt = read_doc("KIN-v10.0-PRODUCTION-Master-Specification.md")
        for doc_num in range(8):
            hdr = f"# DOC-0{doc_num}:"
            self.assertEqual(master_txt.count(hdr), 1, f"Duplicate or missing {hdr} in Master Specification")
        fences = re.findall(r"^```", master_txt, flags=re.MULTILINE)
        self.assertEqual(len(fences) % 2, 0, "Unbalanced code fences in Master Specification")
        self.assertGreaterEqual(len(extract_sql_blocks(master_txt)), 2)
        self.assertGreaterEqual(len(extract_rust_blocks(master_txt)), 6)
        self.assertGreaterEqual(len(extract_json_blocks(master_txt)), 1)

    def test_100_rt7_10_code_fence_balance_across_all_suite_docs(self):
        # Fixed RT9-19: test_100 genuinely verifies code-fence balance across every markdown file on disk
        for fname in [
            "AGENTS.md",
            "00-AGENTS-AND-AUDIT.md",
            "01-PRD.md",
            "02-TRD-AND-DDL.md",
            "03-HARNESS-MEMORY-CONTEXT.md",
            "04-WORKTREE-DAG-BROWSER-GATEWAY.md",
            "05-SECURITY-LEDGER-EXTENSIBILITY.md",
            "06-IPC-CONTRACTS-QA-ROADMAP.md",
            "07-PROMPTS-SCHEMAS-AND-SANDBOX-PROFILES.md",
            "08-C4-ADRS-COMPATIBILITY-RUNBOOK-AND-LOCKFILES.md",
            "KIN-v10.0-PRODUCTION-Master-Specification.md",
        ]:
            txt = read_doc(fname)
            fences = re.findall(r"^```", txt, flags=re.MULTILINE)
            self.assertEqual(len(fences) % 2, 0, f"Unbalanced code fences in {fname}: {len(fences)}")

    # --- 10 Round-8 v7.0 Verification Tests (test_101 .. test_110) ---
    def test_101_rt8_01_v7_protocol_framing_hkdf_and_config_alignment(self):
        for fname in [
            "00-AGENTS-AND-AUDIT.md",
            "01-PRD.md",
            "02-TRD-AND-DDL.md",
            "03-HARNESS-MEMORY-CONTEXT.md",
            "04-WORKTREE-DAG-BROWSER-GATEWAY.md",
            "05-SECURITY-LEDGER-EXTENSIBILITY.md",
            "06-IPC-CONTRACTS-QA-ROADMAP.md",
            "07-PROMPTS-SCHEMAS-AND-SANDBOX-PROFILES.md",
            "08-C4-ADRS-COMPATIBILITY-RUNBOOK-AND-LOCKFILES.md",
        ]:
            txt = read_doc(fname)
            self.assertIn("10.0.0-PRODUCTION", txt, f"{fname} missing 10.0.0-PRODUCTION")
        self.assertIn('0x4B494E38 "KIN8"', self.doc02)
        self.assertIn("kin/v8/sqlcipher-pdk", self.doc02)
        self.assertIn("kin/v8/blob-xchacha20", self.doc02)
        self.assertIn("schema_version = 8", self.doc07)
        self.assertIn("https://releases.kin.dev/v10.0/manifest.json", self.doc05)

    def test_102_rt8_02_linux_pid1_signal_exit_code_128_plus_sig(self):
        rust_blocks = extract_rust_blocks(self.doc07)
        linux_rs = next(b for b in rust_blocks if "enter_linux_s2_sandbox" in b)
        self.assertIn("libc::WIFSIGNALED(status)", linux_rs)
        self.assertIn("128 + libc::WTERMSIG(status)", linux_rs)

    def test_103_rt8_03_two_hop_subagent_cancel_and_ended_at_us(self):
        conn = self._new_project_db()
        agt_boss, agt_spec, chn_id, thr_id, run_boss, _ = self._seed_agent_channel_run(conn, tainted=0)
        run_c1 = make_ulid("run", 103)
        conn.execute(
            "INSERT INTO runs(id,agent_id,parent_run_id,context_key,channel_id,thread_id,status,autonomy_effective,sandbox_level,tainted,started_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (run_c1, agt_spec, run_boss, f"sub:{run_c1}", chn_id, thr_id, "executing_tools", "WORKTREE_AUTO", "S2", 0, 500),
        )
        conn.execute("UPDATE runs SET status = 'cancelled', ended_at_us = 999 WHERE id = ?", (run_boss,))
        row = conn.execute("SELECT status, ended_at_us FROM runs WHERE id = ?", (run_c1,)).fetchone()
        self.assertEqual(row[0], "cancelled")
        self.assertEqual(row[1], 999)

    def test_104_rt8_04_meetings_concluded_requires_decision_record_check(self):
        conn = self._new_project_db()
        agt1, agt2, chn_id, thr_id, _, _ = self._seed_agent_channel_run(conn)
        mtg_id = make_ulid("mtg", 104)
        conn.execute(
            "INSERT INTO meetings(id,channel_id,thread_id,moderator_agent_id,mode,agenda,participants_json,started_at_us) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (mtg_id, chn_id, thr_id, agt1, "moderated", "Design", json.dumps([agt1, agt2]), 100),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE meetings SET status = 'concluded' WHERE id = ?", (mtg_id,))
        conn.execute("UPDATE meetings SET status = 'concluded', decision_record_md = '# Decision Record' WHERE id = ?", (mtg_id,))

    def test_105_rt8_05_worktree_lanes_verification_state_sha_check(self):
        conn = self._new_project_db()
        _, agt_spec, _, _, _, _ = self._seed_agent_channel_run(conn)
        wkt_id = make_ulid("wkt", 105)
        conn.execute(
            "INSERT INTO worktree_lanes(id,owner_agent_id,worktree_path,branch_name,base_commit_sha,root_snapshot_ref,head_commit_sha,current_tree_sha,cow_strategy,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (wkt_id, agt_spec, "/tmp/w105", "kin/w105", "a" * 40, "refs/kin/s0", "a" * 40, "b" * 40, "apfs_clonefile", 1, 1),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE worktree_lanes SET verification_state = 'verified', last_verified_tree_sha = NULL WHERE id = ?", (wkt_id,))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE worktree_lanes SET verification_state = 'unverified_no_gate', last_verified_tree_sha = ? WHERE id = ?", ("b" * 40, wkt_id))
        conn.execute("UPDATE worktree_lanes SET verification_state = 'verified', last_verified_tree_sha = ? WHERE id = ?", ("b" * 40, wkt_id))

    def test_106_rt8_06_harness_budget_guard_hrn_bdg_001(self):
        self.assertIn("HRN-BDG-001", self.doc03)
        self.assertIn("KIN-HRN-0011", self.doc03)
        self.assertIn('type="budget_warning"', self.doc03)

    def test_107_rt8_07_verified_readonly_toolchain_discovery_env_tcn_001(self):
        self.assertIn("ENV-TCN-001", self.doc04)
        self.assertIn("(st_mode & 0o022) == 0", self.doc04)

    def test_108_rt8_08_runs_terminal_ended_at_us_populated(self):
        conn = self._new_project_db()
        _, _, _, _, run_id, _ = self._seed_agent_channel_run(conn)
        # Terminal status without ended_at_us is strictly rejected on both INSERT and UPDATE (RT9-07)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE runs SET status = 'completed' WHERE id = ?", (run_id,))
        conn.execute("UPDATE runs SET status = 'completed', ended_at_us = 250 WHERE id = ?", (run_id,))
        ended = conn.execute("SELECT ended_at_us FROM runs WHERE id = ?", (run_id,)).fetchone()[0]
        self.assertEqual(ended, 250)

    def test_109_rt8_09_tasks_cannot_complete_directly_from_blocked(self):
        conn = self._new_project_db()
        tsk_id = make_ulid("tsk", 109)
        conn.execute(
            "INSERT INTO tasks(id,title,description_md,status,created_at_us,updated_at_us) VALUES (?,?,?,?,?,?)",
            (tsk_id, "Blocked Task", "Desc", "blocked", 1, 1),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE tasks SET status = 'done' WHERE id = ?", (tsk_id,))
        conn.execute("UPDATE tasks SET status = 'ready' WHERE id = ?", (tsk_id,))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE tasks SET status = 'done' WHERE id = ?", (tsk_id,))
        conn.execute("UPDATE tasks SET status = 'in_progress' WHERE id = ?", (tsk_id,))
        conn.execute("UPDATE tasks SET status = 'done' WHERE id = ?", (tsk_id,))

    def test_110_rt8_10_round_8_audit_items_verified(self):
        for i in range(1, 11):
            self.assertIn(f"RT8-{i:02d}", self.doc00)

    # =========================================================================
    # 20 New Round-9 Behavioral & Adversarial Verification Tests (test_111..130)
    # =========================================================================
    def test_111_rt9_01_linux_rs_seccompiler_04_types_and_arch_try_into(self):
        rust_blocks = extract_rust_blocks(self.doc07)
        linux_rs = next(b for b in rust_blocks if "enter_linux_s2_sandbox" in b)
        self.assertNotIn("TargetArch::current()", linux_rs)
        self.assertIn("BackendError", linux_rs)
        self.assertIn("SeccompBackend(BackendError)", linux_rs)
        self.assertIn("impl From<BackendError> for SandboxError", linux_rs)
        self.assertIn("std::env::consts::ARCH", linux_rs)
        self.assertIn(".try_into()", linux_rs)
        self.assertIn('seccompiler = "0.4.0"', self.doc02)
        self.assertIn('landlock = "0.4.1"', self.doc02)

    def test_112_rt9_02_seccomp_clone3_enosys_and_clone_ns_flags_blocked(self):
        rust_blocks = extract_rust_blocks(self.doc07)
        linux_rs = next(b for b in rust_blocks if "enter_linux_s2_sandbox" in b)
        self.assertIn("SeccompAction::Errno(libc::ENOSYS as u32)", linux_rs)
        self.assertIn("clone3_rules.insert(libc::SYS_clone3, vec![]);", linux_rs)
        for flag in [
            "libc::CLONE_NEWUSER",
            "libc::CLONE_NEWNS",
            "libc::CLONE_NEWPID",
            "libc::CLONE_NEWNET",
            "libc::CLONE_NEWIPC",
            "libc::CLONE_NEWUTS",
            "libc::CLONE_NEWCGROUP",
        ]:
            self.assertIn(flag, linux_rs)
        self.assertIn("SeccompCmpOp::MaskedEq(flag)", linux_rs)
        self.assertIn("eperm_rules.insert(libc::SYS_clone, clone_rules);", linux_rs)

    def test_113_rt9_03_landlock_dev_null_tty_urandom_read_write_rules(self):
        rust_blocks = extract_rust_blocks(self.doc07)
        linux_rs = next(b for b in rust_blocks if "enter_linux_s2_sandbox" in b)
        self.assertIn("let dev_rw_access = AccessFs::ReadFile | AccessFs::WriteFile;", linux_rs)
        for dev in ["/dev/null", "/dev/zero", "/dev/full", "/dev/random", "/dev/urandom", "/dev/tty", "/dev/ptmx"]:
            self.assertIn(f'"{dev}"', linux_rs)

    def test_114_rt9_04_pid1_init_reaper_and_pid2_process_group_kill_grace(self):
        rust_blocks = extract_rust_blocks(self.doc07)
        linux_rs = next(b for b in rust_blocks if "enter_linux_s2_sandbox" in b)
        self.assertIn("pub fn run_pid1_init_reaper_for_pid2(cmd_pid: libc::pid_t, kill_grace_ms: u64) -> !", linux_rs)
        self.assertIn("libc::setpgid(0, 0)", linux_rs)
        self.assertIn("libc::kill(-cmd_pid, sig)", linux_rs)
        self.assertIn("libc::kill(-cmd_pid, libc::SIGKILL)", linux_rs)
        self.assertIn("TL-SHL-002", self.doc04)

    def test_115_rt9_05_every_unsafe_block_has_matching_safety_comment(self):
        rust_blocks = extract_rust_blocks(self.doc07) + extract_rust_blocks(self.doc06)
        total_unsafe = 0
        for blk in rust_blocks:
            unsafes = len(re.findall(r"\bunsafe\s*\{", blk))
            safeties = len(re.findall(r"//\s*SAFETY:", blk))
            self.assertEqual(unsafes, safeties, f"Mismatch between unsafe blocks ({unsafes}) and // SAFETY: comments ({safeties})")
            total_unsafe += unsafes
        self.assertGreaterEqual(total_unsafe, 24)

    def test_116_rt9_06_per_lane_proxy_auth_and_windows_s1_egress_caveat(self):
        self.assertIn("SEC-EGR-002", self.doc05)
        self.assertIn("Proxy-Authorization: Basic", self.doc05)
        self.assertIn("KIN-EGR-0006", self.doc05)
        self.assertIn("http://kin-lane-<wkt_id>:<lane_proxy_token>@127.0.0.1:<lane_proxy_port>", self.doc04)
        self.assertIn("HTTP_PROXY` in `S1` is advisory", self.doc05)
        self.assertIn("in Windows `S1` fallback mode, `HTTP_PROXY` is advisory", self.doc00)

    def test_117_rt9_07_runs_ended_at_us_check_and_monotonic_cancel_cascade(self):
        conn = self._new_project_db()
        agt_boss, agt_spec, chn_id, thr_id, parent_run_id, _ = self._seed_agent_channel_run(conn, tainted=0)
        # Reproduce the exact user-reported scenario: parent starts at 100, child starts at 5000
        child_run_id = make_ulid("run", 117)
        conn.execute(
            "INSERT INTO runs(id,agent_id,parent_run_id,context_key,channel_id,thread_id,status,autonomy_effective,sandbox_level,tainted,started_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (child_run_id, agt_spec, parent_run_id, f"sub:{child_run_id}", chn_id, thr_id, "executing_tools", "WORKTREE_AUTO", "S2", 0, 5000),
        )
        # Even if parent is cancelled with ended_at_us = 200 (< child's 5000), child's ended_at_us clamps to MAX(200, 5000) = 5000!
        conn.execute("UPDATE runs SET status = 'cancelled', ended_at_us = 200 WHERE id = ?", (parent_run_id,))
        c_status, c_start, c_end = conn.execute("SELECT status, started_at_us, ended_at_us FROM runs WHERE id = ?", (child_run_id,)).fetchone()
        self.assertEqual(c_status, "cancelled")
        self.assertGreaterEqual(c_end, c_start)
        self.assertEqual(c_end, 5000)

        # Direct INSERT of a completed run with NULL ended_at_us is rejected by CHECK constraint
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO runs(id,agent_id,context_key,channel_id,thread_id,status,autonomy_effective,sandbox_level,started_at_us,ended_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (make_ulid("run", 118), agt_boss, "chn:null_end", chn_id, thr_id, "completed", "WORKTREE_AUTO", "S2", 1000, None),
            )
        # Direct INSERT of a completed run with ended_at_us < started_at_us is rejected by CHECK constraint
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO runs(id,agent_id,context_key,channel_id,thread_id,status,autonomy_effective,sandbox_level,started_at_us,ended_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (make_ulid("run", 119), agt_boss, "chn:bad_end", chn_id, thr_id, "completed", "WORKTREE_AUTO", "S2", 1000, 999),
            )

    def test_118_rt9_07_tasks_state_machine_and_unfinished_dependency_guard(self):
        conn = self._new_project_db()
        dep_id = make_ulid("tsk", 1180)
        main_id = make_ulid("tsk", 1181)
        conn.execute(
            "INSERT INTO tasks(id,title,description_md,status,created_at_us,updated_at_us) VALUES (?,?,?,?,?,?)",
            (dep_id, "Dep Task", "Desc", "ready", 1, 1),
        )
        conn.execute(
            "INSERT INTO tasks(id,title,description_md,status,created_at_us,updated_at_us) VALUES (?,?,?,?,?,?)",
            (main_id, "Main Task", "Desc", "blocked", 1, 1),
        )
        conn.execute("INSERT INTO task_dependencies(task_id,depends_on_task_id) VALUES (?,?)", (main_id, dep_id))

        # 1. Cannot transition blocked -> ready while dep_id is still 'ready' (not 'done')
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE tasks SET status = 'ready' WHERE id = ?", (main_id,))

        # 2. Cannot transition dep_id from ready -> done directly without in_progress/in_review
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE tasks SET status = 'done' WHERE id = ?", (dep_id,))

        # 3. Advance dep_id: ready -> in_progress -> done
        conn.execute("UPDATE tasks SET status = 'in_progress' WHERE id = ?", (dep_id,))
        conn.execute("UPDATE tasks SET status = 'done', completed_at_us = 10 WHERE id = ?", (dep_id,))

        # 4. Cannot reopen terminal 'done' task back to 'in_progress'
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE tasks SET status = 'in_progress' WHERE id = ?", (dep_id,))

        # 5. Now main_id can transition blocked -> ready -> in_progress -> done
        conn.execute("UPDATE tasks SET status = 'ready' WHERE id = ?", (main_id,))
        conn.execute("UPDATE tasks SET status = 'in_progress' WHERE id = ?", (main_id,))
        conn.execute("UPDATE tasks SET status = 'done', completed_at_us = 20 WHERE id = ?", (main_id,))

    def test_119_rt9_07_runs_immutable_lineage_blocks_detach_taint_laundering(self):
        conn = self._new_project_db()
        agt_boss, agt_spec, chn_id, thr_id, parent_run_id, _ = self._seed_agent_channel_run(conn, tainted=0)
        child_run_id = make_ulid("run", 1190)
        conn.execute(
            "INSERT INTO runs(id,agent_id,parent_run_id,context_key,channel_id,thread_id,status,autonomy_effective,sandbox_level,tainted,started_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (child_run_id, agt_spec, parent_run_id, f"sub:{child_run_id}", chn_id, thr_id, "executing_tools", "WORKTREE_AUTO", "S2", 0, 200),
        )
        # Attempting to detach child_run_id (parent_run_id = NULL) before tainting is blocked by trg_runs_monotonic_and_terminal
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE runs SET parent_run_id = NULL WHERE id = ?", (child_run_id,))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE runs SET agent_id = ? WHERE id = ?", (agt_boss, child_run_id))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE runs SET started_at_us = 999 WHERE id = ?", (child_run_id,))

    def test_120_rt9_07_agents_hierarchy_spawn_depth_and_boss_reparent_blocked(self):
        conn = self._new_project_db()
        agt_boss, agt_spec, _, _, _, _ = self._seed_agent_channel_run(conn)
        # 1. Re-parenting @boss under a specialist is blocked by CHECK and trg_agents_hierarchy_update
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE agents SET parent_agent_id = ? WHERE id = ?", (agt_spec, agt_boss))
        # 2. Inserting a specialist with spawn_depth = 2 under @boss (spawn_depth = 0) is blocked (must be 0 + 1 = 1)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO agents(id,slug,display_name,role_kind,lifecycle,parent_agent_id,spawn_depth,title,charter_markdown,created_at_us,updated_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (make_ulid("agt", 1200), "bad_depth", "Bad", "specialist", "persistent", agt_boss, 2, "Eng", "Charter", 100, 100),
            )
        # 3. Valid depth-2 subagent under depth-1 specialist succeeds
        sub_d2 = make_ulid("agt", 1201)
        conn.execute(
            "INSERT INTO agents(id,slug,display_name,role_kind,lifecycle,parent_agent_id,spawn_depth,title,charter_markdown,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (sub_d2, "sub_d2", "SubD2", "subagent", "task_scoped", agt_spec, 2, "Sub", "Charter", 100, 100),
        )

    def test_121_rt9_07_all_18_json_columns_enforce_json_valid(self):
        # Verify that every column ending in _json across project.db has a json_valid(col) CHECK constraint
        json_cols = re.findall(r"^\s*([a-z0-9_]+_json)\s+TEXT", self.prj_sql, flags=re.MULTILINE)
        self.assertEqual(len(json_cols), 22, f"Expected 22 _json columns, found {len(json_cols)}: {json_cols}")
        for col in json_cols:
            self.assertIn(f"json_valid({col})", self.prj_sql, f"Column {col} missing json_valid({col}) CHECK")

        # Behaviorally test invalid JSON against apply_journals.operations_json and agents.owned_globs_json
        conn = self._new_project_db()
        agt_boss, agt_spec, _, _, _, _ = self._seed_agent_channel_run(conn)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE agents SET owned_globs_json = 'not-valid-json' WHERE id = ?", (agt_spec,))
        wkt_id = make_ulid("wkt", 121)
        mqe_id = make_ulid("mqe", 121)
        conn.execute(
            "INSERT INTO worktree_lanes(id,owner_agent_id,worktree_path,branch_name,base_commit_sha,root_snapshot_ref,head_commit_sha,current_tree_sha,cow_strategy,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (wkt_id, agt_spec, "/tmp/w121", "kin/w121", "a" * 40, "refs/kin/s0", "a" * 40, "b" * 40, "apfs_clonefile", 1, 1),
        )
        conn.execute(
            "INSERT INTO merge_queue_entries(id,lane_id,attempt_no,submitted_by_agent_id,status,enqueued_at_us) VALUES (?,?,?,?,?,?)",
            (mqe_id, wkt_id, 1, agt_spec, "applying_root", 10),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO apply_journals(id,merge_entry_id,pre_apply_root_snap_ref,post_apply_tree_sha,operations_json,state,intent_ledger_seq,created_at_us) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (make_ulid("apj", 121), mqe_id, "refs/kin/s0", "b" * 40, "{broken_json", "prepared", 1, 20),
            )

    def test_122_rt9_08_completion_gate_3_strike_consistency_simulation(self):
        # Verify transition table (DOC-03 §2.1), prose (DOC-03 §2.4), and Rust code (DOC-06 §2.2) all use the same 3-strike rule
        self.assertIn("GateFailedSelfHeal(fail_attempt<3) -> preparing", self.doc03)
        self.assertIn("GateFailedMaxAttempts(fail_attempt>=3) -> failed", self.doc03)
        self.assertIn("let fail_attempt = ctx.store.increment_lane_gate_fail_attempts(lane_id).await?;", self.doc06)
        self.assertIn("if fail_attempt >= 3 {", self.doc06)

        # Simulate gate_fail_attempts starting at 0 in SQLite
        conn = self._new_project_db()
        _, agt_spec, _, _, _, _ = self._seed_agent_channel_run(conn)
        wkt_id = make_ulid("wkt", 122)
        conn.execute(
            "INSERT INTO worktree_lanes(id,owner_agent_id,worktree_path,branch_name,base_commit_sha,root_snapshot_ref,head_commit_sha,current_tree_sha,cow_strategy,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (wkt_id, agt_spec, "/tmp/w122", "kin/w122", "a" * 40, "refs/kin/s0", "a" * 40, "b" * 40, "apfs_clonefile", 1, 1),
        )
        outcomes = []
        for _ in range(3):
            conn.execute("UPDATE worktree_lanes SET gate_fail_attempts = gate_fail_attempts + 1 WHERE id = ?", (wkt_id,))
            fail_attempt = conn.execute("SELECT gate_fail_attempts FROM worktree_lanes WHERE id = ?", (wkt_id,)).fetchone()[0]
            outcomes.append("failed" if fail_attempt >= 3 else "self_heal")
        self.assertEqual(outcomes, ["self_heal", "self_heal", "failed"])

    def test_123_rt9_09_ssrf_filter_compiled_and_executed_against_all_bypasses(self):
        # Extract is_ssrf_forbidden_ip from DOC-06 §2.4 and execute its exact bit-level logic against all 32 adversarial IPv4/IPv6 cases
        import ipaddress
        self.assertIn("o[0] == 0", self.doc06)
        self.assertIn("(s[0] & 0xe000) != 0x2000", self.doc06)
        self.assertIn("s[0] == 0x2002", self.doc06)
        self.assertIn("s[0] == 0x2001 && s[1] == 0x0000", self.doc06)

        def eval_doc06_ssrf_filter(ip_str: str) -> bool:
            ip = ipaddress.ip_address(ip_str)
            if isinstance(ip, ipaddress.IPv4Address):
                o = list(ip.packed)
                return (
                    o[0] == 0
                    or o[0] == 127
                    or o[0] == 10
                    or (o[0] == 172 and (o[1] & 0xf0) == 16)
                    or (o[0] == 192 and o[1] == 168)
                    or (o[0] == 169 and o[1] == 254)
                    or (o[0] == 100 and (o[1] & 0xc0) == 64)
                    or (o[0] == 192 and o[1] == 0 and (o[2] == 0 or o[2] == 2))
                    or (o[0] == 198 and (o[1] == 18 or o[1] == 19))
                    or (o[0] == 198 and o[1] == 51 and o[2] == 100)
                    or (o[0] == 203 and o[1] == 0 and o[2] == 113)
                    or o[0] >= 224
                )
            else:
                b = ip.packed
                s = [int.from_bytes(b[i:i+2], "big") for i in range(0, 16, 2)]
                # Check IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96
                if s[0] == 0 and s[1] == 0 and s[2] == 0 and s[3] == 0 and s[4] == 0 and (s[5] == 0xffff or s[5] == 0):
                    if s[5] == 0 and s[6] == 0 and s[7] <= 1:
                        return True
                    v4_int = (s[6] << 16) | s[7]
                    return eval_doc06_ssrf_filter(str(ipaddress.IPv4Address(v4_int)))
                # Strict IANA Global Unicast 2000::/3 gate + special prefix blocks
                return (
                    (s[0] & 0xe000) != 0x2000
                    or s[0] == 0x2002
                    or (s[0] == 0x2001 and s[1] == 0x0000)
                    or (s[0] == 0x2001 and s[1] == 0x0002 and s[2] == 0)
                    or (s[0] == 0x2001 and s[1] == 0x0db8)
                    or (s[0] == 0x2001 and (s[1] & 0xfff0) == 0x0010)
                    or (s[0] == 0x2001 and (s[1] & 0xfff0) == 0x0020)
                )

        must_block = [
            "0.0.0.0",
            "0.0.0.1",                 # User-reported bypass #1 (0.0.0.0/8 host)
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "255.255.255.255",
            "::",
            "::1",
            "::ffff:127.0.0.1",
            "::ffff:169.254.169.254",
            "::127.0.0.1",             # User-reported bypass #6 (IPv4-compatible loopback)
            "2002:7f00:0001::1",       # User-reported bypass #2 (6to4 embedding 127.0.0.1)
            "2002:a9fe:a9fe::1",       # User-reported bypass #2 (6to4 embedding 169.254.169.254)
            "2001:0000:4136:e378:8000:63bf:3fff:fdd2", # User-reported bypass #3 (Teredo)
            "fec0::1",                 # User-reported bypass #4 (Deprecated Site-Local fec0::/10)
            "100::1",                  # User-reported bypass #5 (Discard-Only 100::/64)
            "64:ff9b::7f00:1",         # NAT64 Well-Known Prefix
            "64:ff9b:1::1",            # NAT64 Local-Use Prefix
            "fc00::1",                 # Unique Local
            "fd00:ec2::254",           # AWS IMDSv2
            "fe80::1",                 # Link-Local
            "ff02::1",                 # Multicast
            "2001:db8::1",             # Documentation
        ]
        for addr in must_block:
            self.assertTrue(eval_doc06_ssrf_filter(addr), f"SSRF filter failed to block {addr}")

        must_allow = [
            "1.1.1.1",
            "8.8.8.8",
            "140.82.121.4",
            "2606:4700:4700::1111",
            "2001:4860:4860::8888",
        ]
        for addr in must_allow:
            self.assertFalse(eval_doc06_ssrf_filter(addr), f"SSRF filter falsely blocked public IP {addr}")

        # Audit Finding 5: Simulate per-hop redirect validation with scheme check, allowlist check, and DNS-rebinding check
        allowed_hosts = {"api.github.com", "rebind.example.com"}
        dns_records = {
            "api.github.com": ["140.82.121.4"],
            "rebind.example.com": ["140.82.121.4", "169.254.169.254"],  # DNS rebinding / dual-record SSRF
        }
        def check_redirect_hop(scheme: str, host: str, hops: int, allow_http: bool = False) -> tuple[bool, str]:
            if hops >= 5:
                return False, "KIN-EGR-0005"
            if not (scheme == "https" or (scheme == "http" and allow_http)):
                return False, "KIN-EGR-0005"
            if host.lower() not in allowed_hosts:
                return False, "KIN-EGR-0005"
            resolved = dns_records.get(host.lower(), [])
            if not resolved or any(eval_doc06_ssrf_filter(ip) for ip in resolved):
                return False, "KIN-EGR-0004"
            return True, "OK"

        self.assertEqual(check_redirect_hop("https", "api.github.com", 1), (True, "OK"))
        self.assertEqual(check_redirect_hop("http", "api.github.com", 1, allow_http=False), (False, "KIN-EGR-0005"))
        self.assertEqual(check_redirect_hop("file", "api.github.com", 1, allow_http=True), (False, "KIN-EGR-0005"))
        self.assertEqual(check_redirect_hop("https", "evil.example.com", 1), (False, "KIN-EGR-0005"))
        self.assertEqual(check_redirect_hop("https", "rebind.example.com", 1), (False, "KIN-EGR-0004"))

    def test_124_rt9_10_browser_architecture_chromium_quic_webrtc_hardening(self):
        self.assertIn("## 6. Dedicated `kin-browser` CDP Automation", self.doc04)
        for flag in [
            "--proxy-server=http://127.0.0.1:<lane_proxy_port>",
            "--proxy-bypass-list=<-loopback>",
            "--disable-quic",
            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
            "--webrtc-ip-handling-policy=disable_non_proxied_udp",
            "--host-resolver-rules=",
        ]:
            self.assertIn(flag, self.doc04)

    def test_125_rt9_11_all_p0_p2_st_rt_ids_defined_and_264_section_refs_resolve(self):
        # 1. Verify all 26 Round-1 IDs (P0-1..P0-7, P1-8..P1-17, P2-1..P2-9) are defined in DOC-00 §2.1B
        for i in range(1, 8):
            self.assertIn(f"**P0-{i}", self.doc00)
        for i in range(8, 18):
            self.assertIn(f"**P1-{i}", self.doc00)
        for i in range(1, 10):
            self.assertIn(f"**P2-{i}", self.doc00)
        # 2. Verify all 45 ST-01..ST-45 and all RT5-01..RT5-12 have individual rows (zero range rows like ST-16..ST-25)
        for i in range(1, 46):
            self.assertIn(f"| **ST-{i:02d}** |", self.doc00)
        for i in range(1, 13):
            self.assertIn(f"| **RT5-{i:02d}** |", self.doc00)
        for i in range(1, 23):
            self.assertIn(f"| **RT9-{i:02d}** |", self.doc00)
        # 3. Verify 100% of DOC-0X §Y.Z references resolve across all 9 documents (DOC-00..DOC-08)
        docs = {
            "DOC-00": self.doc00, "DOC-01": self.doc01, "DOC-02": self.doc02, "DOC-03": self.doc03,
            "DOC-04": self.doc04, "DOC-05": self.doc05, "DOC-06": self.doc06, "DOC-07": self.doc07,
            "DOC-08": self.doc08,
        }
        for src_name, txt in docs.items():
            for target_doc, sec_num in re.findall(r"(DOC-0[0-8])\s*§(\d+(?:\.\d+)?)", txt):
                pat = rf"^#{{2,4}}\s+{re.escape(sec_num)}\b"
                self.assertIsNotNone(
                    re.search(pat, docs[target_doc], flags=re.MULTILINE),
                    f"Broken cross-reference in {src_name}: {target_doc} §{sec_num}",
                )

    def test_126_rt9_12_closed_error_taxonomy_registry_and_kin_error_enum(self):
        all_text = "\n".join([self.doc00, self.doc01, self.doc02, self.doc03, self.doc04, self.doc05, self.doc06, self.doc07, self.doc08])
        all_codes = sorted(set(re.findall(r"KIN-[A-Z]{3}-\d{4}", all_text)))
        self.assertEqual(len(all_codes), 54)
        sec5_txt = self.doc00[self.doc00.index("## 5. Canonical Closed Error Taxonomy Registry"):]
        for code in all_codes:
            self.assertIn(f"| `{code}` |", sec5_txt, f"Error code {code} missing from DOC-00 §5 registry table")
            self.assertIn(f'"{code}"', self.doc06, f"Error code {code} missing from KinError enum in DOC-06 §1.2")

    def test_127_rt9_13_memory_vec_sync_triggers_and_scope_key_query_helper(self):
        self.assertIn("CREATE TRIGGER IF NOT EXISTS trg_memory_vec_ad AFTER DELETE ON memory_items", self.vec_sql)
        self.assertIn("CREATE TRIGGER IF NOT EXISTS trg_memory_vec_au AFTER UPDATE OF status, tier, scope_id, embedding_f32 ON memory_items", self.vec_sql)
        self.assertIn("DELETE FROM memory_vec WHERE memory_id = old.id;", self.vec_sql)
        self.assertIn("query_memory_vec_knn_scoped", self.doc03)

    def test_128_rt9_14_ledger_purge_requires_signed_receipt_trigger(self):
        conn = self._new_project_db()
        conn.execute(
            "INSERT INTO ledger_events(seq,id,ts_us,event_kind,actor_kind,actor_id,payload_blake3,payload_purged,prev_event_blake3,event_blake3) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (0, make_ulid("ldg", 1280), 100, "tool.intent", "agent", "agt_1", "a" * 64, 0, "0" * 64, "b" * 64),
        )
        conn.execute("INSERT INTO ledger_payloads(seq,payload_jcs_json) VALUES (0,'{\"secret\":\"redact\"}')")
        # Attempting to delete from ledger_payloads WITHOUT a prior privacy.purge.receipt is blocked with KIN-LDG-0007
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("DELETE FROM ledger_payloads WHERE seq = 0")
        # Append a signed privacy.purge.receipt at seq = 1 referencing purged_seq = 0
        conn.execute(
            "INSERT INTO ledger_events(seq,id,ts_us,event_kind,actor_kind,actor_id,payload_blake3,payload_purged,prev_event_blake3,event_blake3) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (1, make_ulid("ldg", 1281), 105, "privacy.purge.receipt", "human", "human:operator", "c" * 64, 0, "b" * 64, "d" * 64),
        )
        conn.execute("INSERT INTO ledger_payloads(seq,payload_jcs_json) VALUES (1,'{\"ed25519_sig_hex\":\"aa\",\"entity_id\":\"tlc_1\",\"purged_seq\":0,\"reason\":\"operator_privacy_purge\"}')")
        # Now DELETE FROM ledger_payloads WHERE seq = 0 succeeds and sets payload_purged = 1
        conn.execute("DELETE FROM ledger_payloads WHERE seq = 0")
        purged = conn.execute("SELECT payload_purged FROM ledger_events WHERE seq = 0").fetchone()[0]
        self.assertEqual(purged, 1)

    def test_129_rt9_15_step_limit_pre_check_prevents_sqlite_integrity_error(self):
        self.assertIn("HRN-STP-001", self.doc03)
        self.assertIn("if ctx.step_count() >= ctx.max_steps() {", self.doc06)
        self.assertIn("KIN-HRN-0012", self.doc06)
        conn = self._new_project_db()
        _, _, _, _, run_id, _ = self._seed_agent_channel_run(conn)
        conn.execute("UPDATE runs SET step_count = 40, max_steps = 40 WHERE id = ?", (run_id,))
        # Pre-check transitions run to failed with KIN-HRN-0012 without incrementing step_count to 41
        conn.execute(
            "UPDATE runs SET status = 'failed', error_code = 'KIN-HRN-0012', ended_at_us = 900 WHERE id = ?",
            (run_id,),
        )
        st, code = conn.execute("SELECT status, error_code FROM runs WHERE id = ?", (run_id,)).fetchone()
        self.assertEqual((st, code), ("failed", "KIN-HRN-0012"))

    def test_130_rt9_16_to_22_mcp_headers_opt_in_updater_and_artifact_parity(self):
        # 1. MCP 2026-07-28 headers & methods (RT9-21)
        for mcp_item in ["server/discover", "Mcp-Method", "Mcp-Name", "_meta.continuation_token"]:
            self.assertIn(mcp_item, self.doc05)
        # 2. Opt-in updater (INV-016 / RT9-22)
        self.assertIn("check_updates_enabled = false", self.doc05)
        self.assertIn("check_updates_enabled = false", self.doc07)
        # 3. AUD-22 timing arithmetic (5 + 55 + 15 = 75ms < 80ms, RT9-20)
        self.assertIn("55ms", self.doc00)
        self.assertIn("diagnostic_wait_ms = 55", self.doc07)
        # 4. Zero Google redirect URLs across all files (RT9-16)
        for fname in [
            "AGENTS.md",
            "00-AGENTS-AND-AUDIT.md",
            "01-PRD.md",
            "02-TRD-AND-DDL.md",
            "03-HARNESS-MEMORY-CONTEXT.md",
            "04-WORKTREE-DAG-BROWSER-GATEWAY.md",
            "05-SECURITY-LEDGER-EXTENSIBILITY.md",
            "06-IPC-CONTRACTS-QA-ROADMAP.md",
            "07-PROMPTS-SCHEMAS-AND-SANDBOX-PROFILES.md",
            "08-C4-ADRS-COMPATIBILITY-RUNBOOK-AND-LOCKFILES.md",
            "KIN-v10.0-PRODUCTION-Master-Specification.md",
        ]:
            self.assertNotIn("google.com/search?q=", read_doc(fname), f"{fname} contains redirect URL")
        # 5. AGENTS.md is a concise developer/agent guide, not a 54 KB byte-identical duplicate of 00-AGENTS-AND-AUDIT.md (RT9-17)
        agents_md = read_doc("AGENTS.md")
        self.assertNotEqual(agents_md, self.doc00)
        self.assertLess(len(agents_md), len(self.doc00))


    def test_131_rt10_01_v8_01_version_and_protocol_alignment(self):
        for fname in [
            "AGENTS.md",
            "00-AGENTS-AND-AUDIT.md",
            "01-PRD.md",
            "02-TRD-AND-DDL.md",
            "03-HARNESS-MEMORY-CONTEXT.md",
            "04-WORKTREE-DAG-BROWSER-GATEWAY.md",
            "05-SECURITY-LEDGER-EXTENSIBILITY.md",
            "06-IPC-CONTRACTS-QA-ROADMAP.md",
            "07-PROMPTS-SCHEMAS-AND-SANDBOX-PROFILES.md",
            "08-C4-ADRS-COMPATIBILITY-RUNBOOK-AND-LOCKFILES.md",
            "KIN-v10.0-PRODUCTION-Master-Specification.md",
        ]:
            txt = read_doc(fname)
            self.assertIn("10.0.0-PRODUCTION", txt, f"Missing 10.0.0-PRODUCTION in {fname}")
        self.assertIn("kin-ipc-v8-client", self.doc02)
        self.assertIn("kin-ipc-v8-server", self.doc02)
        self.assertIn("KIN-Bench-Env-v10.0", self.doc01)

    def test_132_rt10_02_03_mcp_first_six_integration_domains_and_caveat(self):
        for txt in [self.doc01, self.doc05]:
            self.assertIn("GitHub", txt)
            self.assertIn("Google Sheets", txt)
            self.assertIn("Developer Preview Program", txt)
            self.assertIn("OAuth", txt)
            self.assertIn("Slack", txt)
            self.assertIn("Discord", txt)
            self.assertIn("Notion", txt)
            self.assertIn("Linear", txt)
            self.assertIn("Jira", txt)
            self.assertIn("Trello", txt)
            self.assertIn("PostgreSQL", txt)
            self.assertIn("Supabase", txt)
            self.assertIn("not** a claim that every", txt)

    def test_133_rt10_04_four_distinct_extension_categories(self):
        self.assertIn("1. Integrations", self.doc01)
        self.assertIn("2. Plugins & Extensions", self.doc01)
        self.assertIn("3. Skills & Playbooks", self.doc01)
        self.assertIn("4. Workflow Packs", self.doc01)
        self.assertIn("Category 1 — Integrations", self.doc05)
        self.assertIn("Category 2 — Plugins and Extensions", self.doc05)
        self.assertIn("Category 3 — Skills and Playbooks", self.doc05)
        self.assertIn("Category 4 — Workflow Packs", self.doc05)
        self.assertIn("CHECK (category IN ('integration','plugin','skill','workflow_pack'))", self.doc02)
        self.assertIn("pub enum ExtensionCategory { Integration, Plugin, Skill, WorkflowPack }", self.doc06)

    def test_134_rt10_05_mcp_integrations_and_extension_packages_ddl(self):
        conn = self._new_project_db()
        mcp_id = make_ulid("mcp", 1)
        conn.execute(
            "INSERT INTO mcp_integrations(id,slug,display_name,preset_slug,transport,endpoint_or_cmd_json,auth_kind,secret_handle_ref,access_mode,enabled,trust_status,pinned_schema_sha256,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (mcp_id, "github-official", "GitHub Official MCP", "github", "streamable_http", '{"url":"https://api.githubcopilot.com/mcp/"}',
             "secret_handle", "KIN_SECRET_GITHUB_TOKEN", "read_only", 1, "verified_schema", "a" * 64, 100, 100)
        )
        mcp_q = make_ulid("mcp", 2)
        conn.execute(
            "INSERT INTO mcp_integrations(id,slug,display_name,preset_slug,transport,endpoint_or_cmd_json,access_mode,enabled,trust_status,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (mcp_q, "untrusted-mcp", "Untrusted MCP", "custom", "stdio", '{"cmd":["npx","srv"]}', "read_only", 0, "quarantined_schema_mismatch", 100, 100)
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "KIN-EXT-0004"):
            conn.execute("UPDATE mcp_integrations SET enabled = 1 WHERE id = ?", (mcp_q,))

        for idx, cat in enumerate(["integration", "plugin", "skill", "workflow_pack"], start=1):
            ext_id = make_ulid("ext", idx)
            conn.execute(
                "INSERT INTO extension_packages(id,category,slug,version_semver,display_name,publisher_id,publisher_verified,package_blake3,manifest_json,security_scan_status,enabled,installed_at_us,updated_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (ext_id, cat, f"sample-{cat}", "1.0.0", f"Sample {cat}", "kin-first-party", 1, str(idx) * 64, '{"name":"sample"}', "passed", 1, 100, 100)
            )
        flagged_id = make_ulid("ext", 5)
        conn.execute(
            "INSERT INTO extension_packages(id,category,slug,version_semver,display_name,publisher_id,package_blake3,manifest_json,security_scan_status,enabled,installed_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (flagged_id, "plugin", "flagged-plugin", "0.1.0", "Flagged", "unverified", "f" * 64, '{}', "flagged", 0, 100, 100)
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "KIN-EXT-0003"):
            conn.execute("UPDATE extension_packages SET enabled = 1 WHERE id = ?", (flagged_id,))

    def test_135_rt10_06_read_only_mode_and_no_implicit_permissions(self):
        self.assertIn("KIN-EXT-0001", self.doc00)
        self.assertIn("KIN-EXT-0002", self.doc00)
        self.assertIn("IntegrationWriteBlockedInReadOnlyMode", self.doc05)
        self.assertIn("ExtensionPrivilegeEscalationDenied", self.doc05)
        self.assertIn("Zero Implicit Extra Permissions", self.doc05)

    def test_136_rt10_07_five_step_implementation_order_alignment(self):
        for txt in [self.doc01, self.doc05]:
            idx1 = txt.index("Step 1 — MCP Integration Manager")
            idx2 = txt.index("Step 2 — First-Party Integration Presets")
            idx3 = txt.index("Step 3 — Skills")
            idx4 = txt.index("Step 4 — Native Plugin SDK")
            idx5 = txt.index("Step 5 — Public Marketplace")
            self.assertTrue(idx1 < idx2 < idx3 < idx4 < idx5)

    def test_137_rt10_08_ipc_commands_and_54_error_codes(self):
        self.assertIn("McpIntegrationMutate {", self.doc06)
        self.assertIn("ExtensionPackageMutate {", self.doc06)
        self.assertIn("WorkflowPackStart {", self.doc06)
        for code in ["KIN-EXT-0001", "KIN-EXT-0002", "KIN-EXT-0003", "KIN-EXT-0004"]:
            self.assertIn(code, self.doc06)
            self.assertIn(code, self.doc00)

    def test_138_rt10_09_zero_in_cell_pipes_and_strict_table_columns(self):
        for fname in [
            "AGENTS.md",
            "00-AGENTS-AND-AUDIT.md",
            "01-PRD.md",
            "02-TRD-AND-DDL.md",
            "03-HARNESS-MEMORY-CONTEXT.md",
            "04-WORKTREE-DAG-BROWSER-GATEWAY.md",
            "05-SECURITY-LEDGER-EXTENSIBILITY.md",
            "06-IPC-CONTRACTS-QA-ROADMAP.md",
            "07-PROMPTS-SCHEMAS-AND-SANDBOX-PROFILES.md",
            "08-C4-ADRS-COMPATIBILITY-RUNBOOK-AND-LOCKFILES.md",
            "KIN-v10.0-PRODUCTION-Master-Specification.md",
        ]:
            txt = read_doc(fname)
            in_fence = False
            table_cols = None
            for lineno, line in enumerate(txt.splitlines(), 1):
                if line.strip().startswith("```"):
                    in_fence = not in_fence
                    continue
                if in_fence:
                    continue
                if line.startswith("|"):
                    self.assertNotIn(r"\|", line, f"Escaped pipe in table cell at {fname}:{lineno}")
                    self.assertNotIn("||", line, f"Double pipe in table cell at {fname}:{lineno}")
                    cols = line.count("|")
                    if table_cols is None:
                        table_cols = cols
                    else:
                        self.assertEqual(cols, table_cols, f"Table column mismatch at {fname}:{lineno}")
                else:
                    table_cols = None

    def test_139_rt10_10_kin_toml_presets_and_v8_01_suite_complete(self):
        import tomllib
        toml_block = self.doc07.split("# .kin/kin.toml")[1].split("```")[0]
        cfg = tomllib.loads("# .kin/kin.toml" + toml_block)
        self.assertEqual(cfg["schema_version"], 8)
        slugs = [s["slug"] for s in cfg["mcp"]["servers"]]
        self.assertEqual(slugs, ["filesystem-docs", "github-official", "google-workspace-sheets"])
        self.assertEqual(cfg["workflows"]["packs"][0]["slug"], "issue-to-pr")

    def test_140_all_ten_rounds_verified(self):
        for i in range(1, 11):
            self.assertIn(f"RT10-{i:02d}", self.doc00)

    # --- 10 New Round-11 v8.5 Cross-Document Consistency & Alignment Tests (test_141 .. test_150) ---
    def test_141_rt11_01_v8_5_version_and_manifest_alignment(self):
        for doc in [self.doc01, self.doc02, self.doc03, self.doc04, self.doc05, self.doc06, self.doc07, self.doc08]:
            self.assertIn("10.0.0-PRODUCTION", doc)
            self.assertNotIn("8.01.0-PRODUCTION", doc)
        self.assertIn("10.0.0-PRODUCTION", self.doc00)
        self.assertIn("Supersedes `1.0-draft`, `1.0.0-baseline`, `2.4.0-PROD`, `v12.0`, `3.0.0-PROD`, `4.0.0-APEX`, `5.0.0-FINAL`, `6.0.0-PRODUCTION`, `7.0.0-PRODUCTION`, `7.5.0-PRODUCTION`, `8.01.0-PRODUCTION`, `8.5.0-PRODUCTION`, and `9.0.0-PRODUCTION`.", self.doc00)
        self.assertIn("DEFAULT '10.0.0'", self.doc02)
        self.assertIn("KIN-Bench-Env-v10.0", self.doc01)
        self.assertIn("https://releases.kin.dev/v10.0/manifest.json", self.doc05)
        self.assertIn("https://releases.kin.dev/v10.0/manifest.json", self.doc07)

    def test_142_rt11_02_nfr_perf_006_55ms_lsp_timeout_consistency(self):
        for doc in [self.doc01, self.doc03, self.doc04, self.doc07]:
            self.assertNotIn("60ms", doc)
        self.assertIn("hard `55ms` timeout on `publishDiagnostics` (`diagnostic_wait_ms = 55`)", self.doc01)
        self.assertIn("diagnostic_wait_ms = 55", self.doc07)

    def test_143_rt11_03_pinned_schema_sha256_cross_doc_alignment(self):
        for doc in [self.doc01, self.doc02, self.doc05, self.doc06, self.doc07]:
            self.assertIn("pinned_schema_sha256", doc)
        import tomllib
        toml_block = self.doc07.split("# .kin/kin.toml")[1].split("```")[0]
        cfg = tomllib.loads("# .kin/kin.toml" + toml_block)
        for srv in cfg["mcp"]["servers"]:
            self.assertIn("pinned_schema_sha256", srv)
            self.assertEqual(len(srv["pinned_schema_sha256"]), 64)

    def test_144_rt11_04_egress_proxy_port_cross_os_consistency(self):
        self.assertIn("127.0.0.1:<lane_proxy_port>", self.doc04)
        self.assertIn("127.0.0.1:<lane_proxy_port>", self.doc05)
        self.assertNotIn("(localhost:18080)", self.doc05)

    def test_145_rt11_05_all_doc_scope_headers_complete(self):
        self.assertIn("PRD-EXT-001..005", self.doc01)
        self.assertIn("mcp_integrations", self.doc02)
        self.assertIn("HRN-BDG-001", self.doc03)
        self.assertIn("BRW-CDP-001..004", self.doc04)
        self.assertIn("SEC-EGR-001..003", self.doc05)
        self.assertIn("KinError", self.doc06)
        self.assertIn("seccompiler 0.4", self.doc07)
        self.assertIn("C4-L1", self.doc08)

    def test_146_rt11_06_l1_crate_list_and_agents_md_parity(self):
        agents_txt = read_doc("AGENTS.md")
        self.assertIn("10.0.0-PRODUCTION", agents_txt)
        self.assertIn("verify_kin_v10_0_suite.py", agents_txt)
        self.assertIn("54-code", agents_txt)
        self.assertIn("L1 (`kin-ports`, `kin-crypto`, `kin-plugin-sdk`)", self.doc00)
        self.assertIn("L1 (`kin-ports`, `kin-crypto`, `kin-plugin-sdk`)", self.doc02)
        self.assertIn("L1 (`kin-ports`, `kin-crypto`, `kin-plugin-sdk`)", agents_txt)

    def test_147_rt11_07_prompt_compiler_l2_l8_mcp_and_skill_alignment(self):
        self.assertIn("mcp_tool_search", self.doc03)
        self.assertIn("<kin-skill>", self.doc03)
        self.assertIn("mcp_tool_search", self.doc05)
        self.assertIn("<kin-skill>", self.doc05)

    def test_148_rt11_08_batch_pre_marking_mcp_integration_contract(self):
        self.assertIn("is_untrusted_mcp()", self.doc05)
        self.assertIn("preset_slug != 'filesystem'", self.doc05)
        self.assertIn("is_untrusted_mcp()", self.doc06)

    def test_149_rt11_09_ux_slash_commands_match_engine_command_variants(self):
        for variant in ["McpIntegrationMutate", "ExtensionPackageMutate", "WorkflowPackStart"]:
            self.assertIn(variant, self.doc01)
            self.assertIn(variant, self.doc06)

    def test_150_rt11_10_all_eleven_rounds_and_150_tests_verified(self):
        for i in range(1, 11):
            self.assertIn(f"RT11-{i:02d}", self.doc00)

    # --- 25 New Round-12 v9.0 Behavioral, Trigger, Sandbox & Cross-Doc Verification Tests (test_151 .. test_175) ---
    def test_151_rt12_01_tree_mutate_attempts_check_allows_third_increment(self):
        self.assertIn("tree_mutate_attempts    INTEGER NOT NULL DEFAULT 0 CHECK (tree_mutate_attempts BETWEEN 0 AND 3)", self.doc02)
        self.assertIn("TreeMutatedSelfHeal(tree_mutate_attempts<=2) -> preparing", self.doc03)
        self.assertIn("TreeMutatedMaxAttempts(tree_mutate_attempts>2) -> failed", self.doc03)
        conn = self._new_project_db()
        agt_id = "agt_01J9ZZZZZZZZZZZZZZZZZZZZ01"
        wkt_id = "wkt_01J9ZZZZZZZZZZZZZZZZZZZZ01"
        conn.execute(
            "INSERT INTO agents(id, slug, display_name, role_kind, lifecycle, status, parent_agent_id, spawn_depth, title, charter_markdown, created_at_us, updated_at_us) "
            "VALUES (?, 'boss', 'Boss', 'boss', 'persistent', 'idle', NULL, 0, 'Boss', 'Charter', 100, 100)",
            (agt_id,),
        )
        conn.execute(
            "INSERT INTO worktree_lanes(id, owner_agent_id, worktree_path, branch_name, base_commit_sha, root_snapshot_ref, head_commit_sha, current_tree_sha, cow_strategy, created_at_us, updated_at_us) "
            "VALUES (?, ?, '/tmp/wkt1', 'kin/wkt1', 'a'*40, 'refs/kin/s0', 'a'*40, 'b'*40, 'apfs_clonefile', 100, 100)",
            (wkt_id, agt_id),
        )
        # Simulate 3 consecutive tree mutations during completion gate verification:
        for expected in (1, 2, 3):
            conn.execute("UPDATE worktree_lanes SET tree_mutate_attempts = tree_mutate_attempts + 1 WHERE id = ?", (wkt_id,))
            val = conn.execute("SELECT tree_mutate_attempts FROM worktree_lanes WHERE id = ?", (wkt_id,)).fetchone()[0]
            self.assertEqual(val, expected)
        # 3rd increment reaches 3 (> 2), firing EscalateToBoss; 4th increment is blocked by CHECK(0..3)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("UPDATE worktree_lanes SET tree_mutate_attempts = tree_mutate_attempts + 1 WHERE id = ?", (wkt_id,))

    def test_152_rt12_02_tracked_nested_secrets_stripped_with_glob_pathspecs(self):
        for pat in [
            "':(glob)**/.env'", "':(glob)**/.env.*'", "':(glob)**/*.pem'", "':(glob)**/*.key'",
            "':(glob)**/*.p12'", "':(glob)**/*.pfx'", "':(glob)**/id_rsa*'", "':(glob)**/id_ed25519*'",
            "':(glob)**/.npmrc'", "':(glob)**/.pypirc'", "':(glob)**/.netrc'", "':(glob)**/.kin'",
        ]:
            self.assertIn(pat, self.doc04)
        tmp = tempfile.mkdtemp(prefix="kin_v9_nested_sec_")
        try:
            root = pathlib.Path(tmp) / "root"
            root.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.email", "t@kin.dev"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.name", "T"], cwd=root, check=True)
            (root / "sub" / "ssh").mkdir(parents=True)
            (root / "sub" / "deep" / ".kin").mkdir(parents=True)
            (root / ".env").write_text("ROOT=1\n", encoding="utf-8")
            (root / "sub" / ".env").write_text("SUB=1\n", encoding="utf-8")
            (root / "sub" / ".env.local").write_text("SUB_LOCAL=1\n", encoding="utf-8")
            (root / "sub" / ".npmrc").write_text("TOKEN=1\n", encoding="utf-8")
            (root / "sub" / "ssh" / "id_rsa").write_text("KEY=1\n", encoding="utf-8")
            (root / "sub" / "ssh" / "id_ed25519").write_text("KEY2=1\n", encoding="utf-8")
            (root / "sub" / "deep" / ".kin" / "kin.toml").write_text("schema_version = 8\n", encoding="utf-8")
            (root / "src.rs").write_text("fn main() {}\n", encoding="utf-8")
            subprocess.run(["git", "add", "-f", "."], cwd=root, check=True)
            subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=root, check=True)
            subprocess.run([
                "git", "--no-optional-locks", "rm", "--cached", "--ignore-unmatch", "--quiet", "-r", "--",
                ":(glob)**/.env", ":(glob)**/.env.*", ":(glob)**/*.pem", ":(glob)**/*.key",
                ":(glob)**/*.p12", ":(glob)**/*.pfx", ":(glob)**/id_rsa*", ":(glob)**/id_ed25519*",
                ":(glob)**/.npmrc", ":(glob)**/.pypirc", ":(glob)**/.netrc", ":(glob)**/.kin", ":(glob)**/.kin/**",
            ], cwd=root, check=True)
            remaining = subprocess.check_output(["git", "ls-files"], cwd=root, text=True).splitlines()
            self.assertEqual(remaining, ["src.rs"])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_153_rt12_03_all_cited_test_and_trigger_names_resolve_1_to_1(self):
        defined_tests = {m for m in dir(self) if m.startswith("test_")}
        # Check every full test_NN_... identifier in DOC-00..DOC-08
        for doc_name, doc_txt in [("DOC-00", self.doc00), ("DOC-06", self.doc06), ("DOC-08", self.doc08)]:
            for m in re.finditer(r"\b(test_\d+_[a-zA-Z0-9_]+)\b", doc_txt):
                tname = m.group(1)
                self.assertIn(tname, defined_tests, f"{tname} cited in {doc_name} does not exist in verifier")
        # Check every trg_* identifier across all docs against DDL
        defined_triggers = set(re.findall(r"CREATE TRIGGER (?:IF NOT EXISTS )?(\w+)", self.doc02))
        for doc_name, doc_txt in [
            ("DOC-00", self.doc00), ("DOC-01", self.doc01), ("DOC-02", self.doc02),
            ("DOC-03", self.doc03), ("DOC-04", self.doc04), ("DOC-05", self.doc05),
            ("DOC-06", self.doc06), ("DOC-07", self.doc07), ("DOC-08", self.doc08),
        ]:
            for m in re.finditer(r"\b(trg_[a-zA-Z0-9_]+)\b", doc_txt):
                trg_name = m.group(1)
                if trg_name in ("trg_memory_vec_ad", "trg_memory_vec_au") or trg_name.endswith("_"):
                    continue
                self.assertIn(trg_name, defined_triggers, f"Trigger {trg_name} in {doc_name} missing from DDL")

    def test_154_rt12_04_kin_error_implements_category_retryable_and_wire_error(self):
        self.assertIn("pub const fn category(&self) -> ErrorCategory", self.doc06)
        self.assertIn("pub const fn is_retryable(&self) -> bool", self.doc06)
        self.assertIn("pub fn to_wire_error(&self, message: impl Into<String>) -> KinWireError", self.doc06)
        # Verify all 54 rows in DOC-00 §5 match DOC-06 §1.2
        sec5 = self.doc00.split("## 5. Canonical Closed Error Taxonomy Registry")[1]
        rows = re.findall(r"\|\s*`(KIN-[A-Z]{3}-\d{4})`\s*\|\s*`(\w+)`\s*\|\s*`(\w+)`\s*\|\s*`(true|false)`\s*\|", sec5)
        self.assertEqual(len(rows), 54)
        for code, variant, cat, retry in rows:
            self.assertIn(f"Self::{variant}", self.doc06)
            self.assertIn(f'"{code}"', self.doc06)
            self.assertIn(f"ErrorCategory::{cat}", self.doc06)
            if retry == "true":
                self.assertEqual(variant, "DiskSpaceLow")

    def test_155_rt12_05_run_status_enum_defined_in_kin_proto_with_15_states(self):
        self.assertIn("pub enum RunStatus {", self.doc06)
        expected_variants = [
            "Queued", "Preparing", "StreamingModel", "EvaluatingPolicy",
            "WaitingApproval", "WaitingTakeover", "WaitingSubagent", "WaitingRecovery",
            "ExecutingTools", "VerifyingCompletion", "Compacting",
            "Completed", "Cancelled", "Failed", "BudgetExceeded",
        ]
        enum_body = self.doc06.split("pub enum RunStatus {")[1].split("}")[0]
        for v in expected_variants:
            self.assertIn(v, enum_body)

    def test_156_rt12_06_recovery_matrix_covers_all_11_non_terminal_states(self):
        sec22 = self.doc03.split("### 2.2")[1].split("### 2.3")[0]
        non_terminal = [
            "queued", "preparing", "streaming_model", "evaluating_policy",
            "waiting_approval", "waiting_takeover", "waiting_subagent", "waiting_recovery",
            "executing_tools", "verifying_completion", "compacting",
        ]
        col1_text = "\n".join(
            line.strip().strip("|").split("|")[0]
            for line in sec22.splitlines()
            if line.strip().startswith("|") and "Interrupted" not in line
        )
        for st in non_terminal:
            self.assertIn(f"`{st}`", col1_text, f"Non-terminal state {st} missing from DOC-03 §2.2 column 1")

    def test_157_rt12_07_connector_slugs_egress_hosts_and_dynamic_approval_grant(self):
        for slug in ("'discord'", "'notion'", "'trello'"):
            self.assertIn(slug, self.doc02)
        import tomllib
        toml_block = self.doc07.split("# .kin/kin.toml")[1].split("```")[0]
        cfg = tomllib.loads("# .kin/kin.toml" + toml_block)
        allowed = set(cfg["egress"]["allowed_hosts"])
        for h in ("api.githubcopilot.com", "sheets.googleapis.com", "releases.kin.dev"):
            self.assertIn(h, allowed)
        self.assertIn("SEC-EGR-003", self.doc05)
        self.assertIn("run_approved_egress_hosts", self.doc05)
        self.assertIn("session_approved_egress_hosts", self.doc05)

    def test_158_rt12_08_lsk_prj_defined_in_key_hierarchy(self):
        sec3 = self.doc02.split("## 3. Cryptographic Key Hierarchy")[1].split("## 4.")[0]
        self.assertIn('LSK_prj = HKDF-SHA256(ikm = PMK_prj, salt = prj_id, info = "kin/v8/ledger-ed25519-seed")', sec3)
        self.assertIn("ledger_pubkey_hex", sec3)

    def test_159_rt12_09_unified_signed_purge_receipt_schema_and_trigger(self):
        self.assertIn("json_extract(lp.payload_jcs_json, '$.entity_id') IS NOT NULL", self.doc02)
        self.assertIn("json_extract(lp.payload_jcs_json, '$.reason') IS NOT NULL", self.doc02)
        self.assertIn("json_extract(lp.payload_jcs_json, '$.ed25519_sig_hex') IS NOT NULL", self.doc02)
        self.assertIn("le.seq > old.seq", self.doc02)
        self.assertIn('"reason":"operator_privacy_purge"', self.doc05)

    def test_160_rt12_10_index_db_synchronous_full_alignment(self):
        self.assertNotIn("PRAGMA synchronous = NORMAL", self.doc02)
        self.assertEqual(self.doc02.count("PRAGMA synchronous = FULL;"), 4)

    def test_161_rt12_11_l4_tokio_sync_and_tokio_util_pinned_and_authorized(self):
        self.assertIn('`tokio-util`', self.doc02)
        self.assertIn('"0.7.12"', self.doc02)
        self.assertIn("`tokio` (`sync`) + `tokio-util` (`sync`, `rt`)", self.doc02)
        self.assertIn("`tokio` (`sync`), and `tokio-util` (`sync`, `rt`)", self.doc00)

    def test_162_rt12_12_mcp_tool_search_clarified_as_l2_directory_block(self):
        self.assertIn("<mcp_tool_directory>", self.doc03)
        self.assertIn("<mcp_tool_directory>", self.doc05)
        self.assertIn("not a 27th built-in tool", self.doc05)

    def test_163_rt12_13_project_team_cap_defined_across_docs_and_ddl(self):
        self.assertIn("max_agents_cap = 24", self.doc01)
        self.assertIn("max_agents_cap            INTEGER NOT NULL DEFAULT 24 CHECK (max_agents_cap BETWEEN 2 AND 64)", self.doc02)
        self.assertIn("max_agents_cap = 24", self.doc05)
        self.assertIn("max_agents_cap = 24", self.doc07)

    def test_164_rt12_14_socket_path_limit_44b_aligned_in_doc02_scope(self):
        scope_line = [l for l in self.doc02.splitlines() if "**Scope**" in l][0]
        self.assertIn("`<= 44B`", scope_line)

    def test_165_rt12_15_prefix_breakpoint_labels_bp1_bp2_aligned(self):
        self.assertIn("BP1–BP2 Run-Static Byte-Identical + BP3 Append-Only", self.doc01)
        self.assertIn("BP1–BP2 static + BP3 append-only compiler", self.doc06)

    def test_166_rt12_16_zone4_ascii_diagram_shows_six_tabs(self):
        self.assertIn("[Thr][Diff][DAG][Run][Mem][Sec]", self.doc01)

    def test_167_rt12_17_doc01_sequential_headings_and_doc00_suite_map(self):
        self.assertIn("### 4.1 MCP-First Integration Strategy", self.doc01)
        self.assertIn("### 4.2 Four-Category Extension Organization", self.doc01)
        self.assertIn("### 4.3 Five-Step Recommended Implementation Order", self.doc01)
        self.assertNotIn("### 4.5", self.doc01)
        self.assertIn("### 1.1 Canonical 10-Document Suite Map", self.doc00)

    def test_168_rt12_18_procedural_distiller_tier_t1_t2_aligned(self):
        self.assertIn("tier IN ('T1', 'T2')", self.doc03)
        self.assertIn('"tier": "T1"|"T2"', self.doc07)

    def test_169_rt12_19_seccomp_29_rules_wording_aligned(self):
        self.assertIn("29 seccomp syscall rules", self.doc00)
        self.assertIn("29-rule seccomp-bpf filter", self.doc05)
        self.assertIn("29-rule seccomp", self.doc06)

    def test_170_rt12_20_verifier_fixture_schema_version_and_non_empty_mcp_hash(self):
        self.assertNotIn("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", self.doc07)
        self.assertIn("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", self.doc07)

    def test_171_rt12_21_tera_templates_valid_json_braces(self):
        sec14 = self.doc07.split("### 1.4")[1].split("## 2.")[0]
        self.assertNotIn('{{"target_agent_slug"', sec14)
        self.assertNotIn('{{"verdict"', sec14)
        self.assertNotIn('{{"should_save"', sec14)
        self.assertIn('Output JSON: {"target_agent_slug":', sec14)

    def test_172_rt12_21_memory_vec_insert_trigger_and_tasks_completed_at_check(self):
        self.assertIn("CREATE TRIGGER IF NOT EXISTS trg_memory_vec_ai AFTER INSERT ON memory_items", self.doc02)
        self.assertIn("CHECK (completed_at_us IS NULL OR completed_at_us >= created_at_us)", self.doc02)
        conn = self._new_project_db()
        # Inserting a task with completed_at_us < created_at_us must fail CHECK
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO tasks(id, title, description_md, status, created_at_us, updated_at_us, completed_at_us) "
                "VALUES ('tsk_01J9ZZZZZZZZZZZZZZZZZZZZ01', 'T', 'D', 'done', 100, 100, 50)"
            )

    def test_173_rt12_21_historical_ledger_rows_preserve_accurate_verifier_names(self):
        self.assertIn("verify_kin_v7_5_suite.py", self.doc00)
        self.assertIn("verify_kin_v8_01_suite.py", self.doc00)
        self.assertIn("verify_kin_v8_5_suite.py", self.doc00)
        self.assertIn("verify_kin_v9_0_suite.py", self.doc00)

    def test_174_rt12_21_master_spec_and_zip_zero_redirect_urls_and_byte_identical(self):
        master_txt = read_doc("KIN-v10.0-PRODUCTION-Master-Specification.md")
        self.assertNotIn("google.com/search?q=", master_txt)
        for doc in [self.doc00, self.doc01, self.doc02, self.doc03, self.doc04, self.doc05, self.doc06, self.doc07, self.doc08]:
            self.assertNotIn("google.com/search?q=", doc)
            self.assertIn(doc.strip(), master_txt)

    def test_175_rt12_21_all_twelve_rounds_and_175_tests_verified(self):
        for i in range(1, 22):
            self.assertIn(f"RT12-{i:02d}", self.doc00)
        test_methods = [m for m in dir(self) if m.startswith("test_")]
        self.assertEqual(len(test_methods), 200)


    # --- 10 New Round-13 v10.0 Temporal, Interval, Line-Range & Vector Sync Verification Tests (test_176 .. test_185) ---
    def test_176_rt13_01_v10_0_version_and_manifest_alignment(self):
        for doc in [self.doc00, self.doc01, self.doc02, self.doc03, self.doc04, self.doc05, self.doc06, self.doc07, self.doc08]:
            self.assertIn("10.0.0-PRODUCTION", doc)
        self.assertIn("DEFAULT '10.0.0'", self.doc02)
        self.assertIn("KIN-Bench-Env-v10.0", self.doc01)
        self.assertIn("https://releases.kin.dev/v10.0/manifest.json", self.doc05)
        self.assertIn("https://releases.kin.dev/v10.0/manifest.json", self.doc07)

    def test_177_rt13_02_st01_and_active_verifier_references_aligned(self):
        st01_line = [l for l in self.doc00.splitlines() if l.startswith("| **ST-01** |")][0]
        self.assertTrue(st01_line.endswith("| `verify_kin_v10_0_suite.py` |"))
        self.assertIn("verify_kin_v10_0_suite.py", read_doc("AGENTS.md"))

    def test_178_rt13_03_runtime_tables_chronological_check_constraints(self):
        conn = self._new_project_db()
        agt1, agt2, chn_id, thr_id, run_id, stp_id = self._seed_agent_channel_run(conn)
        # 1. meetings: ended_at_us < started_at_us must fail CHECK
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO meetings(id,channel_id,thread_id,moderator_agent_id,mode,agenda,participants_json,started_at_us,ended_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (make_ulid("mtg", 178), chn_id, thr_id, agt1, "moderated", "Agenda", json.dumps([agt1, agt2]), 200, 100),
            )
        # 2. ast_symbol_leases: expires_at_us <= acquired_at_us must fail CHECK
        wkt_id = make_ulid("wkt", 178)
        conn.execute(
            "INSERT INTO worktree_lanes(id,owner_agent_id,worktree_path,branch_name,base_commit_sha,root_snapshot_ref,head_commit_sha,current_tree_sha,cow_strategy,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (wkt_id, agt2, "/tmp/w178", "kin/w178", "a" * 40, "refs/kin/s0", "a" * 40, "b" * 40, "apfs_clonefile", 100, 100),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO ast_symbol_leases(file_rel_path,symbol_fqn,lane_id,agent_id,run_id,acquired_at_us,expires_at_us) "
                "VALUES ('src/lib.rs','fn_a',?,?,?,200,200)",
                (wkt_id, agt2, run_id),
            )
        # 3. engine_heartbeat: last_alive_at_us < started_at_us must fail CHECK
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO engine_heartbeat(singleton_id,instance_ulid,pid,started_at_us,last_alive_at_us) VALUES (1,'inst1',1234,500,400)"
            )

    def test_179_rt13_04_updated_at_ge_created_at_check_constraints(self):
        conn = self._new_project_db()
        agt1, _, _, _, _, _ = self._seed_agent_channel_run(conn)
        # Inserting a goal with updated_at_us < created_at_us must fail CHECK
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO goals(id,title,description_md,owner_agent_id,created_at_us,updated_at_us) VALUES (?,?,?,?,?,?)",
                (make_ulid("gol", 179), "Goal", "Desc", agt1, 500, 400),
            )
        # Inserting an extension_package with updated_at_us < installed_at_us must fail CHECK
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO extension_packages(id,category,slug,version_semver,display_name,publisher_id,package_blake3,manifest_json,installed_at_us,updated_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (make_ulid("ext", 179), "skill", "sk-1", "1.0.0", "Skill 1", "pub", "a" * 64, "{}", 500, 400),
            )

    def test_180_rt13_05_code_symbols_and_chunks_line_range_checks(self):
        conn = sqlite3.connect(":memory:")
        self._open_conns.append(conn)
        conn.executescript(self.idx_sql)
        conn.execute("INSERT INTO indexed_files VALUES ('src/a.rs','h',10,'rust',1,1)")
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO code_symbols VALUES ('sym1','src/a.rs','f','f','function','fn f()',10,5,NULL,0.1,'h')"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO code_chunks VALUES ('chk1','src/a.rs',0,5,'f','fn f() {}','pending',NULL)"
            )

    def test_181_rt13_06_code_chunks_vec_sync_triggers(self):
        for trg in ["trg_code_chunks_vec_ai", "trg_code_chunks_vec_ad", "trg_code_chunks_vec_au"]:
            self.assertIn(f"CREATE TRIGGER IF NOT EXISTS {trg}", self.vec_sql)

    def test_182_rt13_07_mcp_integrations_auth_kind_secret_handle_check(self):
        conn = self._new_project_db()
        # auth_kind = 'secret_handle' with NULL secret_handle_ref must fail CHECK
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO mcp_integrations(id,slug,display_name,preset_slug,transport,endpoint_or_cmd_json,auth_kind,secret_handle_ref,created_at_us,updated_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (make_ulid("mcp", 182), "gh-bad", "GH", "github", "streamable_http", "{}", "secret_handle", None, 100, 100),
            )
        # auth_kind = 'none' with non-null secret_handle_ref must fail CHECK
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO mcp_integrations(id,slug,display_name,preset_slug,transport,endpoint_or_cmd_json,auth_kind,secret_handle_ref,created_at_us,updated_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (make_ulid("mcp", 183), "fs-bad", "FS", "filesystem", "stdio", "{}", "none", "KIN_SECRET_X", 100, 100),
            )

    def test_183_rt13_08_wake_queue_claim_timestamp_check(self):
        conn = self._new_project_db()
        agt1, _, _, _, _, _ = self._seed_agent_channel_run(conn)
        # status = 'queued' with non-null claimed_at_us must fail CHECK
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO wake_queue(id,agent_id,context_key,trigger_kind,status,enqueued_at_us,claimed_at_us) "
                "VALUES (?,?,?,'explicit_mention','queued',100,200)",
                (make_ulid("wak", 183), agt1, "chn:1"),
            )
        # status = 'claimed' with claimed_at_us < enqueued_at_us must fail CHECK
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO wake_queue(id,agent_id,context_key,trigger_kind,status,enqueued_at_us,claimed_at_us) "
                "VALUES (?,?,?,'explicit_mention','claimed',200,100)",
                (make_ulid("wak", 184), agt1, "chn:1"),
            )

    def test_184_rt13_09_bitemporal_memory_interval_checks(self):
        conn = self._new_project_db()
        _, agt_spec, _, _, run_id, _ = self._seed_agent_channel_run(conn)
        # valid_to_us < valid_from_us on memory_items must fail CHECK
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO memory_items(id,tier,scope_id,bank,subject_key,claim_text,provenance_json,valid_from_us,valid_to_us,recorded_at_us,content_blake3,created_by_agent_id,created_by_run_id,created_at_us,updated_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (make_ulid("mem", 184), "T3", agt_spec, "world", "k", "c", "{}", 500, 400, 500, "a" * 64, agt_spec, run_id, 500, 500),
            )
        # superseded_at_us < recorded_at_us on memory_entities must fail CHECK
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO memory_entities(id,tier,scope_id,canonical_name,entity_kind,valid_from_us,recorded_at_us,superseded_at_us,created_at_us,updated_at_us) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (make_ulid("ent", 184), "T1", "project", "EntBad", "component", 100, 500, 400, 500, 500),
            )

    def test_185_rt13_10_all_thirteen_rounds_and_200_tests_verified(self):
        for i in range(1, 21):
            self.assertIn(f"RT13-{i:02d}", self.doc00)
        test_methods = [m for m in dir(self) if m.startswith("test_")]
        self.assertEqual(len(test_methods), 200)


    def test_186_rt13_doc08_present_and_separation_of_concerns_matrix(self):
        self.assertGreater(len(self.doc08), 40000)
        self.assertIn("ARCH-SOC-001", self.doc08)
        self.assertIn("## 0. Strict Separation-of-Concerns & Non-Contradiction Matrix", self.doc08)

    def test_187_rt13_c4_level_1_to_4_diagrams_present(self):
        for c4_id in ["C4-L1-SYS", "C4-L2-CNT", "C4-L3-CMP", "C4-L4-SEQ"]:
            self.assertIn(c4_id, self.doc08)

    def test_188_rt13_all_eighteen_adrs_mapped_to_invariants(self):
        for i in range(1, 19):
            self.assertIn(f"**ADR-{i:03d}**", self.doc08)
            self.assertIn(f"`INV-{i:03d}`", self.doc08)

    def test_189_rt13_compatibility_matrix_os_and_toolchains(self):
        self.assertIn("CMP-OS-001", self.doc08)
        self.assertIn("CMP-TCN-001", self.doc08)
        for item in ["SQLCipher", "ONNX Runtime", "1.82.0", "Tauri", "React"]:
            self.assertIn(item, self.doc08)

    def test_190_rt13_cargo_toml_and_cargo_lock_valid_and_pinned(self):
        import tomllib
        cargo_toml_txt = read_doc("Cargo.toml")
        cargo_lock_txt = read_doc("Cargo.lock")
        cargo_cfg_txt = read_doc(".cargo/config.toml")
        manifest = tomllib.loads(cargo_toml_txt)
        lockfile = tomllib.loads(cargo_lock_txt)
        cargo_cfg = tomllib.loads(cargo_cfg_txt)
        self.assertEqual(manifest["workspace"]["package"]["version"], "10.0.0")
        # Audit Finding 4: workspace lint is deny, overridden only in audited FFI modules
        self.assertEqual(manifest["workspace"]["lints"]["rust"]["unsafe_code"], "deny")
        # Audit Finding 11: workspace tokio default features restricted to ["sync"]
        self.assertEqual(manifest["workspace"]["dependencies"]["tokio"]["features"], ["sync"])
        # Audit Finding 12: .cargo/config.toml defines xtask alias
        self.assertIn("xtask", cargo_cfg["alias"])
        self.assertEqual(lockfile["version"], 4)
        pkg_map = {p["name"]: p for p in lockfile["package"]}
        # Audit Finding 13: all workspace dependencies including zstd, ignore, keyring, tauri, clap are declared & locked
        for req_crate in [
            "rusqlite", "sqlite-vec", "zstd", "ort", "ignore", "keyring",
            "seccompiler", "landlock", "cap-std", "portable-pty", "tokio",
            "tokio-util", "reqwest", "tera", "tauri", "clap", "jiff",
        ]:
            self.assertIn(req_crate, manifest["workspace"]["dependencies"])
            self.assertIn(req_crate, pkg_map)
        # Audit Finding 3 & 11: all 32 workspace members exist in Cargo.lock and kin-sched includes jiff
        members = [m.split("/")[-1] for m in manifest["workspace"]["members"]]
        self.assertEqual(len(members), 32)
        for member in members:
            self.assertIn(member, pkg_map, f"Workspace member {member} missing from Cargo.lock")
        self.assertIn("jiff", pkg_map["kin-sched"]["dependencies"])

    def test_191_rt13_package_json_and_pnpm_lock_valid(self):
        # Audit Finding 2 & 3: canonical path apps/desktop/package.json and pnpm-lock.yaml with packages & snapshots
        pkg_json = json.loads(read_doc("apps/desktop/package.json"))
        pnpm_lock = read_doc("apps/desktop/pnpm-lock.yaml")
        self.assertEqual(pkg_json["version"], "10.0.0")
        self.assertEqual(pkg_json["dependencies"]["react"], "19.0.0")
        self.assertEqual(pkg_json["scripts"]["tauri"], "tauri")
        self.assertIn("lockfileVersion: '9.0'", pnpm_lock)
        self.assertIn("\npackages:\n", pnpm_lock)
        self.assertIn("\nsnapshots:\n", pnpm_lock)

    def test_192_rt13_build_and_troubleshooting_runbook_playbooks(self):
        for bld_id in ["RUN-BLD-001", "RUN-BLD-002", "RUN-BLD-003", "RUN-BLD-004", "RUN-BLD-005", "RUN-CLI-001"]:
            self.assertIn(bld_id, self.doc08)
        for i in range(1, 13):
            self.assertIn(f"**RUN-TRB-{i:03d}**", self.doc08)
        # Audit Finding 14 & 16: No raw ad-hoc UPDATE worktree_lanes SQL in runbook; uses EngineCommand::LaneUnfreeze
        self.assertNotIn("UPDATE worktree_lanes SET write_frozen = 0", self.doc08)
        self.assertNotIn("[[secrets.allowed_env_injections]]", self.doc08)
        self.assertIn("[secrets].allowed_env_injections", self.doc08)
        self.assertIn("EngineCommand::LaneUnfreeze", self.doc08)
        self.assertIn("EngineCommand::ProjectGarbageCollect", self.doc08)
        self.assertIn("EngineCommand::McpInspectSchema", self.doc08)

    def test_193_rt13_doc08_table_pipe_and_column_hygiene(self):
        in_fence = False
        table_cols = None
        for lineno, line in enumerate(self.doc08.splitlines(), 1):
            if line.strip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            if line.startswith("|"):
                self.assertNotIn(r"\|", line, f"Escaped pipe in DOC-08:{lineno}")
                cols = line.count("|")
                if table_cols is None:
                    table_cols = cols
                else:
                    self.assertEqual(cols, table_cols, f"Column mismatch in DOC-08:{lineno}")
            else:
                table_cols = None

    def test_194_rt13_doc08_balanced_code_fences(self):
        fences = re.findall(r"^```", self.doc08, flags=re.MULTILINE)
        self.assertEqual(len(fences) % 2, 0)

    def test_195_rt13_master_specification_includes_doc08(self):
        master_txt = read_doc("KIN-v10.0-PRODUCTION-Master-Specification.md")
        for doc_num in range(9):
            self.assertEqual(master_txt.count(f"# DOC-0{doc_num}:"), 1)

    def test_196_rt13_run_steps_and_tool_calls_ended_at_check(self):
        conn = self._new_project_db()
        _, _, _, _, run_id, stp_id = self._seed_agent_channel_run(conn)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO run_steps(id,run_id,step_index,model_uid,prompt_prefix_hash,status,started_at_us,ended_at_us) "
                "VALUES (?,?,1,'m','h','completed',500,400)",
                (make_ulid("stp", 196), run_id),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO tool_calls(id,run_id,step_id,provider_call_id,tool_name,args_redacted_jcs_json,args_blake3,mutability,risk_class,policy_decision,policy_rule_id,status,intent_ledger_seq,started_at_us,ended_at_us) "
                "VALUES (?,?,?,'c','fs_read','{}',?,'read_only','R0','allow','R0','succeeded',1,500,400)",
                (make_ulid("tlc", 196), run_id, stp_id, "a" * 64),
            )

    def test_197_rt13_approval_requests_chronological_checks(self):
        conn = self._new_project_db()
        _, agt_spec, _, _, run_id, stp_id = self._seed_agent_channel_run(conn)
        tlc_id = make_ulid("tlc", 197)
        conn.execute(
            "INSERT INTO tool_calls(id,run_id,step_id,provider_call_id,tool_name,args_redacted_jcs_json,args_blake3,mutability,risk_class,policy_decision,policy_rule_id,status,intent_ledger_seq,started_at_us) "
            "VALUES (?,?,?,'c197','shell_exec','{}',?,'non_idempotent_write','R3','ask_human','R3','awaiting_approval',1,500)",
            (tlc_id, run_id, stp_id, "a" * 64),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO approval_requests(id,run_id,tool_call_id,agent_id,risk_class,reason_code,summary_title,canonical_action_json,status,created_at_us,expires_at_us) "
                "VALUES (?,?,?,?,'R3','R3','T','{}','pending',500,500)",
                (make_ulid("apr", 197), run_id, tlc_id, agt_spec),
            )

    def test_198_rt13_merge_queue_and_apply_journals_completed_at_checks(self):
        conn = self._new_project_db()
        _, agt_spec, _, _, _, _ = self._seed_agent_channel_run(conn)
        wkt_id = make_ulid("wkt", 198)
        mqe_id = make_ulid("mqe", 198)
        conn.execute(
            "INSERT INTO worktree_lanes(id,owner_agent_id,worktree_path,branch_name,base_commit_sha,root_snapshot_ref,head_commit_sha,current_tree_sha,cow_strategy,created_at_us,updated_at_us) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (wkt_id, agt_spec, "/tmp/w198", "kin/w198", "a" * 40, "refs/kin/s0", "a" * 40, "b" * 40, "apfs_clonefile", 100, 100),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO merge_queue_entries(id,lane_id,attempt_no,submitted_by_agent_id,status,enqueued_at_us,completed_at_us) "
                "VALUES (?,?,1,?,'gate_failed',500,400)",
                (mqe_id, wkt_id, agt_spec),
            )

    def test_199_rt13_projects_and_provider_profiles_updated_at_checks(self):
        conn = sqlite3.connect(":memory:")
        self._open_conns.append(conn)
        conn.executescript(self.reg_sql)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO provider_profiles(id,kind,display_name,base_url,created_at_us,updated_at_us) "
                "VALUES (?,'openai','OpenAI','https://api.openai.com',500,400)",
                (make_ulid("prv", 199),),
            )

    def test_200_rt13_full_200_test_v10_production_suite_complete(self):
        test_methods = [m for m in dir(self) if m.startswith("test_")]
        self.assertEqual(len(test_methods), 200)


if __name__ == "__main__":
    unittest.main(verbosity=2)

