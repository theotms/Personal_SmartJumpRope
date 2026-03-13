# System Block Diagram

```mermaid
flowchart LR
  subgraph FW[ESP32-C6 Firmware]
    A[MPU6050 Gyro/Accel
components/gyro] --> B[SensorReading Task]
    B --> C[JumpDetector
main/jumpDetectionTask]
    D[MAX30102 HR/SpO2
components/heartbeatSensor] --> E[heartRateTask + RF Algorithm]
    C --> F[Shared Metrics
(jumps, rates)]
    E --> G[Shared Vitals
(HR, SpO2)]
    F --> H[displayTask]
    G --> H
    F --> I[bleUpdateTask]
    G --> I
    H --> J[OLED Display
components/display]
    I --> K[jr_ble service
components/ble]
  end

  K <--> L[Web App (Web Bluetooth)
app/public/ble.js]
  L --> M[UI Dashboard
app/public/data.html]
  L --> N[Express API
app/private/webApp.js]
  N <--> O[SQLite DB
app/private/data_base.js]
```


# Recent Updates

## BLE/Web Data Contract Cleanup

- BLE packet field at offset `9` was renamed semantically from acceleration to SpO2.
- `jr_packet_v1_t` now uses `spo2_percent` instead of `accel_mag`.
- `jr_ble_set_sensor_snapshot(...)` parameter naming was updated to match SpO2 semantics.
- Flags comment updated to reflect `bit1=SpO2 valid`.

Files:

- `components/ble/jr_ble.h`
- `components/ble/jr_ble.cpp`

## Web BLE Parser Hardening

- Added packet-size guard in browser BLE handler: reject packets with `byteLength < 12`.
- On malformed packet, app now logs a warning and sets BLE status to `Invalid BLE packet` instead of crashing.

File:

- `app/public/ble.js`

## Web UI Label/Data Mapping Fix

- Live metric label changed from `Acceleration` to `SpO2`.
- UI now displays parsed SpO2 value from BLE offset `9`.

Files:

- `app/public/data.html`
- `app/public/ble.js`

## Quick Fix For Inflated Jump Totals

- Replaced summed multi-config jump total usage with one authoritative timing config for official jump count.
- Selected config is `200/200 ms` (index `2`) via `SELECTED_TIMING_CONFIG_INDEX`.
- OLED summary page and BLE `jump_count` now both use this selected config count.

File:

- `main/main.cpp`
