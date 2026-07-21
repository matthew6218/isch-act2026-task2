from __future__ import annotations

from pathlib import Path

from flask import Flask, jsonify, render_template, send_from_directory


app = Flask(__name__)
CONFIG_FILE = Path(__file__).with_name("config.txt")


def read_config() -> dict:
    """Read the teacher-friendly KEY=VALUE configuration file."""
    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(CONFIG_FILE.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"config.txt line {line_number} must use KEY=VALUE")
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()

    targets = []
    for number in range(1, 4):
        class_name = values.get(f"TARGET_{number}_CLASS", "").strip()
        label = values.get(f"TARGET_{number}_LABEL", class_name).strip()
        speech = values.get(f"TARGET_{number}_SPEECH", "").strip()
        if not class_name or not label or not speech:
            raise ValueError(f"Target {number} needs CLASS, LABEL, and SPEECH values")
        targets.append({"id": f"target-{number}", "className": class_name, "label": label, "speech": speech})

    confidence = float(values.get("CONFIDENCE_THRESHOLD", "0.85"))
    speech_rate = float(values.get("SPEECH_RATE", "1.0"))
    required_targets = int(values.get("WIN_REQUIRED_TARGETS", "3"))
    time_limit = float(values.get("WIN_TIME_LIMIT_SECONDS", "0"))
    if not 0 < confidence <= 1:
        raise ValueError("CONFIDENCE_THRESHOLD must be greater than 0 and at most 1")
    if not 0.1 <= speech_rate <= 10:
        raise ValueError("SPEECH_RATE must be between 0.1 and 10")
    if not 1 <= required_targets <= len(targets):
        raise ValueError(f"WIN_REQUIRED_TARGETS must be between 1 and {len(targets)}")
    if time_limit < 0:
        raise ValueError("WIN_TIME_LIMIT_SECONDS cannot be negative")

    return {
        "modelUrl": values.get("MODEL_URL", ""),
        "confidenceThreshold": confidence,
        "requiredStableMs": max(0, int(values.get("REQUIRED_STABLE_MS", "600"))),
        "rearmMs": max(0, int(values.get("REARM_MS", "900"))),
        "speechLanguage": values.get("SPEECH_LANGUAGE", "en-US"),
        "speechRate": speech_rate,
        "winRequiredTargets": required_targets,
        "winTimeLimitSeconds": time_limit,
        "winMessage": values.get("WIN_MESSAGE", "You win! Completed the challenge in {time} seconds."),
        "loseMessage": values.get("LOSE_MESSAGE", "Time is up. Try again!"),
        "targets": targets,
    }


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/config")
def config():
    try:
        return jsonify(read_config())
    except (OSError, ValueError) as error:
        return jsonify(error=str(error)), 500


@app.get("/logos/<path:filename>")
def logos(filename: str):
    response = send_from_directory("logos", filename)
    response.mimetype = "image/webp"
    return response


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
