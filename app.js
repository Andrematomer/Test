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

// Variables Setup
let gateThreshold = 0.03;       
let silenceTimeoutValue = 1200; 
let playbackSpeed = 1.0;        
let detuneValue = 500;          
let distortionAmount = 0;       
let delayTimeMs = 0;            
let delayFeedback = 0.0;        
let tremoloRate = 0;            
let highpassFreq = 0;           
let lowpassFreq = 8000;         

// Auto Pitch Target Variables
let isAutoPitchEnabled = false;
let targetPitchHz = 450;
let lastDetectedUserPitch = null;

// Helper to bind range slider with a manual number input box
function syncControls(slideId, numId, callback) {
  const slider = document.getElementById(slideId);
  const number = document.getElementById(numId);
  
  slider.addEventListener('input', (e) => {
    number.value = e.target.value;
    callback(parseFloat(e.target.value));
  });
  
  number.addEventListener('input', (e) => {
    let val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      slider.value = val; // Clamp inside range slider UI
      callback(val);      // Process absolute written value
    }
  });
}

// Setup double-bound configurations
syncControls('slide-speed', 'num-speed', (val) => playbackSpeed = val);
syncControls('slide-detune', 'num-detune', (val) => detuneValue = val);
syncControls('slide-distortion', 'num-distortion', (val) => distortionAmount = val);
syncControls('slide-delay', 'num-delay', (val) => delayTimeMs = val);
syncControls('slide-feedback', 'num-feedback', (val) => delayFeedback = val / 100);
syncControls('slide-tremolo', 'num-tremolo', (val) => tremoloRate = val);
syncControls('slide-highpass', 'num-highpass', (val) => highpassFreq = val);
syncControls('slide-lowpass', 'num-lowpass', (val) => lowpassFreq = val);
syncControls('slide-gate', 'num-gate', (val) => gateThreshold = val);
syncControls('slide-silence', 'num-silence', (val) => silenceTimeoutValue = val);

// Handle checkbox and targets
const checkAutoTarget = document.getElementById('check-auto-target');
const numTargetPitch = document.getElementById('num-target-pitch');
const pitchLog = document.getElementById('pitch-detector-log');

checkAutoTarget.addEventListener('change', (e) => {
  isAutoPitchEnabled = e.target.checked;
  logEvent(`Pitch Auto-Targeting changed to: ${isAutoPitchEnabled}`);
});
numTargetPitch.addEventListener('input', (e) => {
  targetPitchHz = parseFloat(e.target.value) || 450;
});

// Audio variables
let audioCtx = null;
let stream = null;
let analyser = null;
let mediaRecorder = null;
let audioChunks = [];

// App Loop States
let isInitialized = false;
let isSpeaking = false;      
let isRepeating = false;     
let silenceTimer = null;

const btnActivate = document.getElementById('btn-activate');
const stateIndicator = document.getElementById('state-indicator');
const canvas = document.getElementById('volume-canvas');
const canvasCtx = canvas.getContext('2d');

// Activation Event
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
    logEvent(`Hardware initialization failed: ${err.message}`, true);
  }
});

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
      
      // Execute Pitch Detection Algorithm
      if (isAutoPitchEnabled) {
        lastDetectedUserPitch = analyzeBufferPitch(audioBuffer);
      }
      
      playVoiceWithDSP(audioBuffer);
    } catch (err) {
      logEvent(`Failed to decode voice buffer: ${err.message}`, true);
      resetToListening();
    }
  };
}

// Time-Domain Autocorrelation Pitch Detector
function analyzeBufferPitch(audioBuffer) {
  const data = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const frameSize = 2048;
  const pitches = [];

  // Slice buffer and auto-correlate each frame
  for (let offset = 0; offset < data.length; offset += frameSize) {
    const frame = data.subarray(offset, offset + frameSize);
    const pitch = autoCorrelate(frame, sampleRate);
    
    // Only accept frequencies within human speech limits (60Hz to 1200Hz)
    if (pitch > 60 && pitch < 1200) {
      pitches.push(pitch);
    }
  }

  if (pitches.length === 0) {
    pitchLog.textContent = "Could not detect clear fundamental pitch.";
    logEvent("Vocal pitch analysis returned no reliable fundamental pitches.");
    return null;
  }

  // Sort values to compute the median
  pitches.sort((a, b) => a - b);
  const medianPitch = pitches[Math.floor(pitches.length / 2)];
  
  pitchLog.textContent = `Last Detected Pitch: ${medianPitch.toFixed(1)} Hz`;
  logEvent(`Detected User Pitch: ${medianPitch.toFixed(1)} Hz (Median calculated from ${pitches.length} frames).`);
  return medianPitch;
}

function autoCorrelate(buffer, sampleRate) {
  // 1. Root-Mean-Square threshold check (ignore silent slices)
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.015) return -1; 

  // 2. Perform Autocorrelation (Signal match comparison)
  let r = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    for (let j = 0; j < buffer.length - i; j++) {
      r[i] += buffer[j] * buffer[j + i];
    }
  }

  // 3. Find the first zero-crossing/local minimum to ignore immediate phase
  let d = 0;
  while (d < buffer.length - 1 && r[d] > r[d + 1]) {
    d++;
  }
  
  // 4. Find the absolute peak after the zero-crossing
  let maxval = -1;
  let maxpos = -1;
  for (let i = d; i < buffer.length; i++) {
    if (r[i] > maxval) {
      maxval = r[i];
      maxpos = i;
    }
  }

  if (maxpos !== -1 && maxval > 0) {
    return sampleRate / maxpos; // Convert wavelength period to Frequency
  }
  return -1;
}

// Playback Processing Chain
function playVoiceWithDSP(buffer) {
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  // Auto-Pitch Logic calculation
  if (isAutoPitchEnabled && lastDetectedUserPitch !== null) {
    // Calculate semitones/cents adjustment required
    const pitchRatio = targetPitchHz / lastDetectedUserPitch;
    const computedDetune = 1200 * Math.log2(pitchRatio);
    
    source.playbackRate.value = 1.0; // Reset speed back to normal
    if (source.detune) {
      source.detune.value = computedDetune;
    }
    pitchLog.textContent = `User Pitch: ${lastDetectedUserPitch.toFixed(1)} Hz\nTarget: ${targetPitchHz} Hz\nDetune applied: ${computedDetune.toFixed(0)} cents`;
    logEvent(`Auto-Normalizer applied: detuning by ${computedDetune.toFixed(0)} cents.`);
  } else {
    // Fallback to manual slider values
    source.playbackRate.value = playbackSpeed;
    if (source.detune) {
      source.detune.value = detuneValue;
    }
  }

  const highpass = audioCtx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = highpassFreq;

  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = lowpassFreq;

  const distortion = audioCtx.createWaveShaper();
  const dCurve = makeDistortionCurve(distortionAmount);
  if (dCurve) {
    distortion.curve = dCurve;
    distortion.oversample = '4x';
  }

  const delay = audioCtx.createDelay(1.0); 
  delay.delayTime.value = delayTimeMs / 1000; 
  
  const feedback = audioCtx.createGain();
  feedback.gain.value = delayFeedback;

  delay.connect(feedback);
  feedback.connect(delay);

  const tremoloGain = audioCtx.createGain();
  tremoloGain.gain.value = 1.0;
  let tremoloOsc = null;

  if (tremoloRate > 0) {
    const tremoloLFO = audioCtx.createOscillator();
    tremoloLFO.type = 'sine';
    tremoloLFO.frequency.value = tremoloRate;
    
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 0.5; 

    tremoloLFO.connect(lfoGain);
    lfoGain.connect(tremoloGain.gain);
    tremoloLFO.start(0);
    tremoloOsc = tremoloLFO;
  }

  source.connect(distortion);
  distortion.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(tremoloGain);
  tremoloGain.connect(audioCtx.destination);

  if (delayTimeMs > 0) {
    tremoloGain.connect(delay);
    delay.connect(audioCtx.destination);
  }

  source.start(0);
  logEvent(`Tan is speaking. FX active.`);
  logEvent(`Tan is speaking. FX active.`);

  source.onended = () => {
    if (tremoloOsc) {
      try { tremoloOsc.stop(); } catch(e) {}
    }
    if (tremoloOsc) {
      try { tremoloOsc.stop(); } catch(e) {}
    }
    resetToListening();
  };
}

// Setup clean waveshaper curve
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

function resetToListening() {
  isRepeating = false;
  stateIndicator.textContent = "🐱 TAN IS LISTENING...";
  stateIndicator.style.color = "#55ff55";
  logEvent("Tan finished speaking. Resuming microphone listening.");
}

function startSilenceMonitor() {
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  
  setInterval(() => {
    if (!isInitialized || isRepeating) return; 

    analyser.getByteFrequencyData(dataArray);
    
    let total = 0;
    for (let i = 0; i < dataArray.length; i++) {
      total += dataArray[i];
    }
    const currentVolume = total / dataArray.length / 255; 

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