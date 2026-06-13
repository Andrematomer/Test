// Global Log array to compile for copy-paste
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
  console.log(logLine);
}

// Log basic browser configuration details
logEvent(`User Agent: ${navigator.userAgent}`);
logEvent(`Secure Context (HTTPS/Localhost): ${window.isSecureContext}`);
logEvent(`Protocol: ${window.location.protocol}`);

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => logEvent(`Service Worker Registered on scope: ${reg.scope}`))
      .catch(err => logEvent(`Service Worker Registration Failed: ${err.message}`, true));
  });
} else {
  logEvent('Service Workers are completely unsupported on this browser.', true);
}

// 1. Connection and Offline State persistence test
const netStatus = document.getElementById('net-status');
const saveInput = document.getElementById('save-input');
const saveOutput = document.getElementById('save-output');

function updateNetworkStatus() {
  if (navigator.onLine) {
    netStatus.textContent = "Connection: ONLINE";
    netStatus.className = "status granted";
    logEvent("Network status changed to: ONLINE");
  } else {
    netStatus.textContent = "Connection: OFFLINE (Fully functioning locally)";
    netStatus.className = "status denied";
    logEvent("Network status changed to: OFFLINE");
  }
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
updateNetworkStatus();

const savedData = localStorage.getItem('pwa_test_value');
if (savedData) {
  saveOutput.textContent = `Last saved value (recovered): "${savedData}"`;
  logEvent(`Recovered stored LocalStorage value: "${savedData}"`);
}
saveInput.addEventListener('input', (e) => {
  localStorage.setItem('pwa_test_value', e.target.value);
  saveOutput.textContent = `Saved locally: "${e.target.value}"`;
});


// 2. Geolocation (Continuous Tracking)
const btnGps = document.getElementById('btn-gps');
const gpsStatus = document.getElementById('gps-status');
const gpsData = document.getElementById('gps-data');
let gpsWatchId = null;

btnGps.addEventListener('click', () => {
  if (!navigator.geolocation) {
    gpsStatus.textContent = "Unsupported";
    gpsStatus.className = "status unsupported";
    logEvent("Geolocation API is completely missing from navigator object.", true);
    return;
  }
  
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
    btnGps.textContent = "Start Continuous Tracking";
    logEvent("Continuous GPS tracking stopped manually.");
    return;
  }

  logEvent("Requesting continuous Geolocation tracking...");
  gpsWatchId = navigator.geolocation.watchPosition(
    (position) => {
      gpsStatus.textContent = "GRANTED (Tracking)";
      gpsStatus.className = "status granted";
      const info = `Lat: ${position.coords.latitude.toFixed(5)}\nLon: ${position.coords.longitude.toFixed(5)}\nAcc: ±${position.coords.accuracy.toFixed(1)}m\nTime: ${new Date(position.timestamp).toLocaleTimeString()}`;
      gpsData.textContent = info;
      logEvent(`GPS Update: Lat ${position.coords.latitude.toFixed(4)}, Lon ${position.coords.longitude.toFixed(4)}`);
    },
    (error) => {
      gpsStatus.textContent = "DENIED / FAILED";
      gpsStatus.className = "status denied";
      gpsData.textContent = error.message;
      logEvent(`Geolocation error triggered: ${error.message} (Code: ${error.code})`, true);
    },
    { enableHighAccuracy: true }
  );
  btnGps.textContent = "Stop Tracking";
});


// 3. Camera Access
const btnCam = document.getElementById('btn-cam');
const camStatus = document.getElementById('cam-status');
const video = document.getElementById('video-element');

btnCam.addEventListener('click', async () => {
  logEvent("Initiating camera permission request...");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    camStatus.textContent = "UNSUPPORTED";
    camStatus.className = "status unsupported";
    logEvent("navigator.mediaDevices.getUserMedia is undefined.", true);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;
    camStatus.textContent = "ACTIVE";
    camStatus.className = "status granted";
    logEvent("Camera stream initialized successfully.");
  } catch (err) {
    camStatus.textContent = "DENIED / FAILED";
    camStatus.className = "status denied";
    logEvent(`Camera request failed: ${err.name} - ${err.message}`, true);
  }
});


// 4. Microphone & Live Audio
const btnMic = document.getElementById('btn-mic');
const micStatus = document.getElementById('mic-status');
const canvas = document.getElementById('mic-canvas');
const canvasCtx = canvas.getContext('2d');

btnMic.addEventListener('click', async () => {
  logEvent("Initiating microphone permission request...");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    micStatus.textContent = "UNSUPPORTED";
    micStatus.className = "status unsupported";
    logEvent("navigator.mediaDevices.getUserMedia is undefined for microphone.", true);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micStatus.textContent = "ACTIVE";
    micStatus.className = "status granted";
    logEvent("Microphone stream initialized successfully.");

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function drawAudio() {
      requestAnimationFrame(drawAudio);
      analyser.getByteFrequencyData(dataArray);

      canvasCtx.fillStyle = '#222';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      let barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        canvasCtx.fillStyle = `rgb(85, 255, ${barHeight + 100})`;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    }
    drawAudio();
  } catch (err) {
    micStatus.textContent = "DENIED / FAILED";
    micStatus.className = "status denied";
    logEvent(`Microphone request failed: ${err.name} - ${err.message}`, true);
  }
});


// 5. Device Orientation & Motion
const btnMotion = document.getElementById('btn-motion');
const motionStatus = document.getElementById('motion-status');
const motionData = document.getElementById('motion-data');

function startSensorListeners() {
  logEvent("Binding sensors: listening to device orientation.");
  window.addEventListener('deviceorientation', (event) => {
    if (event.alpha === null && event.beta === null) {
      motionData.textContent = "Permission is active, but hardware stream is empty (blocked on HTTP).";
    } else {
      motionData.textContent = `Alpha (Yaw): ${event.alpha?.toFixed(2)}°\nBeta (Pitch): ${event.beta?.toFixed(2)}°\nGamma (Roll): ${event.gamma?.toFixed(2)}°`;
    }
  });
  motionStatus.textContent = "ACTIVE";
  motionStatus.className = "status granted";
}

btnMotion.addEventListener('click', async () => {
  logEvent("Requesting accelerometer/gyroscope access...");
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      logEvent(`DeviceOrientationPermission resolved: ${permission}`);
      if (permission === 'granted') {
        startSensorListeners();
      } else {
        motionStatus.textContent = "DENIED";
        motionStatus.className = "status denied";
      }
    } catch (err) {
      motionStatus.textContent = "ERROR";
      motionStatus.className = "status denied";
      motionData.textContent = err.message;
      logEvent(`Motion sensor permission crashed: ${err.message}`, true);
    }
  } else {
    logEvent("Browsers does not require explicit gesture-permission for sensor access. Initiating directly.");
    startSensorListeners();
  }
});


// 6. Contact Picker API
const btnContacts = document.getElementById('btn-contacts');
const contactsStatus = document.getElementById('contacts-status');
const contactsData = document.getElementById('contacts-data');

if ('contacts' in navigator && 'select' in navigator.contacts) {
  contactsStatus.textContent = "SUPPORTED";
  contactsStatus.className = "status granted";
  logEvent("Contact Picker API is supported natively.");
} else {
  contactsStatus.textContent = "UNSUPPORTED";
  contactsStatus.className = "status unsupported";
  btnContacts.disabled = true;
  logEvent("Contact Picker API is completely unsupported.", true);
}

btnContacts.addEventListener('click', async () => {
  const props = ['name', 'tel'];
  try {
    logEvent("Opening system contact selection modal...");
    const contacts = await navigator.contacts.select(props, { multiple: true });
    if (contacts.length > 0) {
      let result = "";
      contacts.forEach(c => {
        result += `Name: ${c.name ? c.name[0] : 'N/A'}\nTel: ${c.tel ? c.tel[0] : 'N/A'}\n\n`;
      });
      contactsData.textContent = result;
      logEvent(`Successfully imported ${contacts.length} contacts.`);
    } else {
      contactsData.textContent = "Picked nothing.";
      logEvent("Contact picker opened, but user cancelled or selected nothing.");
    }
  } catch (err) {
    contactsData.textContent = `Error: ${err.message}`;
    logEvent(`Contact picker error: ${err.message}`, true);
  }
});


// 7. Push Notifications
const btnNotify = document.getElementById('btn-notify');
const notifyStatus = document.getElementById('notify-status');

if ('Notification' in window) {
  notifyStatus.textContent = Notification.permission.toUpperCase();
  if (Notification.permission === 'granted') notifyStatus.className = "status granted";
  if (Notification.permission === 'denied') notifyStatus.className = "status denied";
  logEvent(`Notification status initialized: ${Notification.permission}`);
} else {
  notifyStatus.textContent = "UNSUPPORTED";
  notifyStatus.className = "status unsupported";
  logEvent("Push Notifications API is completely unsupported.", true);
}

btnNotify.addEventListener('click', () => {
  if (!('Notification' in window)) return;
  logEvent("Requesting user notification permissions...");
  Notification.requestPermission().then(permission => {
    notifyStatus.textContent = permission.toUpperCase();
    if (permission === 'granted') {
      notifyStatus.className = "status granted";
      new Notification("System Alert", { body: "PWA Permissions validated successfully!" });
      logEvent("Notification permission GRANTED.");
    } else {
      notifyStatus.className = "status denied";
      logEvent(`Notification permission resolved as: ${permission}`, true);
    }
  });
});


// 8. Aggressive Permissions
const btnPersist = document.getElementById('btn-persist');
const persistStatus = document.getElementById('persist-status');
const btnWake = document.getElementById('btn-wake');
const wakeStatus = document.getElementById('wake-status');
let wakeLock = null;

// Storage Persistence Check
if (navigator.storage && navigator.storage.persisted) {
  navigator.storage.persisted().then(isPersisted => {
    persistStatus.textContent = isPersisted ? "PERSISTED (Safeguarded)" : "Not Persisted (Disposable)";
    persistStatus.className = isPersisted ? "status granted" : "status unsupported";
    logEvent(`Persistent storage initial state: ${isPersisted}`);
  });
}

btnPersist.addEventListener('click', () => {
  if (navigator.storage && navigator.storage.persist) {
    logEvent("Requesting browser to make PWA storage completely persistent...");
    navigator.storage.persist().then(granted => {
      persistStatus.textContent = granted ? "PERSISTED (Safeguarded)" : "Denied by Browser";
      persistStatus.className = granted ? "status granted" : "status denied";
      logEvent(`Persistent storage request result: ${granted}`);
    }).catch(err => {
      logEvent(`Persistent storage request crashed: ${err.message}`, true);
    });
  } else {
    logEvent("Storage Persistence API is missing.", true);
  }
});

// Screen Wake Lock Request
btnWake.addEventListener('click', async () => {
  if ('wakeLock' in navigator) {
    if (wakeLock !== null) {
      wakeLock.release().then(() => {
        wakeLock = null;
        wakeStatus.textContent = "Inactive";
        wakeStatus.className = "status unsupported";
        logEvent("Screen Wake Lock manually released.");
      });
      return;
    }
    logEvent("Requesting Wake Lock to keep screen on...");
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeStatus.textContent = "ACTIVE (Screen forced ON)";
      wakeStatus.className = "status granted";
      logEvent("Wake Lock acquired successfully. Screen will not sleep.");
      
      wakeLock.addEventListener('release', () => {
        logEvent("Wake Lock system released.");
      });
    } catch (err) {
      wakeStatus.textContent = "FAILED";
      wakeStatus.className = "status denied";
      logEvent(`Wake lock request failed: ${err.message}`, true);
    }
  } else {
    wakeStatus.textContent = "UNSUPPORTED";
    wakeStatus.className = "status unsupported";
    logEvent("Screen Wake Lock API is completely unsupported.", true);
  }
});


// Copy log text block to clipboard
const btnCopyLog = document.getElementById('btn-copy-log');
btnCopyLog.addEventListener('click', () => {
  const fullLogText = logs.join('\n');
  navigator.clipboard.writeText(fullLogText)
    .then(() => {
      const originalText = btnCopyLog.textContent;
      btnCopyLog.textContent = "Copied!";
      btnCopyLog.style.background = "#55ff55";
      btnCopyLog.style.color = "#000";
      logEvent("All system logs successfully copied to clipboard.");
      setTimeout(() => {
        btnCopyLog.textContent = originalText;
        btnCopyLog.style.background = "#ff5555";
        btnCopyLog.style.color = "#fff";
      }, 1500);
    })
    .catch(err => {
      alert("Failed to copy. Manually copy the log box below.");
      logEvent(`Failed to write clipboard: ${err.message}`, true);
    });
});