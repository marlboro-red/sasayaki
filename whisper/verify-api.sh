#!/usr/bin/env bash
# verify-api.sh — Verifies the whisper-server API contract for Sasayaki
#
# Usage:
#   ./whisper/verify-api.sh [--port 8787] [--wav /path/to/test.wav] [--webm /path/to/test.webm]
#
# Prerequisites:
#   - whisper-server running with --convert flag on the specified port
#   - ffmpeg on PATH (for WebM test)
#   - curl on PATH

set -euo pipefail

PORT="${PORT:-8787}"
HOST="${HOST:-127.0.0.1}"
WAV_FILE=""
WEBM_FILE=""
PASS=0
FAIL=0

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --wav)  WAV_FILE="$2"; shift 2 ;;
    --webm) WEBM_FILE="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

BASE_URL="http://${HOST}:${PORT}"

green() { printf '\033[32m✓ %s\033[0m\n' "$1"; }
red()   { printf '\033[31m✗ %s\033[0m\n' "$1"; }
info()  { printf '\033[33m→ %s\033[0m\n' "$1"; }

pass() { green "$1"; ((PASS++)); }
fail() { red "$1";   ((FAIL++)); }

# ─────────────────────────────────────────────────────────────────
# 1. Health check — expect 200 {"status":"ok"}
# ─────────────────────────────────────────────────────────────────
info "Test 1: GET /health"
HEALTH_HTTP=$(curl -s -o /tmp/whisper-health.json -w "%{http_code}" --max-time 5 "$BASE_URL/health" 2>/dev/null || echo "000")
HEALTH_BODY=$(cat /tmp/whisper-health.json 2>/dev/null || echo "")

if [[ "$HEALTH_HTTP" == "200" ]]; then
  STATUS=$(echo "$HEALTH_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
  if [[ "$STATUS" == "ok" ]]; then
    pass "GET /health → 200 {\"status\":\"ok\"}"
  else
    fail "GET /health → 200 but body was: $HEALTH_BODY (expected {\"status\":\"ok\"})"
  fi
elif [[ "$HEALTH_HTTP" == "503" ]]; then
  fail "GET /health → 503 (model still loading — wait and retry)"
elif [[ "$HEALTH_HTTP" == "000" ]]; then
  fail "GET /health → connection refused (is whisper-server running on $BASE_URL?)"
else
  fail "GET /health → unexpected HTTP $HEALTH_HTTP: $HEALTH_BODY"
fi

# ─────────────────────────────────────────────────────────────────
# 2. WAV transcription
# ─────────────────────────────────────────────────────────────────
info "Test 2: POST /inference with WAV"
if [[ -z "$WAV_FILE" ]]; then
  info "  SKIPPED — no --wav file provided"
elif [[ ! -f "$WAV_FILE" ]]; then
  fail "WAV file not found: $WAV_FILE"
else
  WAV_HTTP=$(curl -s -o /tmp/whisper-wav.json -w "%{http_code}" --max-time 30 \
    -F "file=@${WAV_FILE}" \
    -F "response_format=json" \
    "$BASE_URL/inference" 2>/dev/null || echo "000")
  WAV_BODY=$(cat /tmp/whisper-wav.json 2>/dev/null || echo "")
  if [[ "$WAV_HTTP" == "200" ]]; then
    TEXT=$(echo "$WAV_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('text','MISSING'))" 2>/dev/null || echo "PARSE_ERROR")
    if [[ "$TEXT" != "MISSING" && "$TEXT" != "PARSE_ERROR" ]]; then
      pass "POST /inference (WAV) → 200 {\"text\": \"${TEXT:0:60}...\"}"
    else
      fail "POST /inference (WAV) → 200 but unexpected body: $WAV_BODY"
    fi
  else
    fail "POST /inference (WAV) → HTTP $WAV_HTTP: $WAV_BODY"
  fi
fi

# ─────────────────────────────────────────────────────────────────
# 3. WebM transcription (requires --convert + ffmpeg)
# ─────────────────────────────────────────────────────────────────
info "Test 3: POST /inference with WebM (requires --convert)"
if [[ -z "$WEBM_FILE" ]]; then
  info "  SKIPPED — no --webm file provided"
elif [[ ! -f "$WEBM_FILE" ]]; then
  fail "WebM file not found: $WEBM_FILE"
elif ! command -v ffmpeg &>/dev/null; then
  fail "ffmpeg not found on PATH — install with: brew install ffmpeg"
else
  WEBM_HTTP=$(curl -s -o /tmp/whisper-webm.json -w "%{http_code}" --max-time 30 \
    -F "file=@${WEBM_FILE}" \
    -F "response_format=json" \
    "$BASE_URL/inference" 2>/dev/null || echo "000")
  WEBM_BODY=$(cat /tmp/whisper-webm.json 2>/dev/null || echo "")
  if [[ "$WEBM_HTTP" == "200" ]]; then
    TEXT=$(echo "$WEBM_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('text','MISSING'))" 2>/dev/null || echo "PARSE_ERROR")
    if [[ "$TEXT" != "MISSING" && "$TEXT" != "PARSE_ERROR" ]]; then
      pass "POST /inference (WebM) → 200 {\"text\": \"${TEXT:0:60}...\"}"
    else
      fail "POST /inference (WebM) → 200 but unexpected body: $WEBM_BODY"
    fi
  else
    fail "POST /inference (WebM) → HTTP $WEBM_HTTP: $WEBM_BODY"
  fi
fi

# ─────────────────────────────────────────────────────────────────
# 4. language=auto parameter
# ─────────────────────────────────────────────────────────────────
info "Test 4: POST /inference with language=auto"
if [[ -z "$WAV_FILE" && -z "$WEBM_FILE" ]]; then
  info "  SKIPPED — no audio file provided"
else
  AUDIO_FILE="${WAV_FILE:-$WEBM_FILE}"
  LANG_HTTP=$(curl -s -o /tmp/whisper-lang.json -w "%{http_code}" --max-time 30 \
    -F "file=@${AUDIO_FILE}" \
    -F "response_format=json" \
    -F "language=auto" \
    "$BASE_URL/inference" 2>/dev/null || echo "000")
  LANG_BODY=$(cat /tmp/whisper-lang.json 2>/dev/null || echo "")
  if [[ "$LANG_HTTP" == "200" ]]; then
    TEXT=$(echo "$LANG_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('text','MISSING'))" 2>/dev/null || echo "PARSE_ERROR")
    if [[ "$TEXT" != "MISSING" && "$TEXT" != "PARSE_ERROR" ]]; then
      pass "POST /inference (language=auto) → 200 {\"text\": \"${TEXT:0:60}...\"}"
    else
      fail "POST /inference (language=auto) → 200 but unexpected body: $LANG_BODY"
    fi
  else
    fail "POST /inference (language=auto) → HTTP $LANG_HTTP: $LANG_BODY"
  fi
fi

# ─────────────────────────────────────────────────────────────────
# 5. response_format=json shape
# ─────────────────────────────────────────────────────────────────
info "Test 5: response_format=json shape validation"
if [[ -z "$WAV_FILE" && -z "$WEBM_FILE" ]]; then
  info "  SKIPPED — no audio file provided"
else
  AUDIO_FILE="${WAV_FILE:-$WEBM_FILE}"
  JSON_HTTP=$(curl -s -o /tmp/whisper-json.json -w "%{http_code}" --max-time 30 \
    -F "file=@${AUDIO_FILE}" \
    -F "response_format=json" \
    "$BASE_URL/inference" 2>/dev/null || echo "000")
  JSON_BODY=$(cat /tmp/whisper-json.json 2>/dev/null || echo "")
  if [[ "$JSON_HTTP" == "200" ]]; then
    HAS_TEXT=$(echo "$JSON_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'text' in d else 'no')" 2>/dev/null || echo "no")
    if [[ "$HAS_TEXT" == "yes" ]]; then
      pass "response_format=json → body contains 'text' key"
    else
      fail "response_format=json → body missing 'text' key: $JSON_BODY"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"
echo "────────────────────────────────────────"
if [[ $FAIL -eq 0 ]]; then
  green "All tests passed!"
  exit 0
else
  red "$FAIL test(s) failed"
  exit 1
fi
