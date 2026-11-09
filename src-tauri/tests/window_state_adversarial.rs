// ============================================================================
// EMPIRICAL CHALLENGER ADVERSARIAL STRESS TEST: WINDOW STATE RESILIENCE
// Tests native Rust WindowState serde resilience under:
// 1. Malformed JSON payloads (truncated, garbage binary, empty string, wrong types)
// 2. Out-of-bounds coordinates (negative x/y, extreme offsets)
// 3. Oversized and sub-minimum dimensions (0, negative u32 overflow, u32::MAX)
// 4. Safe recovery & clamping invariants
// ============================================================================

use kin_lib::WindowState;

#[test]
fn test_window_state_malformed_json_resilience() {
    let malformed_payloads = vec![
        "",                                         // Empty string
        "   ",                                      // Whitespace only
        "{",                                        // Truncated object
        "{\"x\": 100, \"y\": 200",                  // Incomplete JSON
        "null",                                     // JSON null
        "[]",                                       // Array instead of object
        "\"string payload\"",                       // String instead of object
        "12345",                                    // Number instead of object
        "{\"x\": \"not-a-number\"}",                // Type mismatch
        "{\"x\": 100, \"y\": 200, \"width\": -50}", // Negative unsigned integer
        "{\"x\": 100, \"y\": 200, \"width\": 800}", // Missing required fields
        "{corrupted: true}",                        // Invalid JSON syntax
        "\x00\x01\x02\x7E\x7F",                    // Raw binary control bytes
    ];

    for payload in malformed_payloads {
        let result = serde_json::from_str::<WindowState>(payload);
        assert!(
            result.is_err(),
            "Expected malformed payload to fail deserialization safely without panic: '{}'",
            payload
        );
    }

    // Raw invalid UTF-8 bytes via serde_json::from_slice
    let raw_binary_garbage: &[u8] = &[0x00, 0x01, 0x02, 0xFF, 0xFE, 0xAA];
    let slice_result = serde_json::from_slice::<WindowState>(raw_binary_garbage);
    assert!(slice_result.is_err(), "Expected raw binary slice to fail deserialization safely");
}

#[test]
fn test_window_state_roundtrip_serialization_fidelity() {
    let valid_state = WindowState {
        x: 150,
        y: 250,
        width: 1920,
        height: 1080,
        is_maximized: false,
    };

    let serialized = serde_json::to_string_pretty(&valid_state)
        .expect("Serialization of valid WindowState must succeed");
    
    let deserialized: WindowState = serde_json::from_str(&serialized)
        .expect("Deserialization of serialized WindowState must succeed");

    assert_eq!(deserialized.x, 150);
    assert_eq!(deserialized.y, 250);
    assert_eq!(deserialized.width, 1920);
    assert_eq!(deserialized.height, 1080);
    assert!(!deserialized.is_maximized);
}

#[test]
fn test_window_state_boundary_and_out_of_bounds_resilience() {
    // Negative x/y coordinates (valid in multi-monitor setups, but out-of-bounds for primary)
    let negative_pos_json = r#"{
        "x": -1920,
        "y": -1080,
        "width": 1440,
        "height": 900,
        "is_maximized": true
    }"#;

    let res = serde_json::from_str::<WindowState>(negative_pos_json);
    assert!(res.is_ok(), "Negative signed coordinates must parse without error into i32");
    let state = res.unwrap();
    assert_eq!(state.x, -1920);
    assert_eq!(state.y, -1080);
    assert!(state.is_maximized);

    // Clamping oracle function
    fn clamp_window_state(s: WindowState, min_w: u32, min_h: u32, max_w: u32, max_h: u32) -> WindowState {
        WindowState {
            x: s.x.max(0),
            y: s.y.max(0),
            width: s.width.clamp(min_w, max_w),
            height: s.height.clamp(min_h, max_h),
            is_maximized: s.is_maximized,
        }
    }

    let clamped = clamp_window_state(state, 800, 600, 3840, 2160);
    assert_eq!(clamped.x, 0, "Negative x must clamp to safe 0 coordinate");
    assert_eq!(clamped.y, 0, "Negative y must clamp to safe 0 coordinate");
    assert_eq!(clamped.width, 1440);
    assert_eq!(clamped.height, 900);

    // Sub-minimum and oversized dimensions
    let extreme_json = r#"{
        "x": 50,
        "y": 50,
        "width": 100,
        "height": 50,
        "is_maximized": false
    }"#;
    let extreme_state: WindowState = serde_json::from_str(extreme_json).unwrap();
    let clamped_min = clamp_window_state(extreme_state, 800, 600, 3840, 2160);
    assert_eq!(clamped_min.width, 800, "Sub-minimum width must clamp to 800");
    assert_eq!(clamped_min.height, 600, "Sub-minimum height must clamp to 600");

    // Extreme oversized dimensions
    let huge_json = r#"{
        "x": 0,
        "y": 0,
        "width": 100000,
        "height": 50000,
        "is_maximized": false
    }"#;
    let huge_state: WindowState = serde_json::from_str(huge_json).unwrap();
    let clamped_max = clamp_window_state(huge_state, 800, 600, 3840, 2160);
    assert_eq!(clamped_max.width, 3840, "Oversized width must clamp to 3840");
    assert_eq!(clamped_max.height, 2160, "Oversized height must clamp to 2160");
}

#[test]
fn test_native_clamp_window_state_to_monitors() {
    use kin_lib::{clamp_window_state_to_monitors, MonitorRect, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH};

    let primary_monitor = MonitorRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };
    let secondary_monitor = MonitorRect {
        x: 1920,
        y: 0,
        width: 1920,
        height: 1080,
    };
    let monitors = vec![primary_monitor, secondary_monitor];

    // Case 1: Sub-minimum dimensions should be clamped to MIN_WINDOW_WIDTH (1000) and MIN_WINDOW_HEIGHT (650)
    let tiny_state = WindowState {
        x: 100,
        y: 100,
        width: 400,
        height: 300,
        is_maximized: false,
    };
    let clamped_tiny = clamp_window_state_to_monitors(tiny_state, &monitors);
    assert_eq!(clamped_tiny.width, MIN_WINDOW_WIDTH);
    assert_eq!(clamped_tiny.height, MIN_WINDOW_HEIGHT);
    assert_eq!(clamped_tiny.x, 100);
    assert_eq!(clamped_tiny.y, 100);

    // Case 1b: Absolute zero dimensions (0x0) clamped to MIN_WINDOW_WIDTH (1000) and MIN_WINDOW_HEIGHT (650)
    let zero_state = WindowState {
        x: 50,
        y: 50,
        width: 0,
        height: 0,
        is_maximized: false,
    };
    let clamped_zero = clamp_window_state_to_monitors(zero_state, &monitors);
    assert_eq!(clamped_zero.width, MIN_WINDOW_WIDTH);
    assert_eq!(clamped_zero.height, MIN_WINDOW_HEIGHT);
    assert_eq!(clamped_zero.x, 50);
    assert_eq!(clamped_zero.y, 50);

    // Case 2: Window completely off-screen (e.g. was on a 3rd monitor that got disconnected)
    let offscreen_state = WindowState {
        x: 6000,
        y: 3000,
        width: 1400,
        height: 900,
        is_maximized: false,
    };
    let clamped_offscreen = clamp_window_state_to_monitors(offscreen_state, &monitors);
    // Should be recentered onto primary monitor (0, 0)
    assert!(clamped_offscreen.x >= 0 && clamped_offscreen.x < 1920);
    assert!(clamped_offscreen.y >= 0 && clamped_offscreen.y < 1080);
    assert_eq!(clamped_offscreen.width, 1400);
    assert_eq!(clamped_offscreen.height, 900);

    // Case 3: Empty monitors fallback
    let fallback = clamp_window_state_to_monitors(
        WindowState {
            x: -50,
            y: -20,
            width: 800,
            height: 500,
            is_maximized: true,
        },
        &[],
    );
    assert_eq!(fallback.x, 0);
    assert_eq!(fallback.y, 0);
    assert_eq!(fallback.width, MIN_WINDOW_WIDTH);
    assert_eq!(fallback.height, MIN_WINDOW_HEIGHT);
    assert!(fallback.is_maximized);
}
