import os
import logging
import certifi
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent
INPUT_DIR = BASE_DIR / "audio_segments"

# Output: use env var if set (packaged app writes here), else default
_output_env = os.environ.get("RADIO_OUTPUT_DIR")
OUTPUT_DIR = Path(_output_env) if _output_env else BASE_DIR / "output"

# Log file alongside output
LOG_FILE = OUTPUT_DIR / "debug.log"

# Dependency Configuration: Add local bin to PATH for ffmpeg
os.environ["PATH"] += os.pathsep + str(BASE_DIR / "bin")

# SSL Configuration (Fix for macOS Python)
os.environ['SSL_CERT_FILE'] = certifi.where()

# API Keys
AUDD_API_TOKEN = os.getenv("AUDD_API_TOKEN")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Processing Settings
CHUNK_DURATION_SEC = 20  # Duration of chunks to send to AudD
CHUNK_OVERLAP_SEC = 0    # Overlap between chunks (if needed)
ACCEPTED_FORMATS = ('.wav', '.mp3', '.aiff', '.m4a')
AUDD_API_URL = "https://api.audd.io/"

# Logging Configuration
def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(LOG_FILE),
            logging.StreamHandler()
        ]
    )
    logging.info("Logging initialized.")

# Verification
if not AUDD_API_TOKEN:
    print("WARNING: AUDD_API_TOKEN not found in .env file. Fingerprinting will fail (Unless using Shazam).")
