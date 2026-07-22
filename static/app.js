const $ = (id) => document.getElementById(id);
const MAX_ATTEMPTS = 5;
const PAUSE_TIMER_WEIGHT = 0.5;

let settings;
let model;
let webcam;
let running = false;
let candidate = null;
let candidateSince = 0;
let lastTriggeredTarget = null;
let lastTargetSeenAt = 0;
let competitionStartedAt = 0;
let competitionFinished = false;
let timerId = null;
let attempts = [];
let attemptStartedAt = 0;
let pauseUntil = 0;
let pauseStartedAt = 0;
let completedPauseMs = 0;
let attemptActive = false;
let fourAttemptTime = null;
let fiveAttemptTime = null;
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

function getModelFiles(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter a Teachable Machine model URL first.");
  let url;
  try {
    url = new URL(trimmed, window.location.href);
  } catch {
    throw new Error("Enter a valid Teachable Machine model URL.");
  }
  url.hash = "";
  url.search = "";
  const filename = url.pathname.split("/").pop().toLowerCase();
  if (filename === "model.json" || filename === "metadata.json") {
    url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
  } else if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return {
    modelUrl: new URL("model.json", url).href,
    metadataUrl: new URL("metadata.json", url).href,
  };
}

function classToTarget(className) {
  const normalized = className.trim().toLowerCase();
  return settings.targets.find((target) => normalized === target.className.trim().toLowerCase()) || null;
}

function speak(text) {
  if (!("speechSynthesis" in window)) throw new Error("Text-to-speech is not supported by this browser.");
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = settings.speechLanguage;
  utterance.rate = settings.speechRate;
  window.speechSynthesis.speak(utterance);
}

function renderTasks() {
  $("task-list").replaceChildren(...settings.targets.map((target) => {
    const item = document.createElement("li");
    item.dataset.target = target.id;
    const check = document.createElement("span");
    check.textContent = "\u2713";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `Detect ${target.label}`;
    const speech = document.createElement("small");
    speech.textContent = `\u201c${target.speech}\u201d`;
    details.append(title, speech);
    item.append(check, details);
    return item;
  }));
}

function renderAttemptLog() {
  const rows = Array.from({ length: MAX_ATTEMPTS }, (_, index) => {
    const result = attempts[index];
    const item = document.createElement("li");
    const number = document.createElement("span");
    const outcome = document.createElement("strong");
    const time = document.createElement("em");
    number.textContent = `Attempt ${index + 1}`;
    if (result) {
      outcome.textContent = result.label;
      time.textContent = `${result.duration.toFixed(1)}s`;
      if (!result.targetId) item.classList.add("no-detection");
    } else {
      item.classList.add("pending");
      outcome.textContent = "Waiting";
      time.textContent = "--";
    }
    item.append(number, outcome, time);
    return item;
  });
  $("attempt-log").replaceChildren(...rows);
}

async function loadSettings() {
  const response = await fetch("/api/config", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load config.txt");
  settings = data;
  // Preserve a URL pasted by the user when settings are refreshed on Start.
  // The config value is only used when the input is still empty.
  if (!$("model-url").value.trim() && settings.modelUrl) {
    $("model-url").value = settings.modelUrl;
  }
  if (!$("confidence-input").value) {
    $("confidence-input").value = Math.round(settings.confidenceThreshold * 100);
  }
  if (!$("stable-input").value) {
    $("stable-input").value = settings.requiredStableMs / 1000;
  }
  if (!$("pause-input").value) {
    $("pause-input").value = settings.pauseBetweenDetectionsMs / 1000;
  }
  if (!$("timeout-input").value) {
    $("timeout-input").value = settings.detectionTimeoutSeconds;
  }
  renderTasks();
  renderAttemptLog();
  $("completed-count").textContent = `0 / ${settings.winRequiredTargets}`;
  $("reset").disabled = false;
  log("Settings loaded from config.txt", settings);
}

async function refreshCameraList(requestPermission = false) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error("Camera selection is not supported by this browser.");
  }
  let permissionStream;
  try {
    // Browsers normally hide camera names until permission is granted.
    if (requestPermission) permissionStream = await navigator.mediaDevices.getUserMedia({ video: true });
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === "videoinput");
    const previousSelection = $("camera-select").value;
    const options = devices.map((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${index + 1}`;
      return option;
    });
    if (!options.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Default camera";
      options.push(option);
    }
    $("camera-select").replaceChildren(...options);
    if (devices.some((device) => device.deviceId === previousSelection)) {
      $("camera-select").value = previousSelection;
    }
    log("Camera list updated", devices.map((device, index) => device.label || `Camera ${index + 1}`));
  } finally {
    permissionStream?.getTracks().forEach((track) => track.stop());
  }
}

function elapsedSeconds() {
  if (!competitionStartedAt) return 0;
  const now = performance.now();
  const currentPauseMs = pauseStartedAt
    ? Math.max(0, Math.min(now, pauseUntil) - pauseStartedAt)
    : 0;
  const realElapsedMs = now - competitionStartedAt;
  const pauseDiscountMs = (completedPauseMs + currentPauseMs) * (1 - PAUSE_TIMER_WEIGHT);
  return Math.max(0, realElapsedMs - pauseDiscountMs) / 1000;
}

function updateTimer() {
  const elapsed = elapsedSeconds();
  $("time").textContent = `${elapsed.toFixed(1)}s`;
  if (!competitionFinished && settings.winTimeLimitSeconds > 0 && elapsed >= settings.winTimeLimitSeconds) {
    speak(settings.noDetectionSpeech);
    let remainingAttemptDuration = attemptActive
      ? Math.max(0, (performance.now() - attemptStartedAt) / 1000)
      : 0;
    while (attempts.length < MAX_ATTEMPTS) {
      attempts.push({ targetId: null, label: "No detection", duration: remainingAttemptDuration });
      remainingAttemptDuration = 0;
    }
    fourAttemptTime ??= elapsed;
    fiveAttemptTime = elapsed;
    $("four-attempt-time").textContent = `${fourAttemptTime.toFixed(1)}s`;
    $("five-attempt-time").textContent = `${fiveAttemptTime.toFixed(1)}s`;
    renderAttemptLog();
    finishCompetition(false);
  }
}

function resetCompetition() {
  completed.clear();
  attempts = [];
  fourAttemptTime = null;
  fiveAttemptTime = null;
  candidate = null;
  candidateSince = 0;
  lastTriggeredTarget = null;
  competitionFinished = false;
  competitionStartedAt = running ? performance.now() : 0;
  attemptStartedAt = competitionStartedAt;
  pauseUntil = 0;
  pauseStartedAt = 0;
  completedPauseMs = 0;
  attemptActive = running;
  document.querySelectorAll("[data-target]").forEach((item) => item.classList.remove("complete"));
  $("completed-count").textContent = `0 / ${settings.winRequiredTargets}`;
  $("last-message").textContent = "No message played yet.";
  $("four-attempt-time").textContent = "--";
  $("five-attempt-time").textContent = "--";
  renderAttemptLog();
  $("meter-fill").style.width = "0%";
  $("status").classList.remove("win", "lose");
  if (running) $("status").textContent = "Competition reset. Start detecting targets.";
  clearInterval(timerId);
  timerId = running ? setInterval(updateTimer, 100) : null;
  updateTimer();
}

async function start() {
  if (running) return;
  $("start").disabled = true;
  $("status").textContent = "Loading image model...";
  try {
    await loadSettings();
    const confidencePercent = Number($("confidence-input").value);
    const stableSeconds = Number($("stable-input").value);
    const pauseSeconds = Number($("pause-input").value);
    const timeoutSeconds = Number($("timeout-input").value);
    if (!Number.isFinite(confidencePercent) || confidencePercent < 1 || confidencePercent > 100) {
      throw new Error("Minimum confidence must be between 1% and 100%.");
    }
    if (!Number.isFinite(stableSeconds) || stableSeconds < 0.1 || stableSeconds > 10) {
      throw new Error("Accurate detection time must be between 0.1 and 10 seconds.");
    }
    if (!Number.isFinite(pauseSeconds) || pauseSeconds < 0 || pauseSeconds > 60) {
      throw new Error("Pause between attempts must be between 0 and 60 seconds.");
    }
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0.5 || timeoutSeconds > 300) {
      throw new Error("Attempt time limit must be between 0.5 and 300 seconds.");
    }
    settings.confidenceThreshold = confidencePercent / 100;
    settings.requiredStableMs = stableSeconds * 1000;
    settings.pauseBetweenDetectionsMs = pauseSeconds * 1000;
    settings.detectionTimeoutSeconds = timeoutSeconds;
    if (!window.tf || !window.tmImage) throw new Error("Recognition libraries did not load. Check the internet connection.");
    const modelFiles = getModelFiles($("model-url").value);
    log("Loading model selected by user", modelFiles);
    model = await tmImage.load(modelFiles.modelUrl, modelFiles.metadataUrl);
    const labels = model.getClassLabels();
    const missing = settings.targets.filter((target) => !labels.some(
      (label) => label.trim().toLowerCase() === target.className.trim().toLowerCase(),
    ));
    if (missing.length) {
      throw new Error(`Model is missing classes: ${missing.map((target) => target.className).join(", ")}. Found: ${labels.join(", ")}`);
    }

    const selectedCameraId = $("camera-select").value;
    webcam = new tmImage.Webcam(420, 420, true);
    await webcam.setup(selectedCameraId ? { deviceId: { exact: selectedCameraId } } : {});
    await webcam.play();
    await refreshCameraList(false);
    $("webcam").replaceChildren(webcam.canvas);
    running = true;
    setDetectionControls(true);
    resetCompetition();
    const timeRule = settings.winTimeLimitSeconds > 0
      ? ` within ${settings.winTimeLimitSeconds} seconds`
      : "";
    $("status").textContent = `Attempt 1 of ${MAX_ATTEMPTS}: show an object${timeRule}.`;
    log("Competition started", { classes: labels });
    requestAnimationFrame(loop);
  } catch (error) {
    const message = errorMessage(error);
    $("status").textContent = `Could not start: ${message}`;
    $("start").disabled = false;
    log("Start failed", message);
  }
}

function setDetectionControls(isRunning) {
  $("start").disabled = isRunning;
  $("stop").disabled = !isRunning;
  $("model-url").disabled = isRunning;
  $("confidence-input").disabled = isRunning;
  $("stable-input").disabled = isRunning;
  $("pause-input").disabled = isRunning;
  $("timeout-input").disabled = isRunning;
  $("camera-select").disabled = isRunning;
  $("refresh-cameras").disabled = isRunning;
}

function stopDetection() {
  if (!running) return;
  running = false;
  clearInterval(timerId);
  if (webcam && typeof webcam.stop === "function") webcam.stop();
  $("webcam").innerHTML = "<p>Camera preview</p>";
  $("meter-fill").style.width = "0%";
  $("detected-target").textContent = "\u2014";
  $("confidence").textContent = "0%";
  $("status").textContent = "Detection stopped. Edit the settings or start again.";
  setDetectionControls(false);
  log("Detection stopped");
}

async function loop(now) {
  if (!running) return;
  try {
    if (!attemptActive) {
      if (now < pauseUntil) {
        const remaining = Math.max(0, (pauseUntil - now) / 1000).toFixed(1);
        $("status").textContent = `Next attempt starts in ${remaining} seconds.`;
        requestAnimationFrame(loop);
        return;
      }
      startNextAttempt(now);
    }
    if ((now - attemptStartedAt) / 1000 >= settings.detectionTimeoutSeconds) {
      recordAttempt(null, now);
      requestAnimationFrame(loop);
      return;
    }
    webcam.update();
    const predictions = await model.predict(webcam.canvas);
    const best = predictions.reduce((a, b) => a.probability > b.probability ? a : b);
    const target = classToTarget(best.className);
    $("detected-target").textContent = target ? target.label : best.className;
    $("confidence").textContent = `${Math.round(best.probability * 100)}%`;

    if (target && best.probability >= settings.confidenceThreshold) {
      lastTargetSeenAt = now;
      if (target.id !== lastTriggeredTarget) {
        if (candidate !== target.id) {
          candidate = target.id;
          candidateSince = now;
        }
        const progress = Math.min(1, (now - candidateSince) / settings.requiredStableMs);
        $("meter-fill").style.width = `${progress * 100}%`;
        if (progress >= 1) triggerTarget(target);
      } else {
        $("meter-fill").style.width = "100%";
      }
    } else {
      candidate = null;
      candidateSince = 0;
      $("meter-fill").style.width = "0%";
      if (now - lastTargetSeenAt >= settings.rearmMs) lastTriggeredTarget = null;
    }
  } catch (error) {
    running = false;
    clearInterval(timerId);
    if (webcam && typeof webcam.stop === "function") webcam.stop();
    setDetectionControls(false);
    $("status").textContent = `Prediction failed: ${errorMessage(error)}`;
    return;
  }
  requestAnimationFrame(loop);
}

function triggerTarget(target) {
  if (competitionFinished) return;
  lastTriggeredTarget = target.id;
  candidate = null;
  speak(target.speech);
  completed.add(target.id);
  document.querySelector(`[data-target="${target.id}"]`).classList.add("complete");
  $("completed-count").textContent = `${completed.size} / ${settings.winRequiredTargets}`;
  $("last-message").textContent = target.speech;
  log("Target detected", { target: target.label, speech: target.speech });
  recordAttempt(target, performance.now());
}

function startNextAttempt(now) {
  if (pauseStartedAt) {
    completedPauseMs += Math.max(0, Math.min(now, pauseUntil) - pauseStartedAt);
  }
  attemptActive = true;
  attemptStartedAt = now;
  pauseUntil = 0;
  pauseStartedAt = 0;
  candidate = null;
  candidateSince = 0;
  lastTriggeredTarget = null;
  $("meter-fill").style.width = "0%";
  $("status").textContent = `Attempt ${attempts.length + 1} of ${MAX_ATTEMPTS}: show an object.`;
}

function recordAttempt(target, now) {
  if (!running || !attemptActive || attempts.length >= MAX_ATTEMPTS) return;
  attemptActive = false;
  candidate = null;
  candidateSince = 0;
  $("meter-fill").style.width = "0%";
  const result = {
    targetId: target?.id || null,
    label: target?.label || "No detection",
    duration: Math.max(0, (now - attemptStartedAt) / 1000),
  };
  attempts.push(result);
  if (!target) {
    speak(settings.noDetectionSpeech);
    $("last-message").textContent = settings.noDetectionSpeech;
  }
  renderAttemptLog();
  if (attempts.length === 4) {
    fourAttemptTime = elapsedSeconds();
    $("four-attempt-time").textContent = `${fourAttemptTime.toFixed(1)}s`;
  }
  if (attempts.length === 5) {
    fiveAttemptTime = elapsedSeconds();
    $("five-attempt-time").textContent = `${fiveAttemptTime.toFixed(1)}s`;
  }
  log(`Attempt ${attempts.length} recorded`, result);

  if (attempts.length >= MAX_ATTEMPTS) {
    finishCompetition(completed.size >= settings.winRequiredTargets);
    return;
  }
  pauseStartedAt = now;
  pauseUntil = now + settings.pauseBetweenDetectionsMs;
  if (settings.pauseBetweenDetectionsMs === 0) startNextAttempt(now);
}

function finishCompetition(won) {
  if (competitionFinished) return;
  competitionFinished = true;
  running = false;
  clearInterval(timerId);
  if (webcam && typeof webcam.stop === "function") webcam.stop();
  setDetectionControls(false);
  const time = elapsedSeconds().toFixed(1);
  $("time").textContent = `${time}s`;
  $("status").textContent = won
    ? settings.winMessage.replaceAll("{time}", time)
    : settings.loseMessage.replaceAll("{time}", time);
  $("status").classList.toggle("win", won);
  $("status").classList.toggle("lose", !won);
  log(won ? "Competition won" : "Competition lost", { time });
}

$("start").addEventListener("click", start);
$("model-url").addEventListener("input", () => {
  // Keep the user's latest choice across refreshes; config.txt remains the fallback.
  localStorage.setItem("modelUrl", $("model-url").value.trim());
});
$("stop").addEventListener("click", stopDetection);
$("refresh-cameras").addEventListener("click", async () => {
  $("refresh-cameras").disabled = true;
  try {
    await refreshCameraList(true);
    $("status").textContent = "Camera list updated. Select a camera, then start detection.";
  } catch (error) {
    $("status").textContent = `Could not list cameras: ${errorMessage(error)}`;
  } finally {
    $("refresh-cameras").disabled = false;
  }
});
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
const savedModelUrl = localStorage.getItem("modelUrl");
if (savedModelUrl) $("model-url").value = savedModelUrl;

loadSettings().then(() => {
  $("status").textContent = "Settings loaded. Waiting to start.";
  refreshCameraList(false).catch((error) => log("Could not list cameras yet", errorMessage(error)));
}).catch((error) => {
  $("status").textContent = `Configuration error: ${errorMessage(error)}`;
  $("start").disabled = true;
  log("Configuration failed", errorMessage(error));
});

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  if (!running) refreshCameraList(false).catch((error) => log("Camera refresh failed", errorMessage(error)));
});
