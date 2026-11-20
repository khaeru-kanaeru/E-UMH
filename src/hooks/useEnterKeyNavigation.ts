import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

export type FocusableFormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

interface UseEnterKeyNavigationOptions {
  /** Optional submit element focused after the last field (Shift+Enter returns to last field) */
  submitRef?: RefObject<HTMLElement | null>;
  /** Wrap back to the first field when pressing Enter on the last field (if no submitRef) */
  wrap?: boolean;
  /** Disable interception temporarily (e.g. when a sub-modal overlay is open) */
  disabled?: boolean;
}

interface UseEnterKeyNavigationResult {
  /** Ref array storing all currently mounted & visible focusable input elements */
  fieldsRef: RefObject<FocusableFormField[]>;
  /** 0-based index of the currently focused field in fieldsRef, or -1 if none */
  activeFieldIndex: number;
  /** Total number of currently tracked focusable fields */
  totalFields: number;
  /** Manually refresh the stored focusable elements list */
  syncFields: () => FocusableFormField[];
  /** Focus and scroll a specific field into view with selection */
  focusField: (field: FocusableFormField | null | undefined) => void;
}

const FOCUSABLE_INPUT_SELECTOR = [
  'input:not([type="hidden"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not(:disabled):not([tabindex="-1"])',
  'select:not(:disabled):not([tabindex="-1"])',
  'textarea:not(:disabled):not([tabindex="-1"])',
].join(', ');

function isElementVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null && el.getClientRects().length > 0;
}

/**
 * Custom hook that maintains a ref list of all visible focusable input elements
 * within a form container, intercepts the Enter key to cycle focus sequentially
 * (Shift+Enter moves backward), and visually manages focus & scroll position.
 */
export function useEnterKeyNavigation(
  containerRef: RefObject<HTMLElement | null>,
  options: UseEnterKeyNavigationOptions = {}
): UseEnterKeyNavigationResult {
  const { submitRef, wrap = true, disabled = false } = options;

  const fieldsRef = useRef<FocusableFormField[]>([]);
  const [activeFieldIndex, setActiveFieldIndex] = useState<number>(-1);
  const [totalFields, setTotalFields] = useState<number>(0);

  const syncFields = useCallback((): FocusableFormField[] => {
    const container = containerRef.current;
    if (!container) {
      fieldsRef.current = [];
      setTotalFields(0);
      return [];
    }

    const nextFields = Array.from(
      container.querySelectorAll<FocusableFormField>(FOCUSABLE_INPUT_SELECTOR)
    ).filter(isElementVisible);

    fieldsRef.current = nextFields;
    setTotalFields((prev) => (prev === nextFields.length ? prev : nextFields.length));
    return nextFields;
  }, [containerRef]);

  const focusField = useCallback((field: FocusableFormField | null | undefined) => {
    if (!field) return;
    field.focus();
    field.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (field.tagName === 'INPUT') {
      try {
        (field as HTMLInputElement).select();
      } catch {
        // Some input types do not support .select() in all browsers
      }
    }
  }, []);

  useEffect(() => {
    if (disabled) return;
    const container = containerRef.current;
    if (!container) return;

    syncFields();

    const observer = new MutationObserver(() => {
      const updated = syncFields();
      const activeEl = document.activeElement as FocusableFormField | null;
      setActiveFieldIndex(activeEl ? updated.indexOf(activeEl) : -1);
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'style', 'class', 'tabindex'],
    });

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as FocusableFormField | null;
      const fields = syncFields();
      setActiveFieldIndex(target ? fields.indexOf(target) : -1);
    };

    const handleFocusOut = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (!nextTarget || !container.contains(nextTarget)) {
        setActiveFieldIndex(-1);
      }
    };

    const handleContainerKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Enter' ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (!target) return;

      const tag = target.tagName;
      if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') return;

      if (tag === 'INPUT') {
        const inputType = (target as HTMLInputElement).type;
        if (
          inputType === 'file' ||
          inputType === 'button' ||
          inputType === 'submit' ||
          inputType === 'reset'
        ) {
          return;
        }
      }

      event.preventDefault();

      const fields = syncFields();
      const currentIdx = fields.indexOf(target as FocusableFormField);
      if (currentIdx === -1 || fields.length === 0) return;

      const nextIdx = event.shiftKey ? currentIdx - 1 : currentIdx + 1;

      if (nextIdx >= 0 && nextIdx < fields.length) {
        focusField(fields[nextIdx]);
        setActiveFieldIndex(nextIdx);
      } else if (!event.shiftKey) {
        if (submitRef?.current) {
          submitRef.current.focus();
          submitRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          setActiveFieldIndex(-1);
        } else if (wrap) {
          focusField(fields[0]);
          setActiveFieldIndex(0);
        }
      } else if (event.shiftKey && wrap) {
        const lastIdx = fields.length - 1;
        focusField(fields[lastIdx]);
        setActiveFieldIndex(lastIdx);
      }
    };

    const submitEl = submitRef?.current;
    const handleSubmitKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        const fields = syncFields();
        if (fields.length > 0) {
          const lastIdx = fields.length - 1;
          focusField(fields[lastIdx]);
          setActiveFieldIndex(lastIdx);
        }
      }
    };

    container.addEventListener('keydown', handleContainerKeyDown);
    container.addEventListener('focusin', handleFocusIn);
    container.addEventListener('focusout', handleFocusOut);
    submitEl?.addEventListener('keydown', handleSubmitKeyDown);

    return () => {
      observer.disconnect();
      container.removeEventListener('keydown', handleContainerKeyDown);
      container.removeEventListener('focusin', handleFocusIn);
      container.removeEventListener('focusout', handleFocusOut);
      submitEl?.removeEventListener('keydown', handleSubmitKeyDown);
    };
  }, [containerRef, submitRef, wrap, disabled, syncFields, focusField]);

  return {
    fieldsRef,
    activeFieldIndex,
    totalFields,
    syncFields,
    focusField,
  };
}
