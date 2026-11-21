# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-21

Initial public release.

### Added
- `cost_status` agent tool reporting peak/off-peak, cache estimation, Beijing time, next transition, and holiday data coverage.
- Always-visible cost badge (web GUI and desktop app; positioned below the Window Controls Overlay in the desktop shell).
- `Cost Guard` sidebar tab with live details and configuration (cache TTL, extra holidays).
- Peak/off-peak detection in Beijing time (UTC+8, no DST): Mon–Fri, 09:00–12:00 and 14:00–18:00.
- Built-in Chinese national holidays for 2025–2027 (State Council `gov.cn` notices), with a `holidayData` coverage flag.
- Context-cache estimation heuristic based on recent tab activity (default 60 min TTL).
- 42 unit tests covering peak windows, holidays, transitions, cache estimation, and plugin shape.
