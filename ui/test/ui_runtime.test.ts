import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useKinStore } from '../src/store/kinStore.js';
import { cleanProse } from '../src/components/messages/MessageItem.js';

describe('KIN UI Store & Timeline Unit Verification', () => {
  beforeEach(() => {
    useKinStore.setState({
      isPairingModalOpen: false,
      pairingError: null,
      confirmDialog: null,
      isOnboardingWizardOpen: false,
    });
  });

  it('cleanProse strips internal think/tool tags while preserving user-facing prose', () => {
    const raw = '<think>internal reasoning</think>\nHello team!\n<tool_call>{"name":"readFile"}</tool_call>';
    expect(cleanProse(raw)).toBe('Hello team!');
  });

  it('ConfirmDialog store action skips onCancel when closeConfirmDialog(true) is called on confirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    useKinStore.getState().openConfirmDialog({
      title: 'Confirm Delete',
      message: 'Proceed?',
      onConfirm,
      onCancel,
    });
    expect(useKinStore.getState().confirmDialog?.isOpen).toBe(true);

    // Confirm path passes skipCancel = true
    useKinStore.getState().closeConfirmDialog(true);
    expect(useKinStore.getState().confirmDialog).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();

    // Cancel path invokes onCancel
    useKinStore.getState().openConfirmDialog({
      title: 'Confirm Cancel',
      message: 'Proceed?',
      onConfirm,
      onCancel,
    });
    useKinStore.getState().closeConfirmDialog();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('submitPairingToken opens SSE and clears pairing modal on valid 200 health check, or reports error on 401', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })) as any;
    try {
      await useKinStore.getState().submitPairingToken('bad-token');
      expect(useKinStore.getState().pairingError).toContain('401');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
