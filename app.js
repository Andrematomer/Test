// Global Log for copy-paste debugging
const logs = [];
function logEvent(message, isError = false) {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = isError ? "[ERROR]" : "[INFO]";
  const logLine = `${timestamp} ${prefix} ${message}`;
  logs.push(logLine);
  
  const debugLogElem = document.getElementById('debug-log');
  if (debugLogElem) {
    debugLogElem.textContent = logs.join('\n');
    debugLogElem.scrollTop = debugLogElem.scrollHeight;
  }
}

// Service Worker Offline Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => logEvent(`Service Worker registered: ${reg.scope}`))
      .catch(err => logEvent(`Service Worker registration failed: ${err.message}`, true));
  });
}

// Voice Parameters
let gateThreshold = 0.03;       // Mic trigger volume
let silenceTimeoutValue = 1200; // Time in ms to wait before repeating
let playbackSpeed = 1.0;        // Default speed 1x
let detuneValue = 500;          // Default detune 500 cents
let distortionAmount = 0;       // Waveshaper distortion (0 to 100)
let delayTimeMs = 0;            // Echo delay (0 to 1000ms)
let delayFeedback = 0.0;        // Echo decay percentage (0.0 to 0.9)
let tremoloRate = 0;            // Tremolo frequency (0 to 25Hz)
let highpassFreq = 0;           // Highpass filter (0 to 1500Hz)
let lowpassFreq = 8000;         // Lowpass filter (1000 to 8000Hz)

// Bind Sliders to DOM and Variables
const slideSpeed = document.getElementById('slide-speed');
const valSpeed = document.getElementById('val-speed');
slideSpeed.addEventListener('input', (e) => {
  playbackSpeed = parseFloat(e.target.value);
  valSpeed.textContent = playbackSpeed;
});

const slideDetune = document.getElementById('slide-detune');
const valDetune = document.getElementById('val-detune');
slideDetune.addEventListener('input', (e) => {
  detuneValue = parseInt(e.target.value);
  valDetune.textContent = detuneValue;
});

const slideDistortion = document.getElementById('slide-distortion');
const valDistortion = document.getElementById('val-distortion');
slideDistortion.addEventListener('input', (e) => {
  distortionAmount = parseInt(e.target.value);
  valDistortion.textContent = distortionAmount;
});

const slideDelay = document.getElementById('slide-delay');
const valDelay = document.getElementById('val-delay');
slideDelay.addEventListener('input', (e) => {
  delayTimeMs = parseInt(e.target.value);
  valDelay.textContent = delayTimeMs;
});

const slideFeedback = document.getElementById('slide-feedback');
const valFeedback = document.getElementById('val-feedback');
slideFeedback.addEventListener('input', (e) => {
  delayFeedback = parseFloat(e.target.value) / 100;
  valFeedback.textContent = e.target.value;
});

const slideTremolo = document.getElementById('slide-tremolo');
const valTremolo = document.getElementById('val-tremolo');
slideTremolo.addEventListener('input', (e) => {
  tremoloRate = parseInt(e.target.value);
  valTremolo.textContent = tremoloRate;
});

const slideHighpass = document.getElementById('slide-highpass');
const valHighpass = document.getElementById('val-highpass');
slideHighpass.addEventListener('input', (e) => {
  highpassFreq = parseInt(e.target.value);
  valHighpass.textContent = highpassFreq;
});

const slideLowpass = document.getElementById('slide-lowpass');
const valLowpass = document.getElementById('val-lowpass');
slideLowpass.addEventListener('input', (e) => {
  lowpassFreq = parseInt(e.target.value);
  valLowpass.textContent = lowpassFreq;
});

const slideGate = document.getElementById('slide-gate');
const valGate = document.getElementById('val-gate');
slideGate.addEventListener('input', (e) => {
  gateThreshold = parseFloat(e.target.value);
  valGate.textContent = gateThreshold;
});

const slideSilence = document.getElementById('slide-silence');
const valSilence = document.getElementById('val-silence');
slideSilence.addEventListener('input', (e) => {
  silenceTimeoutValue = parseInt(e.target.value);
  valSilence.textContent = silenceTimeoutValue;
});

// Audio variables
let audioCtx = null;
let stream = null;
let analyser = null;
let mediaRecorder = null;
let audioChunks = [];

// App Loop States
let isInitialized = false;
let isSpeaking = false;      // True if USER is actively talking
let isRepeating = false;     // True if TAN is currently playing back
let silenceTimer = null;

const btnActivate = document.getElementById('btn-activate');
const stateIndicator = document.getElementById('state-indicator');
const canvas = document.getElementById('volume-canvas');
const canvasCtx = canvas.getContext('2d');

// 1. Initial activation via secure iOS click-gesture
btnActivate.addEventListener('click', async () => {
  if (isInitialized) return;
  
  logEvent("Initializing audio hardware...");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    setupMediaRecorder();
    startSilenceMonitor();
    drawVisualizer();

    isInitialized = true;
    btnActivate.style.display = "none";
    stateIndicator.textContent = "🐱 TAN IS LISTENING...";
    stateIndicator.style.color = "#55ff55";
    logEvent("Talking Tan is active and listening.");
  } catch (err) {
    stateIndicator.textContent = "ACTIVATION FAILED";
    stateIndicator.style.color = "#ff5555";
    logEvent(`Hardware initial failed: ${err.message}`, true);
  }
});

// 2. Setup the MediaRecorder API
function setupMediaRecorder() {
  mediaRecorder = new MediaRecorder(stream);
  
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      audioChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = async () => {
    logEvent("User stopped talking. Encoding voice buffer...");
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    audioChunks = [];
    
    isRepeating = true;
    stateIndicator.textContent = "🐱 TAN IS REPEATING...";
    stateIndicator.style.color = "#ffaa00";

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      playVoiceWithDSP(audioBuffer);
    } catch (err) {
      logEvent(`Failed to decode voice buffer: ${err.message}`, true);
      resetToListening();
    }
  };
}

// Helper function to build standard waveshaper distortion curve
function makeDistortionCurve(amount) {
  let k = typeof amount === 'number' ? amount : 50;
  if (k === 0) return null;
  let n_samples = 44100;
  let curve = new Float32Array(n_samples);
  let deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    let x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// 3. Playback with Cat DSP processing
function playVoiceWithDSP(buffer) {
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  // 1. Apply cat speed
  source.playbackRate.value = playbackSpeed;
  
  // 2. Apply detuning (fine pitch tuning)
  if (source.detune) {
    source.detune.value = detuneValue;
  }

  // 3. Setup Highpass Filter (Speaker simulation)
  const highpass = audioCtx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = highpassFreq;

  // 4. Setup Lowpass Filter (Muffler)
  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = lowpassFreq;

  // 5. Setup Distortion (Waveshaper)
  const distortion = audioCtx.createWaveShaper();
  const dCurve = makeDistortionCurve(distortionAmount);
  if (dCurve) {
    distortion.curve = dCurve;
    distortion.oversample = '4x';
  }

  // 6. Setup Delay / Echo Node
  const delay = audioCtx.createDelay(1.0); // max delay 1 second
  delay.delayTime.value = delayTimeMs / 1000; // convert to seconds
  
  const feedback = audioCtx.createGain();
  feedback.gain.value = delayFeedback;

  // Connect Delay feedback loop
  delay.connect(feedback);
  feedback.connect(delay);

  // 7. Setup Tremolo (Gain Node modulated by LFO)
  const tremoloGain = audioCtx.createGain();
  tremoloGain.gain.value = 1.0;
  let tremoloOsc = null;

  if (tremoloRate > 0) {
    const tremoloLFO = audioCtx.createOscillator();
    tremoloLFO.type = 'sine';
    tremoloLFO.frequency.value = tremoloRate;
    
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 0.5; // Depth of tremolo oscillation (0 to 1)

    tremoloLFO.connect(lfoGain);
    lfoGain.connect(tremoloGain.gain);
    tremoloLFO.start(0);
    tremoloOsc = tremoloLFO;
  }

  // Connect the main series chain:
  // Source -> Distortion -> Highpass -> Lowpass -> TremoloGain -> Out
  source.connect(distortion);
  distortion.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(tremoloGain);
  tremoloGain.connect(audioCtx.destination);

  // Inject Parallel Echo Delay if delay is active
  if (delayTimeMs > 0) {
    tremoloGain.connect(delay);
    delay.connect(audioCtx.destination);
  }

  source.start(0);
  logEvent(`Tan is speaking. FX active.`);

  source.onended = () => {
    if (tremoloOsc) {
      try { tremoloOsc.stop(); } catch(e) {}
    }
    resetToListening();
  };
}

// 4. Reset software mute and return to listening mode
function resetToListening() {
  isRepeating = false;
  stateIndicator.textContent = "🐱 TAN IS LISTENING...";
  stateIndicator.style.color = "#55ff55";
  logEvent("Tan finished speaking. Resuming microphone listening.");
}

// 5. Volume Monitor & Silence detection loop
function startSilenceMonitor() {
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  
  setInterval(() => {
    if (!isInitialized || isRepeating) return; // Ignore if Tan is talking (Software Mute)

    analyser.getByteFrequencyData(dataArray);
    
    let total = 0;
    for (let i = 0; i < dataArray.length; i++) {
      total += dataArray[i];
    }
    const currentVolume = total / dataArray.length / 255; // Normalized (0 to 1)

    // Voice Activity Detection (VAD) Logic
    if (currentVolume > gateThreshold) {
      if (!isSpeaking) {
        isSpeaking = true;
        logEvent("Sound detected. Recording started...");
        audioChunks = [];
        mediaRecorder.start();
      }
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    } else {
      if (isSpeaking && !silenceTimer) {
        silenceTimer = setTimeout(() => {
          isSpeaking = false;
          mediaRecorder.stop();
          silenceTimer = null;
        }, silenceTimeoutValue);
      }
    }
  }, 50);
}

// 6. Simple Green Volume Meter Visualizer
function drawVisualizer() {
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    canvasCtx.fillStyle = '#000';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    let barWidth = (canvas.width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      barHeight = dataArray[i] / 3;
      
      if (isRepeating) {
        canvasCtx.fillStyle = 'rgb(255, 85, 85)';
      } else {
        canvasCtx.fillStyle = `rgb(85, 255, ${barHeight + 100})`;
      }
      
      canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
      x += barWidth + 1;
    }
  }
  draw();
}