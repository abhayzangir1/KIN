import React from 'react';
import { useKinStore } from '../../store/kinStore.js';
import {
  AVAILABLE_FONTS,
  ACCENT_SWATCHES,
  ThemePreset,
  GlassIntensity,
  ContrastMode,
} from '../../utils/themeEngine.js';
import {
  Palette,
  Sun,
  Moon,
  Sparkles,
  Check,
  RotateCcw,
  Sliders,
  Type,
  Eye,
  Layers,
  Sparkle,
} from 'lucide-react';

export const AppearanceTab: React.FC = () => {
  const {
    themeSettings,
    setThemeSettings,
    setThemePreset,
    resetThemeSettings,
    addToast,
  } = useKinStore();

  const handleColorChange = (key: 'bgColor' | 'surfaceColor' | 'accentColor' | 'textColor' | 'borderColor', val: string) => {
    setThemeSettings({ [key]: val, preset: 'custom' });
  };

  const handlePresetSelect = (preset: ThemePreset) => {
    setThemePreset(preset);
    addToast(`Theme preset set to ${preset === 'ocean-haze' ? 'Deep Ocean Haze' : preset === 'sky-blue' ? 'Light Sky Blue' : preset}`, 'info');
  };

  return (
    <div className="space-y-6 select-none font-sans pb-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-kin-border">
        <div>
          <h3 className="text-sm font-bold text-kin-text flex items-center space-x-2">
            <Palette className="w-4 h-4 text-kin-accent" />
            <span>Theme & Appearance Studio</span>
          </h3>
          <p className="text-xs text-kin-muted mt-0.5">
            Precision 60-30-10 visual rule architecture, frosted glassmorphism, Aurora mesh gradients, and customizable typography.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            resetThemeSettings();
            addToast('Reset appearance settings to default 60-30-10 palette', 'info');
          }}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-kin-card hover:bg-kin-cardHover border border-kin-border text-kin-muted hover:text-kin-text text-xs transition cursor-pointer"
          title="Restore factory default colors and typography"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Defaults</span>
        </button>
      </div>

      {/* SECTION 1: THEME PRESETS (60-30-10 Visual Architecture) */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-kin-text flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-kin-accent" />
            <span>Curated Theme Presets (60-30-10 Rule)</span>
          </label>
          <span className="text-[10px] text-kin-muted font-mono">
            Active: {themeSettings.preset.toUpperCase()}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Preset 1: Deep Ocean Haze (Default Dark) */}
          <button
            type="button"
            onClick={() => handlePresetSelect('ocean-haze')}
            className={`p-3.5 rounded-xl border text-left transition relative cursor-pointer group ${
              themeSettings.preset === 'ocean-haze'
                ? 'bg-kin-card border-kin-accent shadow-sm ring-1 ring-kin-accent/40'
                : 'bg-kin-card/60 hover:bg-kin-card border-kin-border hover:border-kin-borderSubtle'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-1.5">
                <Moon className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold text-kin-text">Deep Ocean Haze</span>
              </div>
              {themeSettings.preset === 'ocean-haze' && (
                <Check className="w-4 h-4 text-cyan-400" />
              )}
            </div>
            <div className="flex items-center space-x-1 mb-2">
              <span className="w-4 h-4 rounded-full bg-[#0b1326] border border-cyan-500/30" title="60% Canvas (#0b1326)" />
              <span className="w-4 h-4 rounded-full bg-[#132247] border border-cyan-500/30" title="30% Surfaces (#132247)" />
              <span className="w-4 h-4 rounded-full bg-[#00d2ff]" title="10% Accent (#00d2ff)" />
              <span className="text-[9px] font-mono text-kin-muted ml-1">60/30/10</span>
            </div>
            <p className="text-[11px] text-kin-muted leading-tight">
              Default dark canvas. Deep ocean navy, frosted slate, and electric marine azure.
            </p>
          </button>

          {/* Preset 2: Light Sky Blue (Default Light) */}
          <button
            type="button"
            onClick={() => handlePresetSelect('sky-blue')}
            className={`p-3.5 rounded-xl border text-left transition relative cursor-pointer group ${
              themeSettings.preset === 'sky-blue'
                ? 'bg-kin-card border-kin-accent shadow-sm ring-1 ring-kin-accent/40'
                : 'bg-kin-card/60 hover:bg-kin-card border-kin-border hover:border-kin-borderSubtle'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-1.5">
                <Sun className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-bold text-kin-text">Light Sky Blue</span>
              </div>
              {themeSettings.preset === 'sky-blue' && (
                <Check className="w-4 h-4 text-sky-600" />
              )}
            </div>
            <div className="flex items-center space-x-1 mb-2">
              <span className="w-4 h-4 rounded-full bg-[#eef6fc] border border-sky-300" title="60% Canvas (#eef6fc)" />
              <span className="w-4 h-4 rounded-full bg-[#ffffff] border border-sky-300" title="30% Surfaces (#ffffff)" />
              <span className="w-4 h-4 rounded-full bg-[#0284c7]" title="10% Accent (#0284c7)" />
              <span className="text-[9px] font-mono text-kin-muted ml-1">60/30/10</span>
            </div>
            <p className="text-[11px] text-kin-muted leading-tight">
              Default light canvas. Airy morning sky blue, crisp cloud surfaces, and deep cerulean.
            </p>
          </button>

          {/* Preset 3: Aurora Borealis */}
          <button
            type="button"
            onClick={() => handlePresetSelect('aurora')}
            className={`p-3.5 rounded-xl border text-left transition relative cursor-pointer group ${
              themeSettings.preset === 'aurora'
                ? 'bg-kin-card border-emerald-500 shadow-sm ring-1 ring-emerald-500/40'
                : 'bg-kin-card/60 hover:bg-kin-card border-kin-border hover:border-kin-borderSubtle'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-1.5">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-kin-text">Aurora Borealis</span>
              </div>
              {themeSettings.preset === 'aurora' && (
                <Check className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <div className="flex items-center space-x-1 mb-2">
              <span className="w-4 h-4 rounded-full bg-[#07151e] border border-emerald-500/30" title="60% Canvas" />
              <span className="w-4 h-4 rounded-full bg-[#0e2a3b] border border-emerald-500/30" title="30% Surfaces" />
              <span className="w-4 h-4 rounded-full bg-[#10b981]" title="10% Accent" />
              <span className="text-[9px] font-mono text-kin-muted ml-1">60/30/10</span>
            </div>
            <p className="text-[11px] text-kin-muted leading-tight">
              Atmospheric night mode with emerald aurora glows and deep pine surfaces.
            </p>
          </button>

          {/* Preset 4: Obsidian OLED */}
          <button
            type="button"
            onClick={() => handlePresetSelect('obsidian')}
            className={`p-3.5 rounded-xl border text-left transition relative cursor-pointer group ${
              themeSettings.preset === 'obsidian'
                ? 'bg-kin-card border-sky-400 shadow-sm ring-1 ring-sky-400/40'
                : 'bg-kin-card/60 hover:bg-kin-card border-kin-border hover:border-kin-borderSubtle'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-1.5">
                <Moon className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-kin-text">Obsidian OLED</span>
              </div>
              {themeSettings.preset === 'obsidian' && (
                <Check className="w-4 h-4 text-sky-400" />
              )}
            </div>
            <div className="flex items-center space-x-1 mb-2">
              <span className="w-4 h-4 rounded-full bg-[#050507] border border-slate-700" title="60% Canvas" />
              <span className="w-4 h-4 rounded-full bg-[#101117] border border-slate-700" title="30% Surfaces" />
              <span className="w-4 h-4 rounded-full bg-[#38bdf8]" title="10% Accent" />
              <span className="text-[9px] font-mono text-kin-muted ml-1">60/30/10</span>
            </div>
            <p className="text-[11px] text-kin-muted leading-tight">
              True pitch black canvas for battery efficiency, high contrast, and OLED displays.
            </p>
          </button>
        </div>
      </div>

      {/* SECTION 2: LIVE PREVIEW & VISUAL DEPTH CARD */}
      <div className="p-4 rounded-xl bg-kin-card border border-kin-border space-y-3 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-kin-text flex items-center space-x-1.5">
            <Eye className="w-3.5 h-3.5 text-kin-accent" />
            <span>Live Component Hierarchy & Contrast Preview</span>
          </span>
          <div className="flex items-center space-x-2 text-[10px] font-mono text-kin-muted">
            <span>60% Bg</span>
            <span>•</span>
            <span>30% Surface</span>
            <span>•</span>
            <span style={{ color: themeSettings.accentColor }}>10% Accent</span>
          </div>
        </div>

        {/* Mock Live Canvas */}
        <div
          className="p-4 rounded-xl border transition-all space-y-3 kin-aurora-bg relative overflow-hidden"
          style={{
            backgroundColor: themeSettings.bgColor,
            borderColor: themeSettings.borderColor,
          }}
        >
          {/* Mock Header */}
          <div
            className="flex items-center justify-between p-2.5 rounded-lg border backdrop-blur-md"
            style={{
              backgroundColor: themeSettings.surfaceColor,
              borderColor: themeSettings.borderColor,
            }}
          >
            <div className="flex items-center space-x-2">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: themeSettings.accentColor }}
              />
              <span className="text-xs font-bold" style={{ color: themeSettings.textColor }}>
                #general
              </span>
              <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded uppercase font-semibold"
                style={{
                  backgroundColor: `${themeSettings.accentColor}25`,
                  color: themeSettings.accentColor,
                }}
              >
                Online
              </span>
            </div>
            <span className="text-[10px] font-mono" style={{ color: themeSettings.mutedColor }}>
              12:00 PM
            </span>
          </div>

          {/* Mock Chat Bubble */}
          <div
            className="p-3.5 rounded-xl border backdrop-blur-md space-y-2 shadow-xs"
            style={{
              backgroundColor: themeSettings.surfaceColor,
              borderColor: themeSettings.borderColor,
            }}
          >
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2">
                <span className="font-bold" style={{ color: themeSettings.textColor }}>
                  @Boss
                </span>
                <span
                  className="text-[9px] uppercase px-1.5 py-0.2 rounded font-mono font-semibold"
                  style={{
                    backgroundColor: `${themeSettings.accentColor}20`,
                    color: themeSettings.accentColor,
                  }}
                >
                  Workspace Orchestrator
                </span>
              </div>
              <span className="text-[10px] font-mono" style={{ color: themeSettings.mutedColor }}>
                Just now
              </span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: themeSettings.textColor }}>
              KIN workforce initialized. All models verified with balanced 60-30-10 color rules.
            </p>
            <div className="flex items-center space-x-2 pt-1">
              <button
                type="button"
                className="px-3 py-1 rounded-lg text-white font-semibold text-xs transition shadow-xs cursor-pointer"
                style={{ backgroundColor: themeSettings.accentColor }}
              >
                Action Button (10% Accent)
              </button>
              <span
                className="text-[10px] font-mono px-2 py-0.5 rounded border"
                style={{
                  color: themeSettings.mutedColor,
                  borderColor: themeSettings.borderColor,
                }}
              >
                Hairline Boundary
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3: COLOR CUSTOMIZER (60-30-10 RULE) */}
      <div className="p-4 rounded-xl bg-kin-card border border-kin-border space-y-4">
        <div>
          <h4 className="text-xs font-bold text-kin-text flex items-center space-x-1.5">
            <Sliders className="w-3.5 h-3.5 text-kin-accent" />
            <span>Color Tuning (60-30-10 Architecture)</span>
          </h4>
          <p className="text-[11px] text-kin-muted mt-0.5">
            Customize individual layers. Changes are instantly applied to all views with zero reload.
          </p>
        </div>

        {/* 10% Focus Accent Swatches */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-kin-text flex items-center justify-between">
            <span>10% Focus & Highlight Accent</span>
            <span className="text-[11px] font-mono text-kin-muted">{themeSettings.accentColor}</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_SWATCHES.map((swatch) => (
              <button
                key={swatch.hex}
                type="button"
                onClick={() => handleColorChange('accentColor', swatch.hex)}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition cursor-pointer ${
                  themeSettings.accentColor.toLowerCase() === swatch.hex.toLowerCase()
                    ? 'border-kin-text shadow-sm'
                    : 'border-kin-border hover:border-kin-borderSubtle'
                }`}
                style={{
                  backgroundColor: `${swatch.hex}15`,
                  color: swatch.hex,
                }}
              >
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: swatch.hex }}
                />
                <span>{swatch.name}</span>
                {themeSettings.accentColor.toLowerCase() === swatch.hex.toLowerCase() && (
                  <Check className="w-3 h-3 ml-0.5" />
                )}
              </button>
            ))}

            {/* Custom Accent HTML5 Picker */}
            <div className="flex items-center space-x-1.5 pl-1">
              <input
                type="color"
                value={themeSettings.accentColor.startsWith('#') ? themeSettings.accentColor : '#00d2ff'}
                onChange={(e) => handleColorChange('accentColor', e.target.value)}
                className="w-7 h-7 rounded border border-kin-border cursor-pointer bg-transparent p-0"
                title="Choose custom accent color"
              />
              <input
                type="text"
                value={themeSettings.accentColor}
                onChange={(e) => handleColorChange('accentColor', e.target.value)}
                placeholder="#00d2ff"
                className="w-20 px-2 py-1 rounded bg-kin-surface border border-kin-border text-xs font-mono text-kin-text focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* 60% Canvas, 30% Surface, Foreground, Border Inputs Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-kin-border">
          {/* 60% Canvas */}
          <div className="p-3 rounded-lg bg-kin-surface border border-kin-border space-y-1.5">
            <span className="text-xs font-semibold text-kin-text block">60% Base Canvas</span>
            <span className="text-[10px] text-kin-muted block">Root background atmosphere</span>
            <div className="flex items-center space-x-2 pt-1">
              <input
                type="color"
                value={themeSettings.bgColor.startsWith('#') ? themeSettings.bgColor : '#0b1326'}
                onChange={(e) => handleColorChange('bgColor', e.target.value)}
                className="w-7 h-7 rounded border border-kin-border cursor-pointer bg-transparent p-0 shrink-0"
              />
              <input
                type="text"
                value={themeSettings.bgColor}
                onChange={(e) => handleColorChange('bgColor', e.target.value)}
                className="w-full px-2 py-1 rounded bg-kin-card border border-kin-border text-xs font-mono text-kin-text focus:outline-none"
              />
            </div>
          </div>

          {/* 30% Surfaces */}
          <div className="p-3 rounded-lg bg-kin-surface border border-kin-border space-y-1.5">
            <span className="text-xs font-semibold text-kin-text block">30% Surface / Cards</span>
            <span className="text-[10px] text-kin-muted block">Sidebars & elevated panels</span>
            <div className="flex items-center space-x-2 pt-1">
              <input
                type="color"
                value={themeSettings.surfaceColor.startsWith('#') ? themeSettings.surfaceColor : '#132247'}
                onChange={(e) => handleColorChange('surfaceColor', e.target.value)}
                className="w-7 h-7 rounded border border-kin-border cursor-pointer bg-transparent p-0 shrink-0"
              />
              <input
                type="text"
                value={themeSettings.surfaceColor}
                onChange={(e) => handleColorChange('surfaceColor', e.target.value)}
                className="w-full px-2 py-1 rounded bg-kin-card border border-kin-border text-xs font-mono text-kin-text focus:outline-none"
              />
            </div>
          </div>

          {/* Primary Text */}
          <div className="p-3 rounded-lg bg-kin-surface border border-kin-border space-y-1.5">
            <span className="text-xs font-semibold text-kin-text block">High Contrast Text</span>
            <span className="text-[10px] text-kin-muted block">Readability & headings</span>
            <div className="flex items-center space-x-2 pt-1">
              <input
                type="color"
                value={themeSettings.textColor.startsWith('#') ? themeSettings.textColor : '#f1f5f9'}
                onChange={(e) => handleColorChange('textColor', e.target.value)}
                className="w-7 h-7 rounded border border-kin-border cursor-pointer bg-transparent p-0 shrink-0"
              />
              <input
                type="text"
                value={themeSettings.textColor}
                onChange={(e) => handleColorChange('textColor', e.target.value)}
                className="w-full px-2 py-1 rounded bg-kin-card border border-kin-border text-xs font-mono text-kin-text focus:outline-none"
              />
            </div>
          </div>

          {/* Hairline Borders */}
          <div className="p-3 rounded-lg bg-kin-surface border border-kin-border space-y-1.5">
            <span className="text-xs font-semibold text-kin-text block">Hairline Borders</span>
            <span className="text-[10px] text-kin-muted block">Structural separators</span>
            <div className="flex items-center space-x-2 pt-1">
              <input
                type="text"
                value={themeSettings.borderColor}
                onChange={(e) => handleColorChange('borderColor', e.target.value)}
                className="w-full px-2 py-1 rounded bg-kin-card border border-kin-border text-xs font-mono text-kin-text focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 4: AURORA MESH & FROSTED GLASS (NON-FLAT DEPTH) */}
      <div className="p-4 rounded-xl bg-kin-card border border-kin-border space-y-4">
        <div>
          <h4 className="text-xs font-bold text-kin-text flex items-center space-x-1.5">
            <Sparkle className="w-3.5 h-3.5 text-kin-accent" />
            <span>Atmospheric Depth & Frosted Glassmorphism</span>
          </h4>
          <p className="text-[11px] text-kin-muted mt-0.5">
            Semi-transparent radial Aurora glow and multi-layer backdrop blurs for a modern, non-flat desktop UI.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Aurora Mesh Toggle */}
          <div className="p-3.5 rounded-lg bg-kin-surface border border-kin-border flex items-center justify-between">
            <div className="space-y-0.5 pr-2">
              <span className="text-xs font-bold text-kin-text block">Aurora Mesh Background</span>
              <p className="text-[11px] text-kin-muted">
                Subtle radial atmospheric glow behind the workspace canvas.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const next = !themeSettings.auroraBackground;
                setThemeSettings({ auroraBackground: next });
              }}
              className={`w-12 h-6 rounded-full transition p-0.5 cursor-pointer flex items-center shrink-0 ${
                themeSettings.auroraBackground ? 'bg-cyan-500 justify-end' : 'bg-slate-600 justify-start'
              }`}
            >
              <div className="w-5 h-5 rounded-full bg-white shadow-xs" />
            </button>
          </div>

          {/* Frosted Glass Intensity */}
          <div className="p-3.5 rounded-lg bg-kin-surface border border-kin-border space-y-2">
            <span className="text-xs font-bold text-kin-text block">Frosted Glass Intensity</span>
            <div className="grid grid-cols-4 gap-1.5">
              {(['none', 'subtle', 'medium', 'vivid'] as GlassIntensity[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setThemeSettings({ glassmorphism: level })}
                  className={`py-1.5 rounded-md text-[10px] font-mono capitalize transition cursor-pointer text-center border ${
                    themeSettings.glassmorphism === level
                      ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400 font-bold'
                      : 'bg-kin-card border-kin-border text-kin-muted hover:text-kin-text'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 5: TYPOGRAPHY & FREE FONTS */}
      <div className="p-4 rounded-xl bg-kin-card border border-kin-border space-y-3">
        <div>
          <h4 className="text-xs font-bold text-kin-text flex items-center space-x-1.5">
            <Type className="w-3.5 h-3.5 text-kin-accent" />
            <span>Typography & Free Font Families</span>
          </h4>
          <p className="text-[11px] text-kin-muted mt-0.5">
            High-legibility fonts loaded dynamically with zero latency.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {AVAILABLE_FONTS.map((font) => (
            <button
              key={font.id}
              type="button"
              onClick={() => {
                setThemeSettings({ fontFamily: font.family });
                addToast(`Typography font set to ${font.name}`, 'info');
              }}
              className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                themeSettings.fontFamily === font.family || (font.id === 'system' && !themeSettings.fontFamily.includes('Inter'))
                  ? 'bg-kin-surface border-kin-accent text-kin-text ring-1 ring-kin-accent/40 shadow-xs'
                  : 'bg-kin-surface/60 hover:bg-kin-surface border-kin-border text-kin-muted hover:text-kin-text'
              }`}
              style={{ fontFamily: font.family }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold truncate">{font.name}</span>
                {(themeSettings.fontFamily === font.family || (font.id === 'system' && !themeSettings.fontFamily.includes('Inter'))) && (
                  <Check className="w-3.5 h-3.5 text-kin-accent" />
                )}
              </div>
              <p className="text-[11px] opacity-80">
                Aa Bb Gg 123
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* SECTION 6: CONTRAST & ACCESSIBILITY */}
      <div className="p-4 rounded-xl bg-kin-card border border-kin-border space-y-3">
        <div>
          <h4 className="text-xs font-bold text-kin-text flex items-center space-x-1.5">
            <Eye className="w-3.5 h-3.5 text-kin-accent" />
            <span>Contrast & Ergonomic Profiles</span>
          </h4>
          <p className="text-[11px] text-kin-muted mt-0.5">
            Calibrate contrast balance for intense coding sessions or bright environments.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(
            [
              { id: 'standard', name: 'Standard (Balanced)', desc: 'Balanced 60-30-10 ratio with soft hairlines' },
              { id: 'high', name: 'High Contrast (WCAG AAA)', desc: 'Crisp borders and ultra-clear foreground text' },
              { id: 'soft', name: 'Soft / Eye-Soothing', desc: 'Lower strain edges for extended night sessions' },
            ] as const
          ).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setThemeSettings({ contrast: c.id as ContrastMode })}
              className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                themeSettings.contrast === c.id
                  ? 'bg-kin-surface border-kin-accent text-kin-text ring-1 ring-kin-accent/40 shadow-xs'
                  : 'bg-kin-surface/60 hover:bg-kin-surface border-kin-border text-kin-muted hover:text-kin-text'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold">{c.name}</span>
                {themeSettings.contrast === c.id && (
                  <Check className="w-3.5 h-3.5 text-kin-accent" />
                )}
              </div>
              <p className="text-[11px] text-kin-muted leading-tight">{c.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
