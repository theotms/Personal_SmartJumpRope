// ===== BLE UUIDs (choose once, match ESP32 firmware) =====
const JR_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const JR_CTRL_UUID    = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const JR_DATA_UUID    = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

let device, server, ctrlChar, dataChar;
const CALIBRATION_MS = 3000;
const STOP_QUIET_MS = 600;
const STOP_TIMEOUT_MS = 3000;

// ---- Simple workout state (no users) ----
const workout = {
    active: false,
    startMs: 0,
    lastJumpCount: 0,
    hrSamples: [],
    maxHr: 0,
    deviceName: "JRope-C6",
};

let lastPacketRxMs = 0;
let countdownTimer = null;

function nowMs() {
    return Date.now();
}

function isoFromMs(ms) {
    return new Date(ms).toISOString();
}

function averageInt(arr) {
    if (!arr.length) return null;
    const sum = arr.reduce((a, b) => a + b, 0);
    return Math.round(sum / arr.length);
}

function setStatus(msg) {
    const el = document.getElementById("bleStatus");
    if (el) el.textContent = msg;
}

function enableControls(connected) {
    const start = document.getElementById("btnStart");
    const stop = document.getElementById("btnStop");
    if (start) start.disabled = !connected;
    if (stop) stop.disabled = !connected;
}

async function connectBLE() {
    if (!navigator.bluetooth) {
        setStatus("Web Bluetooth not supported in this browser.");
        return;
    }

    setStatus("Requesting device...");
    device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [JR_SERVICE_UUID] }],
    });

    device.addEventListener("gattserverdisconnected", () => {
        setStatus("Disconnected");
        enableControls(false);
    });

    setStatus("Connecting...");
    server = await device.gatt.connect();

    const service = await server.getPrimaryService(JR_SERVICE_UUID);
    ctrlChar = await service.getCharacteristic(JR_CTRL_UUID);
    dataChar = await service.getCharacteristic(JR_DATA_UUID);

    await dataChar.startNotifications();
    dataChar.addEventListener("characteristicvaluechanged", onData);

    setStatus("Connected");
    enableControls(true);
}

function onData(event) {
    const v = event.target.value; // DataView
    if (!v || v.byteLength < 12) {
        console.warn("BLE packet too short", v ? v.byteLength : 0);
        setStatus("Invalid BLE packet");
        return;
    }

    const ts = v.getUint32(0, true);
    const jumps = v.getUint32(4, true);
    const hr = v.getUint8(8);
    const spo2 = v.getUint16(9, true);
    const flags = v.getUint8(11);
    lastPacketRxMs = nowMs();

    // Update UI
    const jumpsEl = document.getElementById("jumpCount");
    const hrEl = document.getElementById("heartRate");
    const spo2El = document.getElementById("spo2");

    if (jumpsEl) jumpsEl.textContent = String(jumps);
    if (hrEl) hrEl.textContent = hr === 0 ? "-" : String(hr);
    if (spo2El) spo2El.textContent = spo2 === 0 ? "-" : String(spo2);

    // Track for saving later
    workout.lastJumpCount = jumps;
    if (workout.active && typeof hr === "number" && hr > 0) {
        workout.hrSamples.push(hr);
        if (hr > workout.maxHr) workout.maxHr = hr;
    }

    if ((flags & (1 << 2)) !== 0) {
        setStatus("Calibrating... Start jumping in a moment");
    } else if (workout.active) {
        setStatus("Workout running");
    }

    console.log({ ts, jumps, hr, spo2, flags });
}

async function startStreaming() {
    if (!ctrlChar) return;
    await ctrlChar.writeValue(Uint8Array.from([0x01]));
}

async function stopStreaming() {
    if (!ctrlChar) return;
    await ctrlChar.writeValue(Uint8Array.from([0x00]));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function showCalibrationCountdown() {
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }

    const start = nowMs();
    const tick = () => {
        const elapsed = nowMs() - start;
        const remaining = Math.max(0, CALIBRATION_MS - elapsed);
        const secondsLeft = Math.ceil(remaining / 1000);

        if (remaining > 0) {
            setStatus(`Calibrating... start jumping in ${secondsLeft}`);
            return;
        }

        setStatus("Workout running");
        clearInterval(countdownTimer);
        countdownTimer = null;
    };

    tick();
    countdownTimer = setInterval(tick, 200);
}

async function waitForBleQuiet(quietMs = STOP_QUIET_MS, timeoutMs = STOP_TIMEOUT_MS) {
    const begin = nowMs();
    while (nowMs() - begin < timeoutMs) {
        const idleFor = nowMs() - lastPacketRxMs;
        if (idleFor >= quietMs) {
            return;
        }
        await sleep(100);
    }
}

function startWorkout() {
    workout.active = true;
    workout.startMs = nowMs();
    workout.hrSamples = [];
    workout.maxHr = 0;
    workout.lastJumpCount = 0;
}

async function saveWorkoutToDb() {
    const endMs = nowMs();
    const durationMs = endMs - workout.startMs;

    const avgHr = averageInt(workout.hrSamples);
    const maxHr = workout.hrSamples.length ? workout.maxHr : null;

    const payload = {
        start_time: isoFromMs(workout.startMs),
        end_time: isoFromMs(endMs),
        duration_ms: durationMs,
        jump_count: workout.lastJumpCount,
        avg_heart_rate_bpm: avgHr,
        max_heart_rate_bpm: maxHr,
        device_name: workout.deviceName,
    };

    const res = await fetch("/api/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
    }

    return json.workout;
}

async function handleStartClick() {
    try {
        await startStreaming();
        startWorkout();
        showCalibrationCountdown();
    } catch (e) {
        setStatus(String(e));
    }
}

async function handleStopClick() {
    try {
        await stopStreaming();
        await waitForBleQuiet();
        workout.active = false;

        // Save workout to DB
        await saveWorkoutToDb();

        // If history.js is present, refresh the table
        if (typeof window.renderHistory === "function") {
            window.renderHistory().catch(() => {});
        }

        // Optional: reset UI
        const jump_counts = document.getElementById("jumpCount");
        const hr = document.getElementById("heartRate");
        const spo2 = document.getElementById("spo2");

        if (jump_counts) jump_counts.textContent = "0";
        if (hr) hr.textContent = "-";
        if (spo2) spo2.textContent = "-";
    } catch (e) {
        setStatus(String(e));
    }
}

function initBLE() {
    const btnConnect = document.getElementById("btnConnect");
    const btnStart = document.getElementById("btnStart");
    const btnStop = document.getElementById("btnStop");

    if (btnConnect) btnConnect.addEventListener("click", () => connectBLE().catch(e => setStatus(String(e))));
    if (btnStart) btnStart.addEventListener("click", () => handleStartClick());
    if (btnStop) btnStop.addEventListener("click", () => handleStopClick());

    setStatus("Disconnected");
    enableControls(false);
}

document.addEventListener("DOMContentLoaded", initBLE);
