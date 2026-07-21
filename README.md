# AI Detection Mini Competition

A Flask web app that uses a Teachable Machine image model to detect three targets and the browser's built-in text-to-speech to announce them:

- `Pen` → “This is a pen.”
- `Helicea` → “Hello Helicea.”
- `Connie` → “Hello Connie.”

## Prepare the model

1. Create an Image Project in Teachable Machine.
2. Train classes named `Pen`, `Helicea`, and `Connie` (capitalization does not matter). Add varied angles, lighting, distance, and backgrounds to improve accuracy.
3. Export as TensorFlow.js.
4. Download the files into `static/model/`, or paste the model's shared URL into the app.

## Run

```powershell
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5000> and select **Start competition**. The app requires at least 85% confidence held for 0.6 seconds. A target must leave the camera briefly before the same announcement can play again. The timer stops when all three tasks are complete.

Speech uses the Web Speech API directly in the browser, so no audio files or extra Python text-to-speech dependency is required.

## Customize without editing code

Open `config.txt`, change the values after `=`, save, and refresh the browser. It controls:

- Optional default Teachable Machine model URL
- Confidence threshold and detection timing
- Text-to-speech language and speed
- All three model class names, display labels, and spoken messages

Keep the `KEY=` names unchanged. The app displays a configuration error if a value is missing or invalid.
