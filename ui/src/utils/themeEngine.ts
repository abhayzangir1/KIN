/**
 * KIN Desktop Theme & Customization Engine
 * Implements the 60-30-10 visual rule with frosted glassmorphism,
 * dynamic CSS variables, Google Fonts injection, and Aurora mesh gradients.
 */

export type ThemeMode = 'dark' | 'light';
export type ThemePreset = 'ocean-haze' | 'sky-blue' | 'aurora' | 'obsidian' | 'custom';
export type GlassIntensity = 'none' | 'subtle' | 'medium' | 'vivid';
export type ContrastMode = 'standard' | 'high' | 'soft';

export interface ThemeSettings {
  mode: ThemeMode;
  preset: ThemePreset;
  bgColor: string;          // 60% Dominant Canvas
  surfaceColor: string;     // 30% Secondary Surfaces
  accentColor: string;      // 10% Focus / Highlight Accent
  textColor: string;        // High-contrast primary text
  borderColor: string;      // Hairline container boundary
  mutedColor: string;       // Secondary / caption text
  fontFamily: string;       // Font family stack
  auroraBackground: boolean;// Semi-transparent aurora gradient
  glassmorphism: GlassIntensity; // Frosted glass intensity
  contrast: ContrastMode;   // Contrast profile
}

export interface FontOption {
  id: string;
  name: string;
  family: string;
  googleFont?: string;
  category: 'sans' | 'mono';
}

export const AVAILABLE_FONTS: FontOption[] = [
  {
    id: 'system',
    name: 'System Default',
    family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', Helvetica, Arial, sans-serif",
    category: 'sans',
  },
  {
    id: 'inter',
    name: 'Inter',
    family: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    googleFont: 'Inter:wght@400;500;600;700',
    category: 'sans',
  },
  {
    id: 'jakarta',
    name: 'Plus Jakarta Sans',
    family: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    googleFont: 'Plus+Jakarta+Sans:wght@400;500;600;700',
    category: 'sans',
  },
  {
    id: 'outfit',
    name: 'Outfit',
    family: "'Outfit', -apple-system, BlinkMacSystemFont, sans-serif",
    googleFont: 'Outfit:wght@400;500;600;700',
    category: 'sans',
  },
  {
    id: 'geist',
    name: 'Geist Sans',
    family: "'Geist', -apple-system, BlinkMacSystemFont, sans-serif",
    googleFont: 'Geist:wght@400;500;600;700',
    category: 'sans',
  },
  {
    id: 'jetbrains',
    name: 'JetBrains Mono',
    family: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    googleFont: 'JetBrains+Mono:wght@400;500;600;700',
    category: 'mono',
  },
];

export const ACCENT_SWATCHES = [
  { name: 'Electric Cyan', hex: '#00d2ff' },
  { name: 'Sky Azure', hex: '#38bdf8' },
  { name: 'Cerulean Blue', hex: '#0284c7' },
  { name: 'Emerald Pine', hex: '#10b981' },
  { name: 'Royal Violet', hex: '#8b5cf6' },
  { name: 'Sunset Amber', hex: '#f59e0b' },
  { name: 'Rose Bloom', hex: '#f43f5e' },
  { name: 'Neo Mint', hex: '#14b8a6' },
];

/**
 * Default Presets adhering strictly to 60-30-10 visual rule
 */
export const THEME_PRESETS: Record<Exclude<ThemePreset, 'custom'>, ThemeSettings> = {
  // Default Dark: Deep Ocean Haze (60% #0b1326, 30% #132247, 10% #00d2ff)
  'ocean-haze': {
    mode: 'dark',
    preset: 'ocean-haze',
    bgColor: '#0b1326',
    surfaceColor: '#132247',
    accentColor: '#00d2ff',
    textColor: '#f1f5f9',
    borderColor: 'rgba(56, 189, 248, 0.16)',
    mutedColor: '#94a3b8',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    auroraBackground: true,
    glassmorphism: 'medium',
    contrast: 'standard',
  },
  // Default Light: Light Sky Blue (60% #eef6fc, 30% #ffffff, 10% #0284c7)
  'sky-blue': {
    mode: 'light',
    preset: 'sky-blue',
    bgColor: '#eef6fc',
    surfaceColor: '#ffffff',
    accentColor: '#0284c7',
    textColor: '#0f172a',
    borderColor: 'rgba(2, 132, 199, 0.20)',
    mutedColor: '#475569',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    auroraBackground: true,
    glassmorphism: 'medium',
    contrast: 'standard',
  },
  // Aurora Borealis (Dark Emerald Haze)
  'aurora': {
    mode: 'dark',
    preset: 'aurora',
    bgColor: '#07151e',
    surfaceColor: '#0e2a3b',
    accentColor: '#10b981',
    textColor: '#ecfdf5',
    borderColor: 'rgba(16, 185, 129, 0.24)',
    mutedColor: '#6ee7b7',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    auroraBackground: true,
    glassmorphism: 'vivid',
    contrast: 'standard',
  },
  // Obsidian OLED (Pure Deep Dark)
  'obsidian': {
    mode: 'dark',
    preset: 'obsidian',
    bgColor: '#050507',
    surfaceColor: '#101117',
    accentColor: '#38bdf8',
    textColor: '#f9fafb',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    mutedColor: '#9ca3af',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    auroraBackground: false,
    glassmorphism: 'none',
    contrast: 'standard',
  },
};

const THEME_STORAGE_KEY = 'kin_theme_settings';

/**
 * Load persisted theme settings or initialize with Deep Ocean Haze / Light Sky Blue default
 */
export function loadInitialThemeSettings(): ThemeSettings {
  if (typeof window === 'undefined') {
    return THEME_PRESETS['ocean-haze'];
  }

  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.mode) {
        return {
          ...THEME_PRESETS[parsed.mode === 'light' ? 'sky-blue' : 'ocean-haze'],
          ...parsed,
        };
      }
    }
    // Backward compatibility with legacy 'kin_theme' key
    const legacy = localStorage.getItem('kin_theme');
    if (legacy === 'light') {
      return THEME_PRESETS['sky-blue'];
    }
  } catch (err) {
    console.warn('[ThemeEngine] Failed to load settings from localStorage:', err);
  }

  return THEME_PRESETS['ocean-haze'];
}

/**
 * Persist theme settings to localStorage
 */
export function saveThemeSettings(settings: ThemeSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem('kin_theme', settings.mode);
  } catch (err) {
    console.warn('[ThemeEngine] Failed to save settings to localStorage:', err);
  }
}

/**
 * Dynamically inject Google Fonts stylesheet for selected font
 */
function ensureFontLoaded(fontFamilyId: string): void {
  if (typeof document === 'undefined') return;
  const font = AVAILABLE_FONTS.find((f) => f.id === fontFamilyId || f.family === fontFamilyId);
  if (!font?.googleFont) return;

  const linkId = `kin-font-${font.id}`;
  if (document.getElementById(linkId)) return;

  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${font.googleFont}&display=swap`;
  document.head.appendChild(link);
}

/**
 * Convert hex/rgb to subtle hover and secondary alpha variations
 */
function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith('rgba')) return hex;
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) return hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Apply theme variables directly to document root with instant visual reactivity
 */
export function applyThemeToDom(settings: ThemeSettings): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const body = document.body;

  // Toggle dark/light class
  if (settings.mode === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.add('light');
    root.classList.remove('dark');
  }

  // Set Core 60-30-10 Colors
  root.style.setProperty('--kin-bg', settings.bgColor);
  root.style.setProperty('--kin-surface', settings.surfaceColor);
  root.style.setProperty('--kin-card', settings.surfaceColor);
  root.style.setProperty('--kin-primary', settings.accentColor);
  root.style.setProperty('--kin-accent', settings.accentColor);
  root.style.setProperty('--kin-text', settings.textColor);
  root.style.setProperty('--kin-muted', settings.mutedColor);

  // Border & Contrast Handling
  let finalBorder = settings.borderColor;
  if (settings.contrast === 'high') {
    finalBorder = settings.mode === 'dark' ? 'rgba(255, 255, 255, 0.28)' : 'rgba(0, 0, 0, 0.32)';
  } else if (settings.contrast === 'soft') {
    finalBorder = settings.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
  }
  root.style.setProperty('--kin-border', finalBorder);
  root.style.setProperty('--kin-borderSubtle', hexToRgba(settings.accentColor, 0.08));

  // Dynamic Hover Colors
  if (settings.mode === 'dark') {
    root.style.setProperty('--kin-surfaceHover', hexToRgba('#ffffff', 0.06));
    root.style.setProperty('--kin-cardHover', hexToRgba('#ffffff', 0.09));
  } else {
    root.style.setProperty('--kin-surfaceHover', hexToRgba('#000000', 0.04));
    root.style.setProperty('--kin-cardHover', hexToRgba('#000000', 0.06));
  }

  // Glassmorphism Blur & Opacity
  let glassBlur = '16px';
  let glassOpacity = '0.85';
  if (settings.glassmorphism === 'none') {
    glassBlur = '0px';
    glassOpacity = '1';
  } else if (settings.glassmorphism === 'subtle') {
    glassBlur = '8px';
    glassOpacity = '0.94';
  } else if (settings.glassmorphism === 'vivid') {
    glassBlur = '24px';
    glassOpacity = '0.72';
  }
  root.style.setProperty('--kin-glass-blur', glassBlur);
  root.style.setProperty('--kin-glass-opacity', glassOpacity);

  // Font Stack
  const fontOpt = AVAILABLE_FONTS.find((f) => f.family === settings.fontFamily || f.name === settings.fontFamily);
  if (fontOpt) {
    ensureFontLoaded(fontOpt.id);
    root.style.setProperty('--kin-font-family', fontOpt.family);
    body.style.fontFamily = fontOpt.family;
  } else if (settings.fontFamily) {
    root.style.setProperty('--kin-font-family', settings.fontFamily);
    body.style.fontFamily = settings.fontFamily;
  }

  // Aurora Background Mesh
  if (settings.auroraBackground) {
    body.classList.add('kin-aurora-bg');
    root.classList.add('kin-aurora-bg');
  } else {
    body.classList.remove('kin-aurora-bg');
    root.classList.remove('kin-aurora-bg');
  }
}
