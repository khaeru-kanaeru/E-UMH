import { CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, MoreHorizontal, MoreVertical } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface ActionMenuItem {
  id: string;
  label: string;
  description?: string;
  count?: number;
  icon?: LucideIcon;
  iconClassName?: string;
  danger?: boolean;
  disabled?: boolean;
  dividerBefore?: boolean;
  onClick: () => void;
}

interface ActionMenuProps {
  label?: string;
  ariaLabel?: string;
  items: ActionMenuItem[];
  align?: 'left' | 'right';
  compact?: boolean;
  triggerIcon?: LucideIcon;
  triggerIconClassName?: string;
  triggerClassName?: string;
  kebabVertical?: boolean;
  disabled?: boolean;
  menuWidthClass?: string;
  fixedPosition?: boolean;
}

export function ActionMenu({
  label,
  ariaLabel = 'Opsi lainnya',
  items,
  align = 'right',
  compact = false,
  triggerIcon: TriggerIcon,
  triggerIconClassName,
  triggerClassName,
  kebabVertical = false,
  disabled = false,
  menuWidthClass = 'w-60',
  fixedPosition = false,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [fixedStyle, setFixedStyle] = useState<CSSProperties | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const updateFixedPosition = useCallback(() => {
    if (!fixedPosition || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const estimatedHeight = Math.min(320, items.length * 56 + 24);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < estimatedHeight && rect.top > estimatedHeight;

    const style: CSSProperties = {
      position: 'fixed',
      zIndex: 60,
    };
    if (openUpward) {
      style.bottom = window.innerHeight - rect.top + 6;
    } else {
      style.top = rect.bottom + 6;
    }
    if (align === 'right') {
      style.right = Math.max(8, window.innerWidth - rect.right);
    } else {
      style.left = Math.max(8, rect.left);
    }
    setFixedStyle(style);
  }, [fixedPosition, align, items.length]);

  useEffect(() => {
    if (!open) return;
    if (fixedPosition) {
      updateFixedPosition();
    }
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    const handleViewportChange = () => {
      if (fixedPosition) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    if (fixedPosition) {
      window.addEventListener('scroll', handleViewportChange, true);
      window.addEventListener('resize', handleViewportChange);
    }
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      if (fixedPosition) {
        window.removeEventListener('scroll', handleViewportChange, true);
        window.removeEventListener('resize', handleViewportChange);
      }
    };
  }, [open, fixedPosition, updateFixedPosition]);

  const KebabIcon = kebabVertical ? MoreVertical : MoreHorizontal;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          if (!open && fixedPosition) {
            updateFixedPosition();
          }
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={
          triggerClassName ??
          `inline-flex items-center justify-center gap-1.5 rounded-xl bg-white border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            open
              ? 'border-[#1E3A8A]/40 bg-slate-50 text-slate-900 ring-2 ring-[#1E3A8A]/10'
              : 'border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900'
          } ${compact ? 'px-2 py-1.5' : 'px-3.5 py-2'}`
        }
      >
        {label ? (
          <>
            {TriggerIcon && (
              <TriggerIcon className={`w-3.5 h-3.5 shrink-0 ${triggerIconClassName ?? ''}`} />
            )}
            <span>{label}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${
                open ? 'rotate-180 text-slate-700' : ''
              }`}
            />
          </>
        ) : TriggerIcon ? (
          <TriggerIcon className={`w-4 h-4 ${triggerIconClassName ?? ''}`} />
        ) : (
          <KebabIcon className="w-4 h-4" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={fixedPosition ? fixedStyle : undefined}
          className={`${
            fixedPosition
              ? ''
              : `absolute mt-1.5 z-30 ${align === 'right' ? 'right-0' : 'left-0'}`
          } ${menuWidthClass} rounded-xl bg-white border border-slate-200 shadow-lg py-1.5 text-left`}
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.id}>
                {item.dividerBefore && <div className="my-1 border-t border-slate-100" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                  className={`w-full px-3.5 py-2 text-left flex items-start gap-2.5 transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer ${
                    item.danger
                      ? 'text-red-600 hover:bg-red-50'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {Icon && (
                    <Icon
                      className={`w-4 h-4 shrink-0 mt-0.5 ${
                        item.iconClassName || (item.danger ? 'text-red-600' : 'text-slate-400')
                      }`}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold truncate">{item.label}</span>
                      {typeof item.count === 'number' && item.count > 0 && (
                        <span className="font-mono-num text-[11px] font-semibold text-slate-500 shrink-0">
                          {item.count}
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                        {item.description}
                      </p>
                    )}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
