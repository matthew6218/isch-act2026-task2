# AI Detection Mini Competition

A Flask web app that uses a Teachable Machine image model to detect three targets and the browser's built-in text-to-speech to announce them:

- `Pen` → “This is a pen.”
- `iSchool Cube` → “This is an iSchool cube.”
- `Tissue` → “This is a tissue.”

## Prepare the model

1. Create an Image Project in Teachable Machine.
2. Train classes named `Pen`, `iSchool Cube`, and `Tissue` (capitalization does not matter). Add varied angles, lighting, distance, and backgrounds to improve accuracy.
3. Export as TensorFlow.js.
4. Download the files into `static/model/`, or paste the model's shared URL into the app.

## Run

```powershell
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5000> and select **Start detection**. By default, the app requires at least 85% confidence held for 0.6 seconds. A target must leave the camera briefly before the same announcement can play again. The timer stops when the configured win condition is reached.

Before clicking **Start detection**, users can adjust **Minimum confidence** and **Accurate detection time** directly on the webpage. These controls are locked while detection is running. Click **Stop detection** to pause the camera and edit them again.

Use **Detection camera** to choose among connected cameras. If camera names are hidden, click **Find cameras** and allow permission; the temporary permission stream closes immediately after the list is loaded. Stop detection before switching cameras.

Each run contains exactly five detection attempts. Users can edit the pause between attempts and the time limit for each attempt on the webpage. A timed-out attempt is recorded as **No detection**, and all five results appear in the on-page attempt log while the original task checklist remains visible. Each log time is the duration of that individual attempt, not the cumulative competition time.

Speech uses the Web Speech API directly in the browser, so no audio files or extra Python text-to-speech dependency is required.

## Customize without editing code

Open `config.txt`, change the values after `=`, save, and refresh the browser. It controls:

- Optional default Teachable Machine model URL
- Confidence threshold and detection timing
- Win condition (required unique targets and optional time limit)
- Text-to-speech language and speed
- All three model class names, display labels, and spoken messages

Keep the `KEY=` names unchanged. The app displays a configuration error if a value is missing or invalid.
