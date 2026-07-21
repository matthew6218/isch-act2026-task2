const $ = (id) => document.getElementById(id);

const CONFIDENCE_THRESHOLD = 0.85;
const REQUIRED_STABLE_MS = 600;
const REARM_MS = 900;

const TARGETS = {
  pen: { label: "Pen", speech: "This is a pen." },
  helicea: { label: "Helicea", speech: "Hello Helicea." },
  connie: { label: "Connie", speech: "Hello Connie." },
};

let model;
let webcam;
let running = false;
let candidate = null;
let candidateSince = 0;
let lastTriggeredTarget = null;
let lastTargetSeenAt = 0;
let competitionStartedAt = 0;
let timerId = null;
const completed = new Set();

function errorMessage(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function log(message, details) {
  const time = new Date().toLocaleTimeString();
  const suffix = details === undefined ? "" : ` | ${typeof details === "string" ? details : JSON.stringify(details)}`;
  const output = $("debug-log");
  console.log(`[Detector] ${message}`, details ?? "");
  if (output) {
    output.textContent += `[${time}] ${message}${suffix}\n`;
    output.scrollTop = output.scrollHeight;
  }
}

function normalizeModelBase(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter a Teachable Machine model URL first.");
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function classToTarget(className) {
  const text = className.trim().toLowerCase();
  if (/\bpen\b/.test(text)) return "pen";
  if (text.includes("helicea")) return "helicea";
  if (text.includes("connie")) return "connie";
  return null;
}

function speak(text) {
  if (!("speechSynthesis" in window)) throw new Error("Text-to-speech is not supported by this browser.");
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

function elapsedSeconds() {
  return competitionStartedAt ? (performance.now() - competitionStartedAt) / 1000 : 0;
}

function updateTimer() {
  $("time").textContent = `${elapsedSeconds().toFixed(1)}s`;
}

function resetCompetition() {
  completed.clear();
  candidate = null;
  candidateSince = 0;
  lastTriggeredTarget = null;
  competitionStartedAt = running ? performance.now() : 0;
  document.querySelectorAll("[data-target]").forEach((item) => item.classList.remove("complete"));
  $("completed-count").textContent = "0 / 3";
  $("last-message").textContent = "No message played yet.";
  $("meter-fill").style.width = "0%";
  clearInterval(timerId);
  timerId = running ? setInterval(updateTimer, 100) : null;
  updateTimer();
}

async function start() {
  if (running) return;
  $("start").disabled = true;
  $("status").textContent = "Loading image model…";
  try {
    if (!window.tf || !window.tmImage) throw new Error("Recognition libraries did not load. Check the internet connection.");
    const base = normalizeModelBase($("model-url").value);
    model = await tmImage.load(`${base}model.json`, `${base}metadata.json`);
    const labels = model.getClassLabels();
    const recognizedLabels = labels.map(classToTarget).filter(Boolean);
    if (!["pen", "helicea", "connie"].every((target) => recognizedLabels.includes(target))) {
      throw new Error(`The model needs Pen, Helicea, and Connie classes. Found: ${labels.join(", ")}`);
    }

    webcam = new tmImage.Webcam(420, 420, true);
    await webcam.setup();
    await webcam.play();
    $("webcam").replaceChildren(webcam.canvas);
    running = true;
    resetCompetition();
    $("status").textContent = "Ready — show a pen, Helicea, or Connie to the camera.";
    log("Competition started", { classes: labels });
    requestAnimationFrame(loop);
  } catch (error) {
    const message = errorMessage(error);
    $("status").textContent = `Could not start: ${message}`;
    $("start").disabled = false;
    log("Start failed", message);
  }
}

async function loop(now) {
  if (!running) return;
  try {
    webcam.update();
    const predictions = await model.predict(webcam.canvas);
    const best = predictions.reduce((a, b) => a.probability > b.probability ? a : b);
    const target = classToTarget(best.className);

    $("detected-target").textContent = target ? TARGETS[target].label : best.className;
    $("confidence").textContent = `${Math.round(best.probability * 100)}%`;

    if (target && best.probability >= CONFIDENCE_THRESHOLD) {
      lastTargetSeenAt = now;
      if (target !== lastTriggeredTarget) {
        if (candidate !== target) {
          candidate = target;
          candidateSince = now;
        }
        const progress = Math.min(1, (now - candidateSince) / REQUIRED_STABLE_MS);
        $("meter-fill").style.width = `${progress * 100}%`;
        if (progress >= 1) triggerTarget(target);
      } else {
        $("meter-fill").style.width = "100%";
      }
    } else {
      candidate = null;
      candidateSince = 0;
      $("meter-fill").style.width = "0%";
      if (now - lastTargetSeenAt >= REARM_MS) lastTriggeredTarget = null;
    }
  } catch (error) {
    running = false;
    clearInterval(timerId);
    $("status").textContent = `Prediction failed: ${errorMessage(error)}`;
    $("start").disabled = false;
    return;
  }
  requestAnimationFrame(loop);
}

function triggerTarget(target) {
  const config = TARGETS[target];
  lastTriggeredTarget = target;
  candidate = null;
  speak(config.speech);
  completed.add(target);
  document.querySelector(`[data-target="${target}"]`).classList.add("complete");
  $("completed-count").textContent = `${completed.size} / 3`;
  $("last-message").textContent = config.speech;
  log("Target detected", { target: config.label, speech: config.speech });

  if (completed.size === 3) {
    clearInterval(timerId);
    updateTimer();
    $("status").textContent = `Completed all tasks in ${elapsedSeconds().toFixed(1)} seconds!`;
  }
}

$("start").addEventListener("click", start);
$("reset").addEventListener("click", resetCompetition);
$("copy-log").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("debug-log").textContent);
    log("Diagnostic log copied");
  } catch (error) {
    log("Could not copy log", errorMessage(error));
  }
});

window.addEventListener("error", (event) => log("Browser error", event.message));
window.addEventListener("unhandledrejection", (event) => log("Unhandled rejection", errorMessage(event.reason)));
log("Page ready");
