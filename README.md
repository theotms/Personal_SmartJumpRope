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
