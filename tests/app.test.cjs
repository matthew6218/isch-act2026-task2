const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function detector() {
  const source = fs.readFileSync(path.join(__dirname, "../static/app.js"), "utf8");
  const elements = new Map();
  const frames = [];
  const speech = [];
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: "",
        textContent: "",
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        replaceChildren() {},
      });
    }
    return elements.get(id);
  };
  const context = vm.createContext({
    console: { log() {} },
    document: {
      getElementById: element,
      createElement: () => ({
        textContent: "",
        classList: { add() {} },
        append() {},
      }),
      querySelector: () => ({ classList: { add() {} } }),
      querySelectorAll: () => [],
    },
    window: { speechSynthesis: { cancel() {}, speak: (message) => speech.push(message.text) } },
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    performance: { now: () => 1000 },
    requestAnimationFrame: (callback) => frames.push(callback),
    setInterval: () => 1,
    clearInterval() {},
  });
  // Event wiring is outside this unit's scope; exercise the actual detector functions.
  vm.runInContext(source.split('$("start").addEventListener')[0], context);
  vm.runInContext(`
    settings = {
      targets: [{ id: "target-1", className: "Pen", label: "Pen", speech: "Pen" }],
      confidenceThreshold: 0.85, requiredStableMs: 600, rearmMs: 900,
      detectionTimeoutSeconds: 10, pauseBetweenDetectionsMs: 1000,
      winRequiredTargets: 1, winTimeLimitSeconds: 0,
      speechLanguage: "en-US", speechRate: 1,
    };
    modelClassTargets = new Map([["pen", settings.targets[0]]]);
    webcam = { canvas: {}, update() {}, stop() {} };
    running = true;
    runGeneration = 1;
    attemptActive = true;
    attemptStartedAt = 1000;
    competitionStartedAt = 1000;
  `, context);
  return { context, element, frames, speech, eval: (code) => vm.runInContext(code, context) };
}

test("a prediction finishing after Stop cannot record an attempt", async () => {
  const app = detector();
  let resolvePrediction;
  app.context.predict = () => new Promise((resolve) => { resolvePrediction = resolve; });
  app.eval("model = { predict }");
  const pending = app.eval("loop(1000, runGeneration)");
  app.eval("stopDetection()");
  resolvePrediction([{ className: "Pen", probability: 1 }]);
  await pending;
  assert.equal(app.eval("attempts.length"), 0);
  assert.equal(app.speech.length, 0);
  assert.equal(app.frames.length, 0);
});

test("a new attempt keeps the previous target disarmed", async () => {
  const app = detector();
  app.eval('lastTriggeredTarget = "target-1"; startNextAttempt(1000)');
  assert.equal(app.eval("lastTriggeredTarget"), "target-1");
  app.context.predict = async () => [{ className: "Pen", probability: 1 }];
  app.eval("model = { predict }");
  await app.eval("loop(2000, runGeneration)");
  assert.equal(app.eval("attempts.length"), 0);
  assert.equal(app.speech.length, 0);
});

test("a reset invalidates an earlier queued animation frame", async () => {
  const app = detector();
  let predictions = 0;
  app.context.predict = async () => {
    predictions += 1;
    return [{ className: "Pen", probability: 0.5 }];
  };
  app.eval("model = { predict }");
  app.eval("resetCompetition(); resetCompetition()");
  assert.equal(app.frames.length, 2);
  await app.frames[0](1000);
  await app.frames[1](1000);
  assert.equal(predictions, 1);
});
