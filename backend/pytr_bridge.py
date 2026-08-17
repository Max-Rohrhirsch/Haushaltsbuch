"""Bridge between the finance backend and the pytr library.

Speaks a tiny line protocol on stdin/stdout so the Node backend can drive the
interactive Trade Republic login (phone number -> PIN -> code from the app)
without simulating a terminal. Protocol lines are prefixed with a marker
because pytr logs freely to stdout.

    stdin  <- {"phone": "+49...", "pin": "1234"}
    stdout -> @@PYTR@@{"event": "need_code", "countdown": 60}
    stdin  <- {"code": "1234"}
    stdout -> @@PYTR@@{"event": "done", "csv": "..."}
"""

import asyncio
import inspect
import io
import json
import sys
import tempfile
from pathlib import Path

MARKER = "@@PYTR@@"


def emit(payload):
    sys.stdout.write(MARKER + json.dumps(payload) + "\n")
    sys.stdout.flush()


def read_message():
    line = sys.stdin.readline()
    if not line:
        sys.exit(0)
    return json.loads(line)


def build_api(phone, pin):
    """Try the WAF token strategies in order of least setup required."""
    from pytr.api import TradeRepublicApi

    if "waf_token" not in inspect.signature(TradeRepublicApi.__init__).parameters:
        raise RuntimeError("Die installierte pytr-Version ist zu alt. Bitte 'pip install -U pytr' ausführen.")

    failures = []
    for waf_token in ("awswaf", "playwright", None):
        api = TradeRepublicApi(phone_no=phone, pin=pin, save_cookies=False, waf_token=waf_token)
        try:
            return api, api.initiate_weblogin()
        except Exception as error:  # noqa: BLE001 - any failure means: try the next strategy
            failures.append(f"{waf_token or 'ohne WAF-Token'}: {error}")
    raise RuntimeError(" | ".join(failures))


def export_csv(api):
    from pytr.event import Event
    from pytr.timeline import Timeline
    from pytr.transactions import TransactionExporter

    output_path = Path(tempfile.mkdtemp(prefix="pytr-bridge-"))
    timeline = Timeline(api, output_path, float(0), float("inf"), False, False, False)
    asyncio.run(timeline.tl_loop())

    try:
        exporter = TransactionExporter(lang="en", date_with_time=False)
    except TypeError:
        exporter = TransactionExporter(lang="en")
    buffer = io.StringIO()
    exporter.export(buffer, [Event.from_dict(item) for item in timeline.events], sort=True, format="csv")
    return buffer.getvalue()


def main():
    request = read_message()
    phone = (request.get("phone") or "").strip()
    pin = (request.get("pin") or "").strip()
    if not phone or not pin:
        emit({"event": "error", "message": "Telefonnummer und PIN werden benötigt."})
        return

    try:
        api, countdown = build_api(phone, pin)
    except ImportError:
        emit({"event": "error", "message": "pytr ist in dieser Python-Umgebung nicht installiert (pip install pytr)."})
        return
    except Exception as error:  # noqa: BLE001 - reported to the UI
        emit({"event": "error", "message": f"Login fehlgeschlagen: {error}"})
        return

    emit({"event": "need_code", "countdown": countdown})

    code = (read_message().get("code") or "").strip()
    try:
        api.complete_weblogin(code)
    except Exception as error:  # noqa: BLE001 - reported to the UI
        emit({"event": "error", "message": f"Code wurde abgelehnt: {error}"})
        return

    emit({"event": "progress", "message": "Angemeldet. Lade Transaktionen ..."})
    try:
        emit({"event": "done", "csv": export_csv(api)})
    except Exception as error:  # noqa: BLE001 - reported to the UI
        emit({"event": "error", "message": f"Export fehlgeschlagen: {error}"})


if __name__ == "__main__":
    main()
