import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useKinStore } from '../store/kinStore.js';

export interface KeyboardShortcutOptions {
  isCommandPaletteOpen?: boolean;
  onToggleCommandPalette?: () => void;
  onCloseCommandPalette?: () => void;
}

/**
 * Global Keyboard Shortcuts Hook (Feature 33)
 * Provides centralized hotkeys:
 * - Cmd/Ctrl+K: Toggle Command Palette
 * - Cmd/Ctrl+B: Toggle Navigation Sidebar
 * - Cmd/Ctrl+I: Toggle Agent Inspector Pane
 * - Cmd/Ctrl+M: Toggle Swarm Map Topology
 * - Escape: Hierarchical dismiss (Modals -> Takeover Pause -> Deselect Agent)
 */
export function useKeyboardShortcuts(options?: KeyboardShortcutOptions) {
  const isCommandPaletteOpen = Boolean(options?.isCommandPaletteOpen);
  const onToggleCommandPalette = options?.onToggleCommandPalette;
  const onCloseCommandPalette = options?.onCloseCommandPalette;
  const {
    isModelSelectorOpen,
    openModelSelector,
    closeModelSelector,
    sidebarWidth,
    setSidebarWidth,
    toggleInspector,
    isSwarmMapOpen,
    setSwarmMapOpen,
    isSettingsModalOpen,
    setSettingsModalOpen,
    isNewProjectModalOpen,
    setNewProjectModalOpen,
    isCreateChannelModalOpen,
    setCreateChannelModalOpen,
    isAddAgentModalOpen,
    setAddAgentModalOpen,
    isNewGoalModalOpen,
    setNewGoalModalOpen,
    isNewTaskModalOpen,
    setNewTaskModalOpen,
    selectedAgentId,
    setSelectedAgentId,
    activeTakeover,
    pauseAgent,
  } = useKinStore(
    useShallow((s) => ({
      isModelSelectorOpen: s.isModelSelectorOpen,
      openModelSelector: s.openModelSelector,
      closeModelSelector: s.closeModelSelector,
      sidebarWidth: s.sidebarWidth,
      setSidebarWidth: s.setSidebarWidth,
      toggleInspector: s.toggleInspector,
      isSwarmMapOpen: s.isSwarmMapOpen,
      setSwarmMapOpen: s.setSwarmMapOpen,
      isSettingsModalOpen: s.isSettingsModalOpen,
      setSettingsModalOpen: s.setSettingsModalOpen,
      isNewProjectModalOpen: s.isNewProjectModalOpen,
      setNewProjectModalOpen: s.setNewProjectModalOpen,
      isCreateChannelModalOpen: s.isCreateChannelModalOpen,
      setCreateChannelModalOpen: s.setCreateChannelModalOpen,
      isAddAgentModalOpen: s.isAddAgentModalOpen,
      setAddAgentModalOpen: s.setAddAgentModalOpen,
      isNewGoalModalOpen: s.isNewGoalModalOpen,
      setNewGoalModalOpen: s.setNewGoalModalOpen,
      isNewTaskModalOpen: s.isNewTaskModalOpen,
      setNewTaskModalOpen: s.setNewTaskModalOpen,
      selectedAgentId: s.selectedAgentId,
      setSelectedAgentId: s.setSelectedAgentId,
      activeTakeover: s.activeTakeover,
      pauseAgent: s.pauseAgent,
    }))
  );

  useEffect(() => {
    let lastNonZeroSidebarWidth = sidebarWidth > 0 ? sidebarWidth : 260;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      // Don't intercept inputs unless it's a modifier shortcut or Escape
      const target = e.target as HTMLElement | null;
      const isInInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.getAttribute('role') === 'textbox');

      // 1. Cmd/Ctrl + K: Command Palette
      if (modifier && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (onToggleCommandPalette) {
          onToggleCommandPalette();
        } else if (isModelSelectorOpen) {
          closeModelSelector();
        } else {
          openModelSelector(null);
        }
        return;
      }

      // 2. Cmd/Ctrl + B: Toggle Left Navigation Sidebar
      if (modifier && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (sidebarWidth > 0) {
          lastNonZeroSidebarWidth = sidebarWidth;
          setSidebarWidth(0);
        } else {
          setSidebarWidth(lastNonZeroSidebarWidth || 260);
        }
        return;
      }

      // 3. Cmd/Ctrl + I: Toggle Inspector
      if (modifier && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        toggleInspector();
        return;
      }

      // 4. Cmd/Ctrl + M: Toggle Swarm Map
      if (modifier && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setSwarmMapOpen(!isSwarmMapOpen);
        return;
      }

      // 5. Escape: Hierarchical Dismissal
      if (e.key === 'Escape') {
        if (isCommandPaletteOpen) {
          e.preventDefault();
          onCloseCommandPalette?.();
          return;
        }
        // Modal priority
        if (isSwarmMapOpen) {
          e.preventDefault();
          setSwarmMapOpen(false);
          return;
        }
        if (isSettingsModalOpen) {
          e.preventDefault();
          setSettingsModalOpen(false);
          return;
        }
        if (isModelSelectorOpen) {
          e.preventDefault();
          closeModelSelector();
          return;
        }
        if (isNewProjectModalOpen) {
          e.preventDefault();
          setNewProjectModalOpen(false);
          return;
        }
        if (isCreateChannelModalOpen) {
          e.preventDefault();
          setCreateChannelModalOpen(false);
          return;
        }
        if (isAddAgentModalOpen) {
          e.preventDefault();
          setAddAgentModalOpen(false);
          return;
        }
        if (isNewGoalModalOpen) {
          e.preventDefault();
          setNewGoalModalOpen(false);
          return;
        }
        if (isNewTaskModalOpen) {
          e.preventDefault();
          setNewTaskModalOpen(false);
          return;
        }

        // Active Machine Takeover Pause
        if (activeTakeover && !isInInput) {
          e.preventDefault();
          if (activeTakeover.runId) {
            pauseAgent(activeTakeover.runId);
          }
          return;
        }

        // Deselect current agent inspection
        if (selectedAgentId && !isInInput) {
          e.preventDefault();
          setSelectedAgentId('');
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isModelSelectorOpen,
    openModelSelector,
    closeModelSelector,
    sidebarWidth,
    setSidebarWidth,
    toggleInspector,
    isSwarmMapOpen,
    setSwarmMapOpen,
    isSettingsModalOpen,
    setSettingsModalOpen,
    isNewProjectModalOpen,
    setNewProjectModalOpen,
    isCreateChannelModalOpen,
    setCreateChannelModalOpen,
    isAddAgentModalOpen,
    setAddAgentModalOpen,
    isNewGoalModalOpen,
    setNewGoalModalOpen,
    isNewTaskModalOpen,
    setNewTaskModalOpen,
    selectedAgentId,
    setSelectedAgentId,
    activeTakeover,
    pauseAgent,
    isCommandPaletteOpen,
    onToggleCommandPalette,
    onCloseCommandPalette,
  ]);
}
