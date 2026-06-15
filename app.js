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
let playbackSpeed = 1.4;        // Cat pitch scale
let detuneValue = 0;            // Fine pitch tuning (cents)
let filterFrequency = 3000;     // Lowpass filter frequency

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

const slideFilter = document.getElementById('slide-filter');
const valFilter = document.getElementById('val-filter');
slideFilter.addEventListener('input', (e) => {
  filterFrequency = parseInt(e.target.value);
  valFilter.textContent = filterFrequency;
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
    // Request raw microphone access
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Analyze microphone volume
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
      // Decode raw mic data to Web Audio Buffer
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      playVoiceWithDSP(audioBuffer);
    } catch (err) {
      logEvent(`Failed to decode voice buffer: ${err.message}`, true);
      resetToListening();
    }
  };
}

// 3. Playback with Cat DSP processing
function playVoiceWithDSP(buffer) {
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  // Apply cat high-pitch and speed
  source.playbackRate.value = playbackSpeed;
  
  // Apply detuning (fine pitch tuning)
  if (source.detune) {
    source.detune.value = detuneValue;
  }

  // Filter out harsh highs to mimic toy cat speaker
  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = filterFrequency;

  // Connect the chain: Source -> Filter -> Output
  source.connect(filter);
  filter.connect(audioCtx.destination);

  source.start(0);
  logEvent(`Tan is speaking. Speed: ${playbackSpeed}x, Detune: ${detuneValue}cents`);

  source.onended = () => {
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
    
    // Calculate volume Root-Mean-Square (RMS)
    let total = 0;
    for (let i = 0; i < dataArray.length; i++) {
      total += dataArray[i];
    }
    const currentVolume = total / dataArray.length / 255; // Normalized (0 to 1)

    // Voice Activity Detection (VAD) Logic
    if (currentVolume > gateThreshold) {
      // User is talking
      if (!isSpeaking) {
        isSpeaking = true;
        logEvent("Sound detected. Recording started...");
        audioChunks = [];
        mediaRecorder.start();
      }
      // Reset timer as long as user keeps talking
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    } else {
      // User is silent
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
      
      // Paint red if Tan is muted/speaking, green otherwise
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