import sys
from pathlib import Path

# Allow `import backend.x` when running pytest from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
