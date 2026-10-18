from __future__ import annotations
import os
from pathlib import Path
import webview
from lluminous_quill.bridge import AppBridge

ROOT = Path(__file__).resolve().parent

def main() -> None:
    data_dir = Path(os.environ.get("LLQUILL_DATA_DIR", ROOT)).expanduser().resolve()
    webview.create_window("LLuminous Quill", (ROOT / "web" / "index.html").as_uri(),
                          js_api=AppBridge(data_dir), width=1360, height=900,
                          min_size=(940, 640), background_color="#111111")
    webview.start(debug=os.environ.get("LLQUILL_DEBUG") == "1")

if __name__ == "__main__":
    main()
