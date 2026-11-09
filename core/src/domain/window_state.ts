// ============================================================================
// KIN DOMAIN: TAURI WINDOW STATE VALIDATION & DESKTOP SHELL BOUNDS
// Aligned with src-tauri/src/lib.rs and tauri.conf.json.
// Enforces minWidth: 1000, minHeight: 650, and display boundary containment.
// ============================================================================

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  is_maximized: boolean;
}

export const MIN_WINDOW_WIDTH = 1000;
export const MIN_WINDOW_HEIGHT = 650;
export const DEFAULT_WINDOW_WIDTH = 1400;
export const DEFAULT_WINDOW_HEIGHT = 900;

export interface MonitorBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Validates and clamps a WindowState to ensure it conforms to minimum desktop shell dimensions
 * and lies within safe visible display monitor coordinates.
 */
export function validateAndClampWindowState(
  state: WindowState,
  monitors?: MonitorBounds[]
): WindowState {
  let width = Math.max(MIN_WINDOW_WIDTH, state.width || MIN_WINDOW_WIDTH);
  let height = Math.max(MIN_WINDOW_HEIGHT, state.height || MIN_WINDOW_HEIGHT);
  let x = state.x;
  let y = state.y;

  if (!monitors || monitors.length === 0) {
    return {
      x: Math.max(0, x),
      y: Math.max(0, y),
      width,
      height,
      is_maximized: Boolean(state.is_maximized),
    };
  }

  // Check if at least 100x100 pixels of the window intersects any connected monitor
  let onAnyMonitor = false;
  for (const m of monitors) {
    const mRight = m.x + m.width;
    const mBottom = m.y + m.height;
    const winRight = x + width;
    const winBottom = y + height;

    const overlapL = Math.max(x, m.x);
    const overlapT = Math.max(y, m.y);
    const overlapR = Math.min(winRight, mRight);
    const overlapB = Math.min(winBottom, mBottom);

    if (overlapR > overlapL + 100 && overlapB > overlapT + 100) {
      onAnyMonitor = true;
      break;
    }
  }

  if (!onAnyMonitor) {
    // Window off-screen: center onto primary monitor
    const primary = monitors[0];
    width = Math.max(MIN_WINDOW_WIDTH, Math.min(width, primary.width));
    height = Math.max(MIN_WINDOW_HEIGHT, Math.min(height, primary.height));
    x = primary.x + Math.floor(Math.max(0, primary.width - width) / 2);
    y = primary.y + Math.floor(Math.max(0, primary.height - height) / 2);
  }

  return {
    x,
    y,
    width,
    height,
    is_maximized: Boolean(state.is_maximized),
  };
}
