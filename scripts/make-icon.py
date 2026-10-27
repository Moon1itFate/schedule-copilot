"""Compatibility entry point. The editable SVG master is public/app-icon.svg."""
from pathlib import Path
import subprocess
subprocess.run(["node", str(Path(__file__).with_suffix(".mjs"))], check=True)
