"""HTTP transport and legacy route adapter, without application startup side effects."""
import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
from .routes.registry import dispatch
from ..application.scheduling_error import SchedulingError
from ..application.manual_task_entry import ManualTaskEntryRequired


@dataclass(frozen=True)
class HTTPRuntime:
    application: Callable
    encode: Callable
    health: Callable
    test_mode: bool
    qa_mode: bool
    test_clock_state: Callable
    update_test_clock: Callable
    qa_scenario_manifest: Callable
    restore_qa_scenario: Callable
    make_id: Callable


class HumanOSHTTPHandler(BaseHTTPRequestHandler):
    server_version = "HumanOSBackend/0.1"

    def runtime(self) -> HTTPRuntime:
        """Supplied by the composition root; no global application lookup."""
        raise NotImplementedError

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self) -> None:
        self.route()

    def do_POST(self) -> None:
        self.route()

    def do_PUT(self) -> None:
        self.route()

    def do_PATCH(self) -> None:
        self.route()

    def do_DELETE(self) -> None:
        self.route()

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, data: object, status: int = 200) -> None:
        raw = self.runtime().encode(data).encode("utf-8")
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw) if raw else {}

    def route(self) -> None:
        runtime = self.runtime()
        store = runtime.application()
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query)
        method = self.command
        try:
            if dispatch(self, store, runtime, method, path, query):
                return

            self.send_json({"error": "not_found", "path": path}, status=404)
        except KeyError as exc:
            self.send_json({"error": "not_found", "id": str(exc)}, status=404)
        except PermissionError as exc:
            self.send_json({"error": "unauthorized", "message": str(exc)}, status=401)
        except ManualTaskEntryRequired as exc:
            self.send_json({"error": "manual_task_entry_required", "message": str(exc)}, status=410)
        except SchedulingError as exc:
            self.send_json(exc.payload(), status=400)
        except ValueError as exc:
            self.send_json({"error": "bad_request", "message": str(exc)}, status=400)
        except sqlite3.IntegrityError:
            self.send_json({"error": "conflict", "message": "email already registered"}, status=409)
        except Exception as exc:
            self.send_json({"error": type(exc).__name__, "message": str(exc)}, status=500)
